import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { MarkerPoint } from "@/lib/markerTypes";
import { stripTextures } from "@/lib/glbFile";

const MAX_MARKERS = 20;

/** Legacy name → index mapping */
const LEGACY_MAP: Record<string, number> = {
  marker_a: 1,
  marker_b: 2,
  marker_c: 3,
};

/**
 * Extracts the world-space position of a THREE.Object3D.
 *
 * WHY THIS EXISTS:
 * Rhino's GLB exporter vertex-bakes all geometry — node.translation stays at
 * [0,0,0] and the actual world position is encoded directly into mesh vertex
 * data. Reading obj.getWorldPosition() therefore always returns (0,0,0) for
 * Rhino exports, regardless of where the object was placed in the scene.
 *
 * FIX: For mesh objects, compute the bounding-box centroid of the geometry
 * (which IS at the true world position for vertex-baked exports) and apply the
 * node's world matrix so that any parent transforms are still respected.
 * For empty/non-mesh nodes we fall back to getWorldPosition() as before, which
 * remains correct for non-Rhino exporters that use proper node transforms.
 */
function getObjectPosition(obj: THREE.Object3D): THREE.Vector3 {
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (box) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      // Apply world matrix — handles parent transforms from non-Rhino exporters.
      // For Rhino (all matrices = identity) this is a no-op and center already
      // holds the correct world position.
      center.applyMatrix4(mesh.matrixWorld);
      return center;
    }
  }
  // Fallback for empty/non-mesh nodes (standard non-Rhino glTF exporters)
  obj.updateWorldMatrix(true, false);
  return obj.getWorldPosition(new THREE.Vector3());
}

/**
 * glTF is Y-up in metres; the platform stores Rhino Z-up in millimetres.
 * This is the inverse of the export transform (Rhino writes with MapZToY on):
 *   Rhino.X =  glTF.X * 1000
 *   Rhino.Y = -glTF.Z * 1000
 *   Rhino.Z =  glTF.Y * 1000
 */
function gltfToRhinoMm(p: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: p.x * 1000, y: -p.z * 1000, z: p.y * 1000 };
}

/**
 * Parses a GLB file and looks for objects named marker_1 through marker_20
 * (case-insensitive, spaces/hyphens normalised to underscores, a trailing
 * "_proxy" ignored). Also supports legacy marker_A/B/C names (remapped to
 * 1/2/3). Returns sorted MarkerPoint[] in Rhino millimetres, or null if fewer
 * than 3 found.
 *
 * RHINO WORKFLOW NOTE:
 * Rhino's GLB exporter silently drops Point objects — they do not appear as
 * nodes in the exported file. Markers must therefore be small mesh objects.
 * The Marker Tool bakes a 15 mm sphere named <layer>_proxy onto each marker_*
 * layer, and exporting with ExportLayers on writes BOTH an empty group node
 * named after the layer ("marker_a") and the mesh inside it
 * ("marker_a_proxy"). The group node is vertex-baked like everything else, so
 * it sits at the origin — reading it instead of the mesh is what produced
 * three markers at 0,0,0. getBestPosition below always prefers the mesh.
 */
export async function parseGlbMarkers(file: File): Promise<MarkerPoint[] | null> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (ext !== ".glb") return null;

  // Markers only need node names + geometry; decoding textures here used to
  // block the UI for seconds on texture-heavy models.
  const buffer = stripTextures(await file.arrayBuffer());
  const loader = new GLTFLoader();

  return new Promise((resolve) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        const found = new Map<number, { x: number; y: number; z: number; fromMesh: boolean }>();

        // One marker can appear twice: as the layer's empty group node and as
        // the proxy mesh inside it. The mesh carries the real position, so it
        // always wins — whichever order traverse happens to reach them in.
        const record = (index: number, obj: THREE.Object3D) => {
          const fromMesh = !!(obj as THREE.Mesh).isMesh;
          const existing = found.get(index);
          if (existing?.fromMesh && !fromMesh) return;

          const pos = gltfToRhinoMm(getObjectPosition(obj));
          found.set(index, {
            x: parseFloat(pos.x.toFixed(4)),
            y: parseFloat(pos.y.toFixed(4)),
            z: parseFloat(pos.z.toFixed(4)),
            fromMesh,
          });
        };

        gltf.scene.traverse((obj) => {
          const name = obj.name
            .toLowerCase()
            .replace(/[\s-]/g, "_")
            .replace(/_proxy$/, "");

          // Check legacy names first
          if (LEGACY_MAP[name] !== undefined) {
            record(LEGACY_MAP[name], obj);
            return;
          }

          // Check marker_N pattern
          const match = name.match(/^marker_(\d+)$/);
          if (match) {
            const idx = parseInt(match[1], 10);
            if (idx >= 1 && idx <= MAX_MARKERS) {
              record(idx, obj);
            }
          }
        });

        // Every marker reading at the origin means the names matched but only
        // empty nodes were found — report nothing rather than three identical
        // points the editor will reject as overlapping.
        const allAtOrigin = Array.from(found.values()).every(
          (p) => p.x === 0 && p.y === 0 && p.z === 0
        );

        if (found.size < 3 || allAtOrigin) {
          resolve(null);
          return;
        }

        const markers: MarkerPoint[] = Array.from(found.entries())
          .sort(([a], [b]) => a - b)
          .map(([index, pos]) => ({
            index,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            label: `Marker ${index}`,
          }));

        resolve(markers);
      },
      () => {
        resolve(null);
      }
    );
  });
}
