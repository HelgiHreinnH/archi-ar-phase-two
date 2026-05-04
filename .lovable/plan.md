
# Markers-Only Placement (No Anchor Point)

Per the Notion brief, the multipoint experience should treat all markers as equal **Reference Points** and only show the model after the Procrustes lock fires. The triangulation algorithm already supports this — the change is deliberately small and concentrated in two surfaces: the AR scene rendering and the marker editor UI.

## Scope

### 1. Hide model until lock fires (AR scenes)

**`src/components/ar/MindARScene.tsx`**
- After loading the GLB and adding it to `anchor.group` (line ~329), set `model.visible = false`.
- Inside `lockModel(...)` (line ~446), set `model.visible = true` as the first action so the first frame the user sees is the correctly-placed frame.
- Keep all existing tracking/variance/pose-recording logic intact — only the visibility changes. The model still rides anchor 0 invisibly during the scanning phase so its world matrix continues to be valid; visibility flips on at lock time.

**`src/components/ar/XR8Scene.tsx`**
- Same pattern: hide `modelRef` after attaching it to `anchorGroups[0]`, flip `modelRef.visible = true` inside `lockModel(...)` (line ~277).
- Note: anchor *group* visibility is already toggled per-marker for the marker dots; the model itself needs an independent flag so it stays hidden across all marker visibility transitions during scanning.

### 2. Relabel "Anchor Point" → "Reference Point"

**`src/components/MarkerCoordinateEditor.tsx`**
- Line 28: change `label: "Anchor Point"` → `label: "Reference Point"` in `DEFAULT_MARKERS`.
- All three default markers now read "Reference Point", reinforcing that no marker is special.
- No other copy in this file references the anchor concept.

**`src/components/wizard/StepMarkers.tsx`**
- Helper text already reads "where the AR model anchors in real space" — reword to "These define the reference frame the AR model is placed within." Removes the implication that the model attaches to a single marker.

### 3. Verify no other UI implies an anchor

Spot-checks for copy that needs updating:
- `src/components/how-it-works/stepsData.ts` — review for "anchor"/"origin marker" phrasing.
- `src/components/ar/ARLanding.tsx` and `ARDetection.tsx` — review on-screen instructional copy.
- `src/lib/generateMarkerPDF.ts` — printed PDF instructions: replace any "Marker 1 = origin / place at model footprint" wording with neutral reference-marker language.

Any matches get reworded to talk about reference markers defining a coordinate frame, never about an origin or anchor.

## What does NOT change

- `computeWorldTransform.ts` — Procrustes algorithm is already symmetric across markers.
- `parseGlbMarkers.ts` — marker parsing untouched.
- Database schema — no migration needed; `marker_data` already stores N markers as equals.
- Variance gate, occlusion grace period, soft correction, gyro compensation — all untouched.
- Tabletop single-marker mode — fully unchanged.
- Marker color identity, indices, PDF generation pipeline — unchanged.

## Technical notes

- The reason to keep the model parented to `anchor.group` (rather than detaching it) during the invisible phase is that `anchor.group.matrix` is what feeds `recordPose(0, ...)` for the variance gate. Re-parenting would require a wider refactor of the tracking loop. Hiding via `.visible = false` is a one-flag change that fully solves the "model floats then teleports" UX issue described in the brief.
- For XR8 the `lockModel` function moves the model from `anchorGroups[0]` to scene root (line 281). Setting `model.visible = true` *after* the re-parent ensures the first rendered frame is at the locked world position, never at the anchor-group position.
- No new dependencies, no edge function changes, no Supabase changes.

## Files touched

- `src/components/ar/MindARScene.tsx` — 2-line edit
- `src/components/ar/XR8Scene.tsx` — 2-line edit
- `src/components/MarkerCoordinateEditor.tsx` — 1-string edit
- `src/components/wizard/StepMarkers.tsx` — 1-string edit
- `src/components/how-it-works/stepsData.ts` — copy review (likely 1–2 strings)
- `src/lib/generateMarkerPDF.ts` — copy review (likely 1–2 strings)
- `mem://features/multipoint-placement` — new memory documenting the markers-only model

## Out of scope (future, per brief)

Placement quality score, session persistence, multi-device sharing, named markers, survey integration. The brief explicitly frames these as enabled by — but not part of — this change.
