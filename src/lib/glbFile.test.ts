// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fitsTextureBudget, imagePixelSize, isGlbBytes, parseGlb, repackGlb, stripTextures, textureLoad, textureSizeCap } from "./glbFile";

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


/** Header-only image stubs: enough bytes for imagePixelSize, no pixel data. */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpegHeader(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment to skip (16 bytes), then a baseline start-of-frame.
  const b = new Uint8Array(2 + 18 + 12);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  new DataView(b.buffer).setUint16(25, height);
  new DataView(b.buffer).setUint16(27, width);
  return b;
}

function glbWithImages(images: Uint8Array[]): ArrayBuffer {
  const bin = new Uint8Array(images.reduce((n, i) => n + i.length, 0));
  const bufferViews: object[] = [];
  let at = 0;
  for (const img of images) {
    bin.set(img, at);
    bufferViews.push({ buffer: 0, byteOffset: at, byteLength: img.length });
    at += img.length;
  }
  return buildGlb(
    {
      asset: { version: "2.0" },
      buffers: [{ byteLength: bin.length }],
      bufferViews,
      images: images.map((_, i) => ({ bufferView: i, mimeType: "image/png" })),
    },
    bin,
  );
}

describe("imagePixelSize", () => {
  it("reads PNG and JPEG sizes from the header", () => {
    expect(imagePixelSize(pngHeader(1664, 1664))).toEqual({ width: 1664, height: 1664 });
    expect(imagePixelSize(jpegHeader(2048, 1024))).toEqual({ width: 2048, height: 1024 });
  });

  it("returns null for anything it does not know", () => {
    expect(imagePixelSize(new Uint8Array(64))).toBeNull();
    expect(imagePixelSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("texture budget for previews", () => {
  it("adds up decoded size, not bytes (kitchen export, 16 Nov 2026)", () => {
    // Oak 1664 px, ash 1712 px, marble 1352 px — a colour and a normal map each.
    const kitchen = glbWithImages([1664, 1664, 1712, 1712, 1352, 1352].map((s) => pngHeader(s, s)));
    const load = textureLoad(kitchen);
    expect(load.count).toBe(6);
    expect(load.unknown).toBe(0);
    expect(load.megapixels).toBeCloseTo(15.06, 1);
    expect(fitsTextureBudget(kitchen)).toBe(true);
  });

  it("shows textures for many small images (the old rule hid everything above 12)", () => {
    const many = glbWithImages(Array.from({ length: 40 }, () => jpegHeader(512, 512)));
    expect(fitsTextureBudget(many)).toBe(true);
  });

  it("holds back a model that would not fit on the GPU", () => {
    const heavy = glbWithImages(Array.from({ length: 8 }, () => pngHeader(4096, 4096)));
    expect(fitsTextureBudget(heavy)).toBe(false);
  });

  it("counts an unreadable image as a full-size one", () => {
    const load = textureLoad(glbWithImages([new Uint8Array(40), pngHeader(100, 100)]));
    expect(load.unknown).toBe(1);
    expect(load.megapixels).toBeCloseTo(4.2, 1);
  });

  it("every optimised upload fits: the optimiser resizes to the same budget", () => {
    for (const count of [1, 6, 12, 13, 43, 90]) {
      const cap = textureSizeCap(count);
      const glb = glbWithImages(Array.from({ length: count }, () => pngHeader(cap, cap)));
      expect(fitsTextureBudget(glb), `${count} textures at ${cap} px`).toBe(true);
    }
  });

  it("lets a file that is not a GLB through to the loader", () => {
    expect(fitsTextureBudget(new ArrayBuffer(8))).toBe(true);
  });
});
