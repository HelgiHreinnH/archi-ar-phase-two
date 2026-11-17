/**
 * Which AR engines the platform may call.
 *
 * Decision 17 Nov 2026 (Helgi): 8th Wall is the primary and default engine in
 * every mode — Tabletop, Wall and Spatial. MindAR development is parked and
 * MindAR is archived, not deleted (branch `archive/mindar`, the last `main`
 * commit where Spatial ran on MindAR).
 *
 * Test-phase rule (same day): while Helgi tests, he must be testing 8th Wall.
 * MindAR must not be called at any time — not in the client viewer, not in
 * the wizard's placement check, not at generation (.mind compile), and not
 * through a preload in index.html. Every MindAR entry point checks this flag,
 * and `arEngines.test.ts` fails if any of them is switched back on.
 *
 * Do not flip this to true. If MindAR is ever needed again, restore it from
 * `archive/mindar` as a deliberate, documented decision.
 */
export const MINDAR_ENABLED: boolean = false;

/** Tracking format written for new Spatial experiences: 8th Wall builds its
 *  image targets from the uploaded marker PNGs at runtime (as Tabletop/Wall do
 *  with the QR), so no compiled target file is stored. */
export const SPATIAL_TRACKING_FORMAT = MINDAR_ENABLED ? "mindar-mind" : "8thwall-image";
