// @vitest-environment node
import { describe, expect, it } from "vitest";
import { markerExtrasWarnings, markersFromRhino, normalizeMarkerData } from "./markerTypes";

describe("marker_data with the Rhino source (D18)", () => {
  const stored = [
    { index: 1, x: 0, y: 0, z: 1500, label: "Marker 1", source: "rhino", extrasDeltaMm: 0.002, n: [0, -1, 0], up: [0, 0, 1] },
    { index: 2, x: 3000, y: 0, z: 1500, label: "Marker 2", source: "rhino", extrasDeltaMm: 2.5, n: null, up: null },
    { index: 3, x: 1500, y: -800, z: 0, label: "Marker 3", source: "rhino" },
  ];

  it("keeps source, extras delta and n/up through normalisation", () => {
    const m = normalizeMarkerData(stored)!;
    expect(m[0]).toMatchObject({ source: "rhino", extrasDeltaMm: 0.002, n: [0, -1, 0], up: [0, 0, 1] });
    expect(m[1].n).toBeUndefined();
    expect(markersFromRhino(m)).toBe(true);
  });

  it("hand-entered or older stored markers stay editable", () => {
    const legacy = stored.map(({ source: _s, ...rest }) => rest);
    expect(markersFromRhino(normalizeMarkerData(legacy))).toBe(false);
    expect(markersFromRhino(null)).toBe(false);
    // A mix (someone edited one row by hand in an older build) is not treated as Rhino-owned.
    expect(markersFromRhino(normalizeMarkerData([stored[0], stored[1], { ...stored[2], source: undefined }]))).toBe(false);
  });

  it("flags markers whose node and extras p differ by more than 1 mm", () => {
    expect(markerExtrasWarnings(normalizeMarkerData(stored)).map((m) => m.index)).toEqual([2]);
  });
});
