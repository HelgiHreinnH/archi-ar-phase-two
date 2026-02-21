/**
 * Shared marker type used across the pipeline.
 * Each marker has a 1-based index, 3D coordinates (mm), and optional label.
 */
export interface MarkerPoint {
  index: number;
  x: number;
  y: number;
  z: number;
  label?: string;
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
      .map((p) => ({
        index: Number(p.index),
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        z: Number(p.z) || 0,
        label: p.label || undefined,
      }))
      .sort((a, b) => a.index - b.index);
  }

  // Try legacy format
  return convertLegacyMarkerData(raw);
}
