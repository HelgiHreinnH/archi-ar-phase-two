import { describe, expect, it } from "vitest";
import { Document } from "@gltf-transform/core";
import { KHRMaterialsTransmission } from "@gltf-transform/extensions";
import { fixMaterials, triangulatePrimitives } from "./optimizeGlb";
import { Primitive } from "@gltf-transform/core";
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

describe("triangulatePrimitives", () => {
  it("drops line strips and converts triangle strips (office test, 3 Oct 2026)", () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    const pos = (n: number) => doc.createAccessor().setType("VEC3").setArray(new Float32Array(n * 3)).setBuffer(buf);
    const tri = doc.createPrimitive().setAttribute("POSITION", pos(3));
    const line = doc.createPrimitive().setAttribute("POSITION", pos(4)).setMode(Primitive.Mode.LINE_STRIP);
    const strip = doc.createPrimitive().setAttribute("POSITION", pos(4)).setMode(Primitive.Mode.TRIANGLE_STRIP);
    doc.createMesh().addPrimitive(tri).addPrimitive(line).addPrimitive(strip);

    expect(triangulatePrimitives(doc)).toEqual({ linesRemoved: 1, stripsConverted: 1 });
    const modes = doc.getRoot().listMeshes()[0].listPrimitives().map((p) => p.getMode());
    expect(modes.every((m) => m === Primitive.Mode.TRIANGLES)).toBe(true);
  });

  it("disposes meshes left empty (curve-only meshes)", () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    const line = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(6)).setBuffer(buf))
      .setMode(Primitive.Mode.LINE_STRIP);
    const mesh = doc.createMesh().addPrimitive(line);
    const node = doc.createNode().setMesh(mesh);
    triangulatePrimitives(doc);
    expect(doc.getRoot().listMeshes()).toHaveLength(0);
    expect(node.getMesh()).toBeNull();
  });
});
