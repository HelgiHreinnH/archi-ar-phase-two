// @vitest-environment node
/**
 * Spatial contract (Notion, 19 Nov 2026) — §8 test 3 (sheet constants) and
 * test 4's letter half (D11). The JSON in contracts/ is what the Rhino plugin
 * copies; this file keeps the platform side equal to it.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXTRAS_KEY, EXTRAS_SPATIAL_VERSION, MARKER_LETTERS, MAX_MARKERS, SHEET_MM } from "./contract";
import { SPATIAL_MARKER_MM } from "./design";
import { CIRCLE_CENTRE_FROM_TOP, SHEET_H, SHEET_W, markerSheetSvg } from "./sheets";
import { markerIndexFromNodeName } from "@/lib/markerNames";

const ROOT = resolve(__dirname, "../../..");
const json = JSON.parse(readFileSync(resolve(ROOT, "contracts/spatial-contract.json"), "utf8"));

describe("spatial contract file", () => {
  it("contract.ts equals contracts/spatial-contract.json", () => {
    expect(MARKER_LETTERS).toBe(json.markerLetters);
    expect(MAX_MARKERS).toBe(json.maxMarkers);
    expect({ ...SHEET_MM }).toEqual(json.sheetMm);
    expect(EXTRAS_KEY).toBe(json.extras.key);
    expect(EXTRAS_SPATIAL_VERSION).toBe(json.extras.spatialVersion);
  });

  it("sheet constants: 210 × 297 mm, Ø180 circle, centre 105 mm from the top", () => {
    // Printed so a mismatch with the plugin's block definition is visible in the log.
    console.log(`[contract] sheet ${SHEET_W} × ${SHEET_H} mm · circle Ø${SPATIAL_MARKER_MM} · centre ${CIRCLE_CENTRE_FROM_TOP} mm from top`);
    expect([SHEET_W, SHEET_H, SPATIAL_MARKER_MM, CIRCLE_CENTRE_FROM_TOP]).toEqual([210, 297, 180, 105]);
  });

  it("the printed sheet puts the circle where the contract says", () => {
    const svg = markerSheetSvg(
      { index: 1, x: 0, y: 0, z: 0, projectName: "T", color: "#007AFF", shareUrl: "https://ar.felles.dk/ar/x" },
      "",
    );
    const r = SPATIAL_MARKER_MM / 2;
    // Disc group is translated to the circle's top-left corner: (cx − r, cy − r).
    expect(svg).toContain(`translate(${SHEET_W / 2 - r} ${CIRCLE_CENTRE_FROM_TOP - r})`);
    // Cut line sits as far below the centre as the top edge sits above it (210 × 210 card).
    expect(svg).toContain(`y1="${2 * CIRCLE_CENTRE_FROM_TOP}"`);
  });

  it("every letter A–T and number 1–20 maps to its index; nothing beyond", () => {
    [...MARKER_LETTERS].forEach((L, i) => {
      expect(markerIndexFromNodeName(`marker_${L}`)).toBe(i + 1);
      expect(markerIndexFromNodeName(`marker_${L.toLowerCase()}_proxy`)).toBe(i + 1);
      expect(markerIndexFromNodeName(`marker_${i + 1}`)).toBe(i + 1);
    });
    for (const n of ["marker_U", "marker_Z", "marker_0", "marker_21", "marker_AB"]) {
      expect(markerIndexFromNodeName(n), n).toBeNull();
    }
  });
});

/**
 * Local-only mirror check against the plugin source (~/Git/ArchiARMarkerTool,
 * not a git repo, so CI never has it). Reports drift; the plugin is changed
 * in its own session, never from here.
 */
const PLUGIN = resolve(ROOT, "../ArchiARMarkerTool/Libraries/archiar_core.py");
describe.skipIf(!existsSync(PLUGIN))("Rhino plugin mirror (local)", () => {
  const src = existsSync(PLUGIN) ? readFileSync(PLUGIN, "utf8") : "";
  const num = (name: string) => Number(src.match(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, "m"))?.[1]);
  const str = (name: string) => src.match(new RegExp(`^${name}\\s*=\\s*"([A-Z]*)"`, "m"))?.[1];

  it("plugin sheet constants equal the contract", () => {
    expect([num("SHEET_W_MM"), num("SHEET_H_MM"), num("SHEET_CIRCLE_MM"), num("SHEET_CIRCLE_FROM_TOP_MM")])
      .toEqual([SHEET_MM.w, SHEET_MM.h, SHEET_MM.circle, SHEET_MM.circleCentreFromTop]);
  });

  it("plugin LETTERS equal the contract; PARSER_LETTERS is a prefix of it", () => {
    expect(str("LETTERS")).toBe(MARKER_LETTERS);
    const parser = str("PARSER_LETTERS") ?? "";
    expect(MARKER_LETTERS.startsWith(parser)).toBe(true);
    if (parser !== MARKER_LETTERS) {
      console.warn(`[contract] plugin PARSER_LETTERS = "${parser}" — the platform reads "${MARKER_LETTERS}". Update the plugin (D11).`);
    }
  });
});
