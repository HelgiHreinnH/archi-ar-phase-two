import { describe, expect, it } from "vitest";
import { Document } from "@gltf-transform/core";
import { KHRMaterialsTransmission } from "@gltf-transform/extensions";
import { fixMaterials } from "./optimizeGlb";
import { storageSafeName } from "./glbFile";

describe("fixMaterials", () => {
  it("turns transmission glass into alpha-blended glass and drops the extension", () => {
    const doc = new Document();
    const ext = doc.createExtension(KHRMaterialsTransmission);
    const glass = doc.createMaterial("Glas").setBaseColorFactor([0.9, 0.9, 0.9, 1]);
    glass.setExtension("KHR_materials_transmission", ext.createTransmission().setTransmissionFactor(0.85));
    const r = fixMaterials(doc);
    expect(r.glass).toBe(1);
    expect(glass.getAlphaMode()).toBe("BLEND");
    expect(glass.getBaseColorFactor()[3]).toBeCloseTo(0.2775, 3);
    expect(doc.getRoot().listExtensionsUsed()).toHaveLength(0);
  });

  it("makes Rhino display-colour fallbacks matte, leaves real metals alone", () => {
    const doc = new Document();
    const fallback = doc.createMaterial("").setMetallicFactor(1).setRoughnessFactor(1).setBaseColorFactor([0, 1, 0, 1]);
    const brass = doc.createMaterial("Messing").setMetallicFactor(1).setRoughnessFactor(0.55);
    fixMaterials(doc);
    expect(fallback.getMetallicFactor()).toBe(0);
    expect(brass.getMetallicFactor()).toBe(1);
  });

  it("switches LINEAR min filters to mipmapped", () => {
    const doc = new Document();
    const tex = doc.createTexture("wood");
    const m = doc.createMaterial("Eg").setBaseColorTexture(tex);
    m.getBaseColorTextureInfo()!.setMinFilter(9729);
    fixMaterials(doc);
    expect(m.getBaseColorTextureInfo()!.getMinFilter()).toBe(9987);
  });
});

describe("storageSafeName", () => {
  it("transliterates Danish/Icelandic letters", () => {
    expect(storageSafeName("2026-069_Fændediget 12.glb")).toBe("2026-069_Faendediget 12.glb");
    expect(storageSafeName("Grøn å.glb")).toBe("Groen aa.glb");
    expect(storageSafeName("Þórsgata.glb")).toBe("Thorsgata.glb");
  });
});
