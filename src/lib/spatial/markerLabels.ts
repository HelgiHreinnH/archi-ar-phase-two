/** 1 → "A", 2 → "B", … 26 → "Z" (marker_A naming from Marker Tool 3.0). */
export function getMarkerLabel(index: number): string {
  return index >= 1 && index <= 26 ? String.fromCharCode(64 + index) : String(index);
}
