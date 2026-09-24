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
  /**
   * Size of the model as it appears on the QR, in metres (width, depth,
   * height — plan X, plan Y, up), i.e. real size divided by the scale. Only
   * set by placeModelOnQr; shown to the viewer so the scale can be checked.
   */
  displayedSizeM?: { width: number; depth: number; height: number };
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
 * World-space bounding box of a loaded model, measured from its real vertices.
 *
 * Why not just `new Box3().setFromObject(model)`: GLTFLoader seeds every
 * geometry's bounding box from the POSITION accessor's min/max in the file,
 * and exporters get those wrong. Fændediget 12 (Rhino, Draco, 24 Sep 2026) had
 * 12,209 of 49,808 primitives with min > max on one axis. three treats such a
 * box as empty, so Box3.applyMatrix4 skips it and the RAW, untransformed
 * corners are unioned in — after the tabletop tip the box ran 24 m below the
 * table and the model was placed far off the QR. Recomputing each geometry's
 * box from its decoded vertices makes the measurement independent of what the
 * exporter wrote. Every place that centres or frames a model uses this.
 */
export function measureModel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seen = new Set<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model.traverse((o: any) => {
    const g = o.geometry;
    if (!g || seen.has(g) || !g.attributes?.position) return;
    seen.add(g);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  });
  model.updateMatrixWorld(true);
  return new T.Box3().setFromObject(model);
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
 *
 * Universal rule (all modes, all GLBs): the centre of the model's bounding box
 * in plan (Rhino X/Y) lands on the centre of the QR, wherever the model sits
 * in the Rhino file. Tabletop: the bottom of the box sits on the QR.
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
  const box = measureModel(model, T);
  const size = box.getSize(new T.Vector3());
  const center = box.getCenter(new T.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const placement = computeModelPlacement(maxDim, opts.markerSizeMm, opts.modelScale);
  const s = placement.scale;

  // Metres on the QR = file units × (mm per unit) / 1000 / scale denominator.
  const toShownM = placement.unitMm / 1000 / (opts.modelScale > 0 ? opts.modelScale : 1);
  placement.displayedSizeM = isTabletop
    ? { width: size.x * toShownM, depth: size.y * toShownM, height: size.z * toShownM }
    : { width: size.x * toShownM, depth: size.z * toShownM, height: size.y * toShownM };

  model.scale.set(s, s, s);
  model.position.x = -center.x * s;
  model.position.y = -center.y * s;
  model.position.z = isTabletop
    ? -box.min.z * s + (opts.floatAboveMarker ?? 0)
    : -center.z * s;
  return placement;
}
