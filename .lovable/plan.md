

# Redesign: Step-by-Step Experience Creation Wizard

## The Problem

Currently, users face two disconnected screens:

1. **NewProject page** -- collects all metadata + mode + config in one long form, then dumps users onto...
2. **ProjectDetail page** -- a dashboard of cards (Info, Model, Markers, Generate) all shown at once with no guidance on what to do first

This creates cognitive overload. The user sees everything simultaneously and has no sense of progress.

## The Proposed Flow

Replace the current two-page setup with a **single guided wizard** on the ProjectDetail page. The NewProject page becomes minimal (just name + mode), and the ProjectDetail page becomes a **step-by-step workflow** with clear progress.

```text
+------------------+     +------------------------------------------+
| New Experience   |     | Project Detail (Step-by-Step)             |
| (Simplified)     |     |                                          |
|                  |     |  [1]---[2]---[3]---[4]  Progress bar      |
| - Name *         | --> |                                          |
| - Mode selection |     |  Step content area                       |
| - Create button  |     |  (one step visible at a time)             |
+------------------+     |                                          |
                          |  [ Back ]           [ Continue ]          |
                          +------------------------------------------+
```

### Step Breakdown

**Step 1: Experience Details** (light, quick)
- Client name, location, description
- Mode-specific config (scale/QR size for Tabletop)
- Why first: low effort, gets the user invested in the project context

**Step 2: Upload 3D Model**
- The existing ModelUploader component (drag-and-drop)
- Shows ModelPreview once uploaded
- Why second: this is the core asset; everything else depends on it

**Step 3: Set Up Markers** (mode-dependent)
- Tabletop: a simple confirmation/summary (scale + rotation preview) -- essentially a review since config was set in Step 1
- Multi-Point: the full MarkerCoordinateEditor with JSON paste and triangle quality
- Why third: spatial setup only makes sense after you have a model to anchor

**Step 4: Generate and Share**
- Readiness checklist (auto-checks previous steps)
- "Generate AR Experience" button
- Once generated: share link, QR code download, marker sheets download
- Why last: this is the output -- everything before is preparation

### UI Details

- **Progress indicator** at the top: numbered circles connected by lines, filled/colored as steps complete
- **Step content** renders one step at a time in a single Card
- **Navigation**: "Back" and "Continue" buttons at bottom. "Continue" is disabled until the step's requirement is met (e.g., model uploaded)
- **Steps remain accessible**: clicking a completed step number jumps back to it (non-linear navigation allowed for editing)
- Steps auto-advance only on first visit; returning users land on the first incomplete step

### What Changes vs. Today

| Area | Before | After |
|------|--------|-------|
| NewProject page | Long form (name, client, location, description, mode, config) | Minimal: name + mode only |
| ProjectDetail page | All cards visible at once | One step shown at a time with progress bar |
| Navigation | No guidance | Clear Back/Continue with disabled states |
| First impression | Overwhelming dashboard | Focused single task |

## Technical Plan

### 1. Simplify `NewProject.tsx`
- Remove client_name, location, description, and tabletop config fields
- Keep only: mode selection cards + experience name + create button
- On create, navigate to ProjectDetail which starts at Step 1

### 2. Create `src/components/ExperienceWizard.tsx`
- New component that manages the step state
- Props: project data, current step, callbacks
- Contains the step progress bar UI and Back/Continue navigation
- Renders the correct step content based on current step index

### 3. Create `src/components/wizard/StepDetails.tsx`
- Experience details form (client name, location, description)
- Tabletop-specific config (scale, QR size, rotation) if mode is tabletop
- Auto-saves on "Continue" click

### 4. Create `src/components/wizard/StepModel.tsx`
- Wraps existing ModelUploader and ModelPreview
- "Continue" enabled when model is uploaded

### 5. Create `src/components/wizard/StepMarkers.tsx`
- For multipoint: wraps existing MarkerCoordinateEditor
- For tabletop: shows a summary/review of tabletop settings with an edit option
- "Continue" enabled when markers are valid (multipoint) or always (tabletop)

### 6. Create `src/components/wizard/StepGenerate.tsx`
- Wraps existing GenerateExperience logic
- Shows checklist, generate button, and downloads section
- This is the final step -- no "Continue" button, replaced with the generate action

### 7. Refactor `ProjectDetail.tsx`
- Replace the current grid of cards with ExperienceWizard
- Keep the header (project name, mode badge, status)
- Determine initial step: find the first incomplete step on load

### 8. Create `src/components/wizard/StepProgress.tsx`
- Visual step indicator: numbered circles connected by lines
- Clickable steps for completed ones
- Color-coded: completed (green), current (blue/primary), future (gray)

### Files Modified
- `src/pages/NewProject.tsx` -- simplify
- `src/pages/ProjectDetail.tsx` -- replace card grid with wizard

### Files Created
- `src/components/ExperienceWizard.tsx`
- `src/components/wizard/StepProgress.tsx`
- `src/components/wizard/StepDetails.tsx`
- `src/components/wizard/StepModel.tsx`
- `src/components/wizard/StepMarkers.tsx`
- `src/components/wizard/StepGenerate.tsx`

### Files Unchanged (reused as-is)
- `src/components/ModelUploader.tsx`
- `src/components/ModelPreview.tsx`
- `src/components/MarkerCoordinateEditor.tsx`
- `src/components/GenerateExperience.tsx`

No database changes required.

