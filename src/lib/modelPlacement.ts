/**
 * How big a model should be drawn in a marker-anchored AR scene.
 *
 * In MindAR's anchor space one unit is one marker width (the printed QR is
 * MARKER_SIZE_MM across), so a model has to be scaled by its REAL size. The
 * old code normalised the model's largest dimension to a fixed number of
 * units, which made every model 150 marker widths — 22.5 m at 1:1 — so the
 * camera ended up inside it and nothing was visible.
 *
 * glTF is metres by specification, but Rhino writes the document's units, so
 * models often arrive in millimetres. A model whose largest dimension is 100
 * or more is treated as millimetres: 100 m is implausible for a room or a
 * building interior, while 100 mm is a plausible small object.
 */
export const UNIT_GUESS_THRESHOLD = 100;

export interface ModelPlacement {
  /** Multiplier from file units to anchor units (marker widths). */
  scale: number;
  /** 1 for a millimetre file, 1000 for a metre file. */
  unitMm: number;
  /** The model's real largest dimension, in metres. */
  realSizeM: number;
}

export function computeModelPlacement(
  maxDim: number,
  markerSizeMm: number,
  modelScale: number,
): ModelPlacement {
  const dim = maxDim > 0 ? maxDim : 1;
  const unitMm = dim < UNIT_GUESS_THRESHOLD ? 1000 : 1;
  const denominator = modelScale > 0 ? modelScale : 1;
  return {
    scale: unitMm / (markerSizeMm * denominator),
    unitMm,
    realSizeM: (dim * unitMm) / 1000,
  };
}
