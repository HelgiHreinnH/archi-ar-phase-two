// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dropBrokenNormalMaps, looksLikeNormalMap } from "./normalMaps";

describe("looksLikeNormalMap", () => {
  it("accepts tangent-space normal maps", () => {
    expect(looksLikeNormalMap(128, 128, 255)).toBe(true); // perfectly flat
    expect(looksLikeNormalMap(127, 129, 232)).toBe(true); // typical
    expect(looksLikeNormalMap(120, 135, 190)).toBe(true); // very bumpy
  });

  it("rejects what Rhino wrote for the kitchen (16 Nov 2026)", () => {
    expect(looksLikeNormalMap(255, 128, 128)).toBe(false); // oak + ash: channels in the wrong order
    expect(looksLikeNormalMap(131, 131, 131)).toBe(false); // marble: greyscale height map
  });
});

describe("dropBrokenNormalMaps", () => {
  const scene = (materials: unknown[]) => ({
    traverse(fn: (o: unknown) => void) {
      for (const material of materials) fn({ isMesh: true, material });
      fn({ isMesh: false });
    },
  });
  const sample = (image: unknown) => image as [number, number, number] | null;

  it("removes only the broken maps and flags the material for recompiling", () => {
    const good = { normalMap: { image: [128, 128, 250] }, needsUpdate: false };
    const flat = { normalMap: { image: [255, 128, 128] }, needsUpdate: false };
    const grey = { normalMap: { image: [90, 90, 90] }, needsUpdate: false };
    const plain = { normalMap: null, needsUpdate: false };

    expect(dropBrokenNormalMaps(scene([good, flat, grey, plain, [flat, good]]), sample)).toBe(2);
    expect(good.normalMap).not.toBeNull();
    expect(flat.normalMap).toBeNull();
    expect(flat.needsUpdate).toBe(true);
    expect(grey.normalMap).toBeNull();
    expect(good.needsUpdate).toBe(false);
  });

  it("leaves a texture alone when its image cannot be read", () => {
    const compressed = { normalMap: { image: null }, needsUpdate: false };
    expect(dropBrokenNormalMaps(scene([compressed]), sample)).toBe(0);
    expect(compressed.normalMap).not.toBeNull();
  });

  it("judges a shared texture once", () => {
    let calls = 0;
    const tex = { image: [255, 128, 128] };
    const a = { normalMap: tex, needsUpdate: false };
    const b = { normalMap: tex, needsUpdate: false };
    const counting = (image: unknown) => { calls++; return sample(image); };
    expect(dropBrokenNormalMaps(scene([a, b]), counting)).toBe(2);
    expect(calls).toBe(1);
  });
});
