/**
 * AR engines on the platform.
 *
 * Decision 17 Nov 2026 (Helgi): 8th Wall is the engine in every mode —
 * Tabletop, Wall and Spatial. MindAR development is parked and MindAR is
 * archived, not deleted:
 *  - branch `archive/mindar` (dbfa11f) is the last `main` commit where Spatial
 *    ran on MindAR — check it out to run the old system;
 *  - `archive/mindar/` at the repo root holds a readable copy of the MindAR
 *    source (outside `src/`, so it is not built, linted or tested).
 *
 * 17 Nov the MindAR entry points were switched off behind a flag; 18 Nov
 * (phase 3) the code itself left `src/` and the `mind-ar` dependency was
 * removed. `arEngines.test.ts` fails if MindAR comes back into the app.
 * Bringing it back is a deliberate, documented decision, not a code change.
 */

/** Tracking format written for new Spatial experiences: 8th Wall builds one
 *  image target per uploaded marker PNG at view time (SpatialWorldViewer), as
 *  Tabletop/Wall do with the QR, so no compiled target file is stored. */
export const SPATIAL_TRACKING_FORMAT = "8thwall-image";
