// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isGlbBytes, parseGlb, repackGlb, stripTextures, textureSizeCap } from "./glbFile";

function buildGlb(json: object, bin: Uint8Array): ArrayBuffer {
  // Reuse repackGlb with no replacements to author a fixture.
  return repackGlb(json as Record<string, unknown>, bin, new Map());
}

describe("isGlbBytes", () => {
  it("accepts a GLB v2 header", () => {
    const glb = buildGlb({ asset: { version: "2.0" } }, new Uint8Array());
    expect(isGlbBytes(glb)).toBe(true);
  });

  it("rejects a USDZ (zip) header", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isGlbBytes(zip)).toBe(false);
  });

  it("rejects short input", () => {
    expect(isGlbBytes(new Uint8Array([0x67, 0x6c]))).toBe(false);
  });
});

describe("repackGlb", () => {
  const geometry = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const image = new Uint8Array(100).fill(7);
  const tail = new Uint8Array([42, 43, 44, 45]);
  const bin = new Uint8Array(geometry.length + image.length + tail.length);
  bin.set(geometry, 0);
  bin.set(image, 12);
  bin.set(tail, 112);

  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 12 },
      { buffer: 0, byteOffset: 12, byteLength: 100 },
      { buffer: 0, byteOffset: 112, byteLength: 4 },
    ],
    images: [{ bufferView: 1, mimeType: "image/png" }],
  };

  it("replaces a bufferView and keeps the others byte-identical", () => {
    const smaller = new Uint8Array([9, 9, 9]); // odd length forces padding
    const out = repackGlb(json, bin, new Map([[1, smaller]]));
    const parsed = parseGlb(out);
    const bvs = parsed.json.bufferViews;

    const slice = (i: number) =>
      Array.from(parsed.bin!.subarray(bvs[i].byteOffset, bvs[i].byteOffset + bvs[i].byteLength));

    expect(slice(0)).toEqual(Array.from(geometry));
    expect(slice(1)).toEqual([9, 9, 9]);
    expect(slice(2)).toEqual(Array.from(tail));
    bvs.forEach((bv: { byteOffset: number }) => expect(bv.byteOffset % 4).toBe(0));
    expect(parsed.json.buffers[0].byteLength).toBe(bvs[2].byteOffset + 4);
    expect(out.byteLength % 4).toBe(0);
    expect(out.byteLength).toBeLessThan(buildGlb(json, bin).byteLength);
  });

  it("does not mutate the input JSON", () => {
    const before = JSON.stringify(json);
    repackGlb(json, bin, new Map([[1, new Uint8Array(4)]]));
    expect(JSON.stringify(json)).toBe(before);
  });
});

describe("textureSizeCap", () => {
  it("allows full size for a handful of textures", () => {
    expect(textureSizeCap(1)).toBe(2048);
    expect(textureSizeCap(5)).toBe(2048);
  });

  it("shrinks the cap as the texture count grows", () => {
    expect(textureSizeCap(43)).toBeLessThanOrEqual(1024);
    expect(textureSizeCap(43)).toBeGreaterThanOrEqual(512);
    expect(textureSizeCap(200)).toBe(512);
  });

  it("keeps a heavy model inside the memory budget", () => {
    const count = 43;
    const cap = textureSizeCap(count);
    const megapixels = (count * cap * cap) / 1e6;
    expect(megapixels).toBeLessThanOrEqual(30); // ~160 MB of GPU memory
  });
});

describe("stripTextures", () => {
  const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    samplers: [{}],
    materials: [{ name: "wood", pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0, 1], baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  };

  it("drops images, textures and samplers", () => {
    const out = parseGlb(stripTextures(buildGlb(json, bin), { keepMaterials: true })).json;
    expect(out.images).toBeUndefined();
    expect(out.textures).toBeUndefined();
    expect(out.samplers).toBeUndefined();
  });

  it("keeps material colours but no texture references when asked", () => {
    const out = parseGlb(stripTextures(buildGlb(json, bin), { keepMaterials: true })).json;
    expect(out.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1, 0.5, 0, 1]);
    expect(out.materials[0].pbrMetallicRoughness.baseColorTexture).toBeUndefined();
    expect(out.meshes[0].primitives[0].material).toBe(0);
  });

  it("drops materials entirely for marker parsing", () => {
    const out = parseGlb(stripTextures(buildGlb(json, bin))).json;
    expect(out.materials).toBeUndefined();
    expect(out.meshes[0].primitives[0].material).toBeUndefined();
    expect(out.meshes[0].primitives[0].attributes).toEqual({ POSITION: 0 });
  });
});

