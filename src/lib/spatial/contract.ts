/**
 * Spatial system contract — the values the Rhino plugin and the platform must
 * share (Notion "Spatial system contract", 19 Nov 2026: §3 sheet, §5 GLB, D11).
 *
 * Mirrors `contracts/spatial-contract.json`, which the plugin copies.
 * `contract.test.ts` fails if this file and the JSON drift apart.
 */

/** marker_A … marker_T → 1 … 20 (D11). Same order as the plugin's LETTERS. */
export const MARKER_LETTERS = "ABCDEFGHIJKLMNOPQRST";
/** Naming-scheme extent (marker_1 … marker_20). Not a tracking limit (D13, D19). */
export const MAX_MARKERS = MARKER_LETTERS.length;

/** A4 Spatial marker sheet v11, millimetres (§3). */
export const SHEET_MM = {
  /** Sheet width. */
  w: 210,
  /** Sheet height. */
  h: 297,
  /** Printed circle diameter = 8th Wall physicalWidthInMeters × 1000. */
  circle: 180,
  /** Circle centre (= the coordinate) below the sheet's top edge. */
  circleCentreFromTop: 105,
} as const;

/** asset.extras.<key> written by the plugin's Spatial export (§5.2). */
export const EXTRAS_KEY = "archiar";
export const EXTRAS_SPATIAL_VERSION = 2;
