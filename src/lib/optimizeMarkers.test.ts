// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// Pure file processing — no DOM needed, and jsdom drags in `canvas` native bindings.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { modelStats, optimizeDocument } from "./optimizeGlb";
import { isMarkerNodeName, removeMarkerCarriers } from "./markerNames";
import { parseGlbMarkers } from "./parseGlbMarkers";

/**
 * "Optimize for AR" must be safe for Spatial models (16 Nov 2026). The Rhino
 * plugin told architects to switch it off, because join() merged the three
 * marker spheres into one node. Fixture and ground truth: see
 * parseGlbMarkers.test.ts.
 */
const EXPECTED = [
  { index: 1, x: -200, y: 775.81, z: 1500 },
  { index: 2, x: 2800, y: 775.81, z: 1500 },
  { index: 3, x: 1300, y: -300, z: -199 },
];

async function optimiseFixture() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  const bytes = readFileSync(resolve(__dirname, "../test/fixtures/marker-layers.glb"));
  const doc = await io.readBinary(new Uint8Array(bytes));
  // The fixture predates the plugin: its spheres carry three layer colours.
  // Plugin exports (v0.2.0) give every sphere the same invisible material,
  // which is exactly what made join() merge them into one node.
  const proxy = doc.createMaterial("ArchiAR_marker_proxy").setAlphaMode("BLEND").setBaseColorFactor([1, 1, 1, 0]);
  for (const node of doc.getRoot().listNodes()) {
    if (!isMarkerNodeName(node.getName())) continue;
    for (const prim of node.getMesh()?.listPrimitives() ?? []) prim.setMaterial(proxy);
  }
  const before = modelStats(doc);
  await optimizeDocument(doc, { encoder: MeshoptEncoder, simplifier: MeshoptSimplifier });
  return { doc, before, out: await io.writeBinary(doc) };
}

describe("isMarkerNodeName", () => {
  it("matches what the marker parser reads", () => {
    for (const n of ["marker_A", "marker_c_proxy", "Marker-B_proxy", "marker 3", "marker_12_proxy"]) {
      expect(isMarkerNodeName(n), n).toBe(true);
    }
    for (const n of ["", "Default", "marker", "markers_A", "marker_AB", "marker_A_proxy_2", "worktop_marker_A"]) {
      expect(isMarkerNodeName(n), n).toBe(false);
    }
  });
});

describe("removeMarkerCarriers", () => {
  it("detaches marker nodes from a preview scene and nothing else", () => {
    const make = (name: string, children: any[] = []) => {
      const o: any = { name, children, parent: null as any };
      o.traverse = (fn: (x: any) => void) => { fn(o); for (const c of [...o.children]) c.traverse(fn); };
      o.remove = (c: any) => { o.children = o.children.filter((x: any) => x !== c); c.parent = null; };
      for (const c of children) c.parent = o;
      return o;
    };
    const cabinet = make("cabinet");
    const root = make("Scene", [make("Default", [cabinet]), make("marker_A", [make("marker_A_proxy")]), make("marker_C_proxy")]);
    // Layer node and its sphere are both matched; removing the layer takes the sphere with it.
    expect(removeMarkerCarriers(root)).toBe(3);
    expect(root.children.map((c: any) => c.name)).toEqual(["Default"]);
    expect(cabinet.parent.name).toBe("Default");
  });
});

describe("optimizeDocument on a Spatial model", () => {
  it("keeps one node per marker and still merges the rest", async () => {
    const { doc, before } = await optimiseFixture();
    const names = doc.getRoot().listNodes().map((n) => n.getName()).filter(isMarkerNodeName).sort();
    expect(names).toEqual(["marker_A_proxy", "marker_B_proxy", "marker_C_proxy"]);
    // The model itself is still merged: far fewer parts than Rhino wrote.
    expect(modelStats(doc).primitives).toBeLessThan(before.primitives);
  });

  it("gives the same marker coordinates when the optimised file is read again", async () => {
    const { out } = await optimiseFixture();
    const file = new File([out], "optimised.glb", { type: "model/gltf-binary" });
    const markers = await parseGlbMarkers(file);

    expect(markers).not.toBeNull();
    expect(markers).toHaveLength(3);
    for (const want of EXPECTED) {
      const got = markers!.find((m) => m.index === want.index)!;
      // Within 1 mm: simplify + 16-bit quantisation on a 15 mm sphere.
      expect(Math.abs(got.x - want.x), `marker ${want.index} x`).toBeLessThan(1);
      expect(Math.abs(got.y - want.y), `marker ${want.index} y`).toBeLessThan(1);
      expect(Math.abs(got.z - want.z), `marker ${want.index} z`).toBeLessThan(1);
    }
  });
});
