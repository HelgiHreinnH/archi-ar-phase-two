/**
 * The camera itself could not start inside the 8th Wall viewer (permission
 * denied, camera in use, no rear camera) — as opposed to the AR engine failing.
 *
 * Tabletop/Wall have had no second engine since 16 Nov 2026, so ARViewer has to
 * tell the two apart: a camera failure goes to the "Camera Access Required"
 * screen, an engine failure to AREngineUnavailable.
 */
export class CameraStartError extends Error {
  constructor(reason?: string) {
    super(`Camera could not start${reason ? ` (${reason})` : ""}.`);
    this.name = "CameraStartError";
  }
}
