# MindAR — archived 18 Nov 2026

**Archived, not deleted.** This folder is a readable copy of the MindAR code that
used to run in Archi AR. It sits outside `src/`, so it is not built, linted or
tested, and nothing in the app imports it.

## Why it was parked

Decision 17 Nov 2026 (Helgi): 8th Wall is the primary and default engine in every
mode — Tabletop, Wall and Spatial. MindAR is image tracking only; its "lock" was a
gyro hold that sees rotation but not movement, so the model slid off its anchor as
soon as the phone moved. That showed in the Tabletop/Wall phone tests (15 Nov), and
the MindAR fallback was removed from Tabletop/Wall on 16 Nov. Spatial moved to 8th
Wall on 17 Nov (`SpatialWorldViewer.tsx` + `src/lib/spatial/adapter8thWall.ts`) and
was accepted on 18 Nov. Phase 3 (18 Nov) took the MindAR code out of `src/`.

Notion: "Decision: 8th Wall is the primary engine in all modes, MindAR is archived ·
17 Nov 2026" (under the Archi AR hub).

## What is here

Same paths as they had under the repo root:

| File | What it did |
|---|---|
| `src/components/ar/multipoint/MindARScene.tsx` | The MindAR + three.js scene: image targets, anchors, Procrustes placement, gyro hold, camera recovery |
| `src/components/ar/multipoint/MultipointViewer.tsx` | The Spatial client viewer around `MindARScene` (marker chips, launch ring, lock) |
| `src/components/ar/multipoint/MarkerPlacementValidator.tsx` | "Verify physical placement" — the architect's scan of printed markers against Rhino coordinates |
| `src/lib/compileMindFile.ts` + `src/workers/mindCompileCpu.worker.ts` | In-browser `.mind` compile of the marker images (CPU worker) |
| `src/lib/mindarEngine.ts` | Loads `mind-ar@1.2.5` (`mindar-image-three.prod.js`) from jsDelivr |
| `src/lib/sriError.ts` | Subresource-integrity check and error for the MindAR CDN script |
| `src/lib/arGyro.ts` | Gyro hold used by the MindAR "lock" |
| `src/lib/computeWorldTransform.ts` | Rhino-mm → anchor-space transform + Procrustes fit for the MindAR anchors |

Also removed from the app in phase 3 (see the branch for the originals): the
`mind-ar` dependency, its Vite `external`, the MindAR import-map entry and SRI
modulepreload in `index.html`, the "AR engine could not be verified" (sri-error)
screen in `ARViewer.tsx`, the `.mind` preload in `arPreload.ts`, the `.mind`
download and the ".wtc upload / Revert to MindAR" panel in `GenerateExperience.tsx`,
and the MindAR compiler preload in `ExperienceWizard.tsx`.

Data was not touched: `projects.mind_file_url` and `projects.tracking_format` stay
in the database, and existing `.mind` files stay in storage.

## Running the old system

Check out branch `archive/mindar` (commit `dbfa11f`, 17 Nov 2026). That is the last
`main` commit where Spatial ran on MindAR, with everything wired up. The files in
this folder will not compile on their own against current `main`.

Bringing MindAR back is a product decision — document it in Notion first.
