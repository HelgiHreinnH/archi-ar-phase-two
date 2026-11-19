/**
 * Shared marker type used across the pipeline.
 * Each marker has a 1-based index, 3D coordinates (mm), and optional label.
 */
export type Vec3Tuple = [number, number, number];

export interface MarkerPoint {
  index: number;
  x: number;
  y: number;
  z: number;
  label?: string;
  /**
   * "rhino": read from the GLB's marker nodes (D18 — Rhino is the only source;
   * shown read-only). Absent: entered or pasted by hand (legacy files).
   */
  source?: "rhino";
  /** Distance between the node position and extras v2 `p`, mm (cross-check only). */
  extrasDeltaMm?: number;
  /** Sheet normal and up from extras v2 (Rhino frame, unit). Cross-check only, never the fit (D8). */
  n?: Vec3Tuple | null;
  up?: Vec3Tuple | null;
}

/** Extended color palette for up to 12 uniquely-colored markers */
export const MARKER_COLORS: { bg: string; name: string }[] = [
  { bg: "#FF3B30", name: "Red" },
  { bg: "#34C759", name: "Green" },
  { bg: "#007AFF", name: "Blue" },
  { bg: "#FF9500", name: "Orange" },
  { bg: "#AF52DE", name: "Purple" },
  { bg: "#FF2D55", name: "Pink" },
  { bg: "#5856D6", name: "Indigo" },
  { bg: "#00C7BE", name: "Teal" },
  { bg: "#FFD60A", name: "Yellow" },
  { bg: "#30B0C7", name: "Cyan" },
  { bg: "#A2845E", name: "Brown" },
  { bg: "#8E8E93", name: "Gray" },
];

/** Safe fallback when a color value is missing or malformed. */
export const FALLBACK_MARKER_COLOR = { bg: "#3B82F6", name: "Blue" } as const;

/**
 * Validate a CSS color string. Accepts:
 *   - "#RGB" / "#RRGGBB" hex
 *   - "rgb(r,g,b)" / "rgba(r,g,b,a)"
 * Returns the normalized "#RRGGBB" hex, or null if invalid.
 */
export function validateMarkerColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();

  // Hex form
  const hexMatch = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 3) {
      return ("#" + h.split("").map((c) => c + c).join("")).toUpperCase();
    }
    return ("#" + h).toUpperCase();
  }

  // rgb() / rgba() form
  const rgbMatch = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i);
  if (rgbMatch) {
    const [r, g, b] = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map((n) => parseInt(n, 10));
    if ([r, g, b].every((n) => n >= 0 && n <= 255)) {
      const toHex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  }

  return null;
}

/** Convert a normalized "#RRGGBB" hex into [r, g, b] numbers. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

/**
 * Get a guaranteed-safe color for a marker index (1-based).
 * Validates the palette entry and falls back if anything is malformed.
 */
export function getSafeMarkerColor(index: number): { bg: string; name: string } {
  const raw = getMarkerColor(index);
  const valid = validateMarkerColor(raw?.bg);
  if (!valid) return { ...FALLBACK_MARKER_COLOR };
  return { bg: valid, name: raw?.name || FALLBACK_MARKER_COLOR.name };
}

/** Get color for a marker index (1-based). Cycles palette for index > 12. */
export function getMarkerColor(index: number): { bg: string; name: string } {
  return MARKER_COLORS[(index - 1) % MARKER_COLORS.length];
}

/**
 * Convert legacy { A: {x,y,z,label}, B: ..., C: ... } format to MarkerPoint[].
 * Returns null if the input is not in legacy format.
 */
export function convertLegacyMarkerData(data: unknown): MarkerPoint[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, any>;
  const legacyKeys = ["A", "B", "C"];
  if (!legacyKeys.every((k) => d[k] && typeof d[k] === "object" && "x" in d[k])) return null;

  const indexMap: Record<string, number> = { A: 1, B: 2, C: 3 };
  return legacyKeys.map((k) => ({
    index: indexMap[k],
    x: Number(d[k].x) || 0,
    y: Number(d[k].y) || 0,
    z: Number(d[k].z) || 0,
    label: d[k].label || undefined,
  }));
}

const isTuple = (v: unknown): v is Vec3Tuple =>
  Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number" && Number.isFinite(c));

/** True when the markers came from the GLB (Rhino plugin) and must not be edited here (D18). */
export function markersFromRhino(markers: MarkerPoint[] | null | undefined): boolean {
  return !!markers?.length && markers.every((m) => m.source === "rhino");
}

/** Extras cross-check warnings stored with the markers (> 1 mm, contract §5.2). */
export function markerExtrasWarnings(markers: MarkerPoint[] | null | undefined, toleranceMm = 1): MarkerPoint[] {
  return (markers ?? []).filter((m) => typeof m.extrasDeltaMm === "number" && m.extrasDeltaMm > toleranceMm);
}

/**
 * Normalize raw marker_data from the database into MarkerPoint[].
 * Handles both array format and legacy {A,B,C} format.
 */
export function normalizeMarkerData(raw: unknown): MarkerPoint[] | null {
  if (!raw) return null;

  // Already an array
  if (Array.isArray(raw)) {
    const arr = raw as any[];
    if (arr.length < 3) return null;
    return arr
      .filter((p) => p && typeof p === "object" && "index" in p && "x" in p)
      .map((p) => {
        const out: MarkerPoint = {
          index: Number(p.index),
          x: Number(p.x) || 0,
          y: Number(p.y) || 0,
          z: Number(p.z) || 0,
          label: p.label || undefined,
        };
        if (p.source === "rhino") out.source = "rhino";
        if (typeof p.extrasDeltaMm === "number") out.extrasDeltaMm = p.extrasDeltaMm;
        if (isTuple(p.n)) out.n = p.n;
        if (isTuple(p.up)) out.up = p.up;
        return out;
      })
      .sort((a, b) => a.index - b.index);
  }

  // Try legacy format
  return convertLegacyMarkerData(raw);
}
