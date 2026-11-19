/**
 * Minimal GLB writer for tests: named nodes with triangle meshes, optional
 * asset.extras. Shapes the Rhino plugin's Spatial export (contract §5.1):
 * a group node `marker_X` (no mesh, at the origin) holding the proxy mesh
 * `marker_X_proxy` whose vertices are baked at the marker position.
 */
export interface TestMesh {
  name: string;
  /** Flat list of triangle vertices, glTF metres (x, y, z, x, y, z, …). */
  positions: number[];
  /** Name of a group node to put the mesh under (created once, at the origin). */
  parent?: string;
}

/** Small octahedron (8 triangles) centred on c, half-size h (metres). */
export function octahedron(c: [number, number, number], h = 0.0075): number[] {
  const [x, y, z] = c;
  const px = [x + h, y, z], nx = [x - h, y, z], py = [x, y + h, z], ny = [x, y - h, z], pz = [x, y, z + h], nz = [x, y, z - h];
  const faces = [[px, py, pz], [py, nx, pz], [nx, ny, pz], [ny, px, pz], [py, px, nz], [nx, py, nz], [ny, nx, nz], [px, ny, nz]];
  return faces.flat(2);
}

/** Rhino mm (Z-up) → glTF m (Y-up), MapZToY (contract §2). */
export function rhinoToGltf(p: [number, number, number]): [number, number, number] {
  return [p[0] / 1000, p[2] / 1000, -p[1] / 1000];
}

/** A4 sheet as two triangles in the plane spanned by unit vectors u (width) and v (height), centred on c (metres). */
export function sheetQuad(c: [number, number, number], u: [number, number, number], v: [number, number, number], w = 0.21, h = 0.297): number[] {
  const at = (a: number, b: number) => [0, 1, 2].map((i) => c[i] + u[i] * a * w / 2 + v[i] * b * h / 2);
  const p00 = at(-1, -1), p10 = at(1, -1), p11 = at(1, 1), p01 = at(-1, 1);
  return [p00, p10, p11, p00, p11, p01].flat();
}

/** Spatial plugin marker: group + proxy mesh at a Rhino mm coordinate. */
export function markerMeshes(letter: string, rhinoMm: [number, number, number]): TestMesh[] {
  return [{ name: `marker_${letter}_proxy`, parent: `marker_${letter}`, positions: octahedron(rhinoToGltf(rhinoMm)) }];
}

export function buildGlb(meshes: TestMesh[], assetExtras?: Record<string, unknown>): ArrayBuffer {
  const floats: number[] = [];
  const json: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
    asset: { version: "2.0", generator: "glbBuilder (test)", ...(assetExtras ? { extras: assetExtras } : {}) },
    scene: 0,
    scenes: [{ nodes: [] as number[] }],
    nodes: [] as Record<string, unknown>[],
    meshes: [] as Record<string, unknown>[],
    accessors: [] as Record<string, unknown>[],
    bufferViews: [] as Record<string, unknown>[],
    buffers: [{ byteLength: 0 }],
  };
  const groups = new Map<string, number>();
  for (const m of meshes) {
    const count = m.positions.length / 3;
    const min = [0, 1, 2].map((i) => Math.min(...m.positions.filter((_, k) => k % 3 === i)));
    const max = [0, 1, 2].map((i) => Math.max(...m.positions.filter((_, k) => k % 3 === i)));
    json.bufferViews.push({ buffer: 0, byteOffset: floats.length * 4, byteLength: m.positions.length * 4 });
    floats.push(...m.positions);
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count, type: "VEC3", min, max });
    json.meshes.push({ name: m.name, primitives: [{ attributes: { POSITION: json.accessors.length - 1 } }] });
    json.nodes.push({ name: m.name, mesh: json.meshes.length - 1 });
    const nodeIdx = json.nodes.length - 1;
    if (m.parent) {
      let g = groups.get(m.parent);
      if (g === undefined) {
        json.nodes.push({ name: m.parent, children: [] });
        g = json.nodes.length - 1;
        groups.set(m.parent, g);
        json.scenes[0].nodes.push(g);
      }
      json.nodes[g].children.push(nodeIdx);
    } else {
      json.scenes[0].nodes.push(nodeIdx);
    }
  }
  const bin = new Float32Array(floats);
  json.buffers[0].byteLength = bin.byteLength;

  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(enc.length / 4) * 4;
  const binLen = Math.ceil(bin.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  u8.fill(0x20, 20, 20 + jsonLen);
  u8.set(enc, 20);
  const b = 20 + jsonLen;
  dv.setUint32(b, binLen, true);
  dv.setUint32(b + 4, 0x004e4942, true);
  u8.set(new Uint8Array(bin.buffer), b + 8);
  return out;
}

export function glbFile(buf: ArrayBuffer, name = "test_spatial.glb"): File {
  return new File([new Uint8Array(buf)], name, { type: "model/gltf-binary" });
}
