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

/**
 * Orient, scale and offset a loaded GLB so it sits correctly on a single
 * printed QR, in "marker units" (1 unit = one QR width, markerSizeMm across).
 * The caller puts the model inside a group whose transform is the QR's pose
 * scaled so that 1 unit = the QR's width in the scene.
 *
 * Same maths as MindARScene's Effect B (kept identical on purpose, so both
 * engines place a model the same way). The target image spans local X/Y and
 * +Z points out of it:
 *  · wall     — the image is vertical, +Y already up: no tip, centred on QR.
 *  · tabletop — the image is horizontal, up is +Z: tip 90°, sit on the QR.
 */
export function placeModelOnQr(
  // three.js objects from the self-hosted runtime module (not the npm types).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T: any,
  opts: {
    mode: string;
    modelScale: number;
    initialRotation?: number;
    markerSizeMm: number;
    floatAboveMarker?: number;
  },
): ModelPlacement {
  const isTabletop = opts.mode === "tabletop";
  if (opts.initialRotation) {
    model.rotation.y = T.MathUtils.degToRad(opts.initialRotation);
  }
  model.rotation.x = isTabletop ? Math.PI / 2 : 0;
  model.updateMatrixWorld(true);

  const box = new T.Box3().setFromObject(model);
  const size = box.getSize(new T.Vector3());
  const center = box.getCenter(new T.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const placement = computeModelPlacement(maxDim, opts.markerSizeMm, opts.modelScale);
  const s = placement.scale;

  model.scale.set(s, s, s);
  model.position.x = -center.x * s;
  model.position.y = -center.y * s;
  model.position.z = isTabletop
    ? -box.min.z * s + (opts.floatAboveMarker ?? 0)
    : -center.z * s;
  return placement;
}
