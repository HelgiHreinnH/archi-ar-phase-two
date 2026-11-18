// @vitest-environment node
import { describe, expect, it } from "vitest";
import { markerDiscSvg, escapeXml, SPATIAL_MARKER_MM } from "@/lib/spatial/design";
import { spatialQrSvg } from "@/lib/spatial/qr";
import { markerSheetSvg, qrPageSvg } from "@/lib/spatial/sheets";

const URL_ = "https://ar.felles.dk/ar/3f2a9c1e-7b44-4d0a-9e1b-5c2d8a6f1e90";
const base = { index: 3, x: 100, y: -20, z: 1200, projectName: "Test", shareUrl: URL_ };

describe("spatial design", () => {
  it("escapes XML in project names and labels", () => {
    const svg = markerSheetSvg({ ...base, projectName: 'A & <B> "C"', color: "#007AFF" }, "");
    expect(svg).toContain("A &amp; &lt;B&gt; &quot;C&quot;");
    expect(svg).not.toContain("<B>");
    expect(escapeXml("<&>")).toBe("&lt;&amp;&gt;");
  });

  it("marker circle is unique per index, deterministic, colourless and text-free", () => {
    expect(markerDiscSvg(1)).not.toBe(markerDiscSvg(2));
    expect(markerDiscSvg(4)).toBe(markerDiscSvg(4));
    const svg = markerDiscSvg(3);
    expect(svg).not.toContain("<text");
    expect(svg).not.toMatch(/#(?!fff|000)[0-9a-f]{6}/i);
    expect(svg.match(/Q/g)!.length).toBeGreaterThan(200);
  });

  it("marker sheet prints POINT n, the coordinates, model name and a Ø180 mm circle", () => {
    const svg = markerSheetSvg({ ...base, color: "#007AFF" }, "");
    expect(svg).toContain(">POINT<");
    expect(svg).toContain(">3</text>");
    expect(svg).toContain(">Test</text>");
    expect(svg).toContain(">100 <");
    expect(svg).toContain("CIRCLE Ø 180 MM");
    expect(svg).toContain(`scale(${SPATIAL_MARKER_MM / 1200})`);
    expect(SPATIAL_MARKER_MM).toBe(180);
  });

  it("number sits on the same centre line as the logo, the circle is centred above the cut line", () => {
    const svg = markerSheetSvg({ ...base, color: "#007AFF" }, "");
    expect(svg).toMatch(/<rect x="155\.7\d*" y="10\.6\d*"|<rect x="155\.8\d*" y="10\.6\d*"/); // logo tile centred on y = 15
    expect(svg).toContain("translate(15 15)"); // circle Ø180 centred on (105, 105)
  });

  it("light marker colours (yellow) get a darkened number, never the raw colour", () => {
    const yellow = markerSheetSvg({ ...base, color: "#FFD60A" }, "");
    expect(yellow).not.toContain('fill="#FFD60A">3');
  });

  it("truncates very long model names", () => {
    const svg = markerSheetSvg({ ...base, projectName: "x".repeat(60), color: "#007AFF" }, "");
    expect(svg).toContain(`${"x".repeat(25)}…`);
    expect(svg).not.toContain("x".repeat(26));
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
