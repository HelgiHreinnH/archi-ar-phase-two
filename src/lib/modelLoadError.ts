/**
 * Multipoint finalize (Jul 2026): distinguishes a *runtime* 3D-model load
 * failure inside the AR scene from a camera-permission failure.
 *
 * Previously, when the GLB failed to load inside MindARScene (expired signed
 * URL, network drop, corrupt bytes), the catch block only logged a warning and
 * wired empty anchor callbacks. The client then saw markers being detected but
 * no model ever appearing — a silent dead-end with no recovery path.
 *
 * By throwing a typed error through `onError`, ARViewer can route the failure
 * to the existing `ModelUnavailableRecovery` flow (auto-retry + re-sign) instead
 * of the generic "camera access denied" screen.
 */
export class ModelLoadError extends Error {
  /** Optional underlying cause (parse error, fetch status, etc.). */
  public readonly cause?: unknown;

  constructor(message?: string, cause?: unknown) {
    super(message ?? "The 3D model could not be loaded.");
    this.name = "ModelLoadError";
    this.cause = cause;
  }
}
