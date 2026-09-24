/**
 * Mobile-AR optimisation for uploaded GLBs (runs in a Web Worker, see
 * `src/workers/optimizeGlb.worker.ts`).
 *
 * Why this exists (Fændediget 12, 24 Sep 2026): a typical Rhino 8 interior
 * export arrived as 1,911 nodes / 49,808 primitives / 1.14 M triangles, Draco
 * compressed, 50 MB. On a phone that is ~50 k draw calls per frame — the camera
 * feed itself stutters because 8th Wall draws camera + three.js in one frame.
 * Draco also meant the old in-browser meshopt step skipped the file entirely.
 *
 * Pipeline (order matters):
 *  1. Drop Draco (decoded on read) and the expensive material extensions —
 *     transmission forces three.js to render the whole scene a second time
 *     every frame. Transmissive glass becomes plain alpha-blended glass.
 *  2. Fix Rhino "display colour" materials (unnamed, metal 1, rough 1, no
 *     texture): with no environment they render black.
 *  3. Mipmapped samplers — Rhino writes LINEAR min filter, which shimmers
 *     badly once a 1:10 model shrinks every texture.
 *  4. dedup (materials/textures/meshes — NOT accessors: accessor hashing took
 *     40 s on 200 k accessors) → instance → flatten → join by material → weld.
 *     This is the draw-call fix: 49,808 → 25 on Fændediget.
 *  5. simplify with a small *relative* error (0.02 % of the model's size:
 *     ~2 mm on a 9 m kitchen, invisible at 1:10) — 1.14 M → 271 k tris.
 *  6. meshopt compression (decodes in ms on phones, no WASM worker needed).
 *
 * Measured on Fændediget in Node: 50.3 MB → 4.4 MB, ~17 s.
 */
import type { Document, Material, Texture, TextureInfo } from "@gltf-transform/core";
import type { Transmission } from "@gltf-transform/extensions";
import { dedup, flatten, instance, join, meshopt, prune, simplify, weld } from "@gltf-transform/functions";

/** Relative simplification error (fraction of the mesh's bounding extent). */
export const SIMPLIFY_ERROR = 0.0002;

const HEAVY_MATERIAL_EXTENSIONS = [
  "KHR_draco_mesh_compression",
  "KHR_materials_transmission",
  "KHR_materials_volume",
  "KHR_materials_clearcoat",
  "KHR_materials_sheen",
  "KHR_materials_iridescence",
  "KHR_materials_specular",
  "KHR_materials_ior",
  "KHR_materials_dispersion",
  "KHR_materials_anisotropy",
];

// glTF sampler enums
const LINEAR = 9729;
const LINEAR_MIPMAP_LINEAR = 9987;

export interface ModelStats {
  nodes: number;
  meshes: number;
  primitives: number;
  triangles: number;
  materials: number;
  textures: number;
}

export function modelStats(doc: Document): ModelStats {
  const root = doc.getRoot();
  let primitives = 0;
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      if (prim.getMode() !== 4) continue; // TRIANGLES only
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : prim.getAttribute("POSITION")?.getCount() ?? 0;
      triangles += count / 3;
    }
  }
  return {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    primitives,
    triangles: Math.round(triangles),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
  };
}

function textureInfos(m: Material): Array<[Texture | null, TextureInfo | null]> {
  return [
    [m.getBaseColorTexture(), m.getBaseColorTextureInfo()],
    [m.getNormalTexture(), m.getNormalTextureInfo()],
    [m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo()],
    [m.getOcclusionTexture(), m.getOcclusionTextureInfo()],
    [m.getEmissiveTexture(), m.getEmissiveTextureInfo()],
  ];
}

/**
 * Material fixes that change how the model looks on a phone. Pure and cheap;
 * exported for tests. Returns counts for logging.
 */
export function fixMaterials(doc: Document): { glass: number; displayColour: number; samplers: number } {
  const root = doc.getRoot();
  let glass = 0;
  let displayColour = 0;
  let samplers = 0;

  for (const m of root.listMaterials()) {
    // Transmission → alpha blend. Opacity follows how clear the glass was.
    const tr = m.getExtension<Transmission>("KHR_materials_transmission");
    const t = tr?.getTransmissionFactor() ?? 0;
    if (t > 0) {
      const [r, g, b] = m.getBaseColorFactor();
      m.setBaseColorFactor([r, g, b, Math.max(0.15, 1 - 0.85 * t)]);
      m.setAlphaMode("BLEND");
      m.setDoubleSided(true);
      glass++;
    }

    // Rhino fallback for objects with no render material: unnamed, fully
    // metallic, fully rough, flat colour. Renders black without an env map
    // and is never what the architect meant.
    const textured = textureInfos(m).some(([tex]) => !!tex);
    if (!m.getName() && !textured && m.getMetallicFactor() >= 0.99 && m.getRoughnessFactor() >= 0.99) {
      m.setMetallicFactor(0);
      m.setRoughnessFactor(0.8);
      displayColour++;
    }

    for (const [tex, info] of textureInfos(m)) {
      if (!tex || !info) continue;
      const min = info.getMinFilter();
      if (min === null || min === LINEAR || min === 9728 /* NEAREST */) {
        info.setMinFilter(LINEAR_MIPMAP_LINEAR);
        info.setMagFilter(LINEAR);
        samplers++;
      }
    }
  }

  // Drop the extensions last (disposing detaches them from every material).
  for (const ext of root.listExtensionsUsed()) {
    if (HEAVY_MATERIAL_EXTENSIONS.includes(ext.extensionName)) ext.dispose();
  }
  return { glass, displayColour, samplers };
}

export type OptimizeStage = "decode" | "materials" | "merge" | "simplify" | "compress" | "write";

export interface OptimizeDeps {
  // meshoptimizer's encoder + simplifier (already `.ready`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  encoder: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  simplifier: any;
}

/** Runs steps 1–6 on an already-read document, in place. */
export async function optimizeDocument(
  doc: Document,
  deps: OptimizeDeps,
  onStage: (s: OptimizeStage) => void = () => {},
): Promise<{ fixes: ReturnType<typeof fixMaterials> }> {
  onStage("materials");
  const fixes = fixMaterials(doc);

  onStage("merge");
  await doc.transform(
    dedup({ propertyTypes: ["Material", "Texture", "Mesh"] }),
    instance({ min: 5 }),
    flatten(),
    join({ keepNamed: false }),
    weld(),
    prune({ keepAttributes: false, keepLeaves: false }),
  );

  onStage("simplify");
  await doc.transform(simplify({ simplifier: deps.simplifier, ratio: 0, error: SIMPLIFY_ERROR }));

  onStage("compress");
  // 16-bit positions ≈ 0.3 mm on a 20 m model — below anything visible in AR.
  await doc.transform(meshopt({ encoder: deps.encoder, level: "medium", quantizePosition: 16 }));
  return { fixes };
}
