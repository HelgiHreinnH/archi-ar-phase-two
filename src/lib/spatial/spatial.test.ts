// @vitest-environment node
import { describe, expect, it } from "vitest";
import { markerDiscSvg, escapeXml, INK } from "@/lib/spatial/design";
import { spatialQrSvg } from "@/lib/spatial/qr";
import { markerSheetSvg, qrPageSvg } from "@/lib/spatial/sheets";

const URL_ = "https://ar.felles.dk/ar/3f2a9c1e-7b44-4d0a-9e1b-5c2d8a6f1e90";
const base = { index: 3, x: 100, y: -20, z: 1200, projectName: "Test", shareUrl: URL_ };

describe("spatial design", () => {
  it("escapes XML in project names and labels", () => {
    const svg = markerSheetSvg({ ...base, label: 'A & <B> "C"', color: "#007AFF" }, "");
    expect(svg).toContain("A &amp; &lt;B&gt; &quot;C&quot;");
    expect(svg).not.toContain("<B>");
    expect(escapeXml("<&>")).toBe("&lt;&amp;&gt;");
  });

  it("marker disc is unique per index (rotation and number)", () => {
    expect(markerDiscSvg(1, "#007AFF")).not.toBe(markerDiscSvg(2, "#007AFF"));
    expect(markerDiscSvg(4, "#007AFF")).toBe(markerDiscSvg(4, "#007AFF"));
  });

  it("marker sheet prints the coordinates, point pill and 150 mm disc", () => {
    const svg = markerSheetSvg({ ...base, color: "#007AFF" }, "");
    expect(svg).toContain("POINT 3");
    expect(svg).toContain(">100 <");
    expect(svg).toContain(`scale(${150 / 1200})`);
  });

  it("uses dark text on light marker colours (yellow) and white on dark ones", () => {
    const yellow = markerSheetSvg({ ...base, color: "#FFD60A" }, "");
    const blue = markerSheetSvg({ ...base, color: "#007AFF" }, "");
    expect(yellow).toContain(`fill="${INK}">POINT 3`);
    expect(blue).toContain('fill="#fff">POINT 3');
  });

  it("round QR carries arcs, subtle QR does not", () => {
    const round = spatialQrSvg(URL_, "round");
    const subtle = spatialQrSvg(URL_, "subtle");
    expect(round.match(/stroke-linecap="round"/g)!.length).toBeGreaterThan(20);
    expect(subtle).not.toContain("stroke-opacity");
    expect(round.length).toBeGreaterThan(subtle.length);
  });

  it("QR page has three steps and no outline frames", () => {
    const svg = qrPageSvg({ projectName: "Test", shareUrl: URL_ }, "");
    expect(svg).toContain("SCAN ME");
    expect(svg).toContain(">Scan<");
    expect(svg).not.toContain('x="6" y="6"');
  });
});
