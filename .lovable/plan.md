
# Tabletop Two-Marker System: QR Code + AR Reference Image

## Problem

The current tabletop flow uses the QR code as both the launch link AND the MindAR tracking target. This is fundamentally broken because:

1. QR codes are designed to encode URLs — their visual appearance is defined by URL content, not by feature richness for computer vision tracking
2. The client scans the QR to reach the web app, then must point the camera at that same QR code to trigger AR — but the tiny printed QR is a poor, unreliable tracking target
3. There is no separation of concerns between "how to launch the experience" and "what to track in AR"

## Correct Flow (After Fix)

```text
GENERATE  → QR Code (links to /view/shareId)
          → AR Reference Image (dedicated tracking target, human-friendly pattern)
          → .mind file compiled from AR Reference Image only

CLIENT    → Prints QR Code sheet + AR Reference Image sheet
          → Scans QR Code with phone camera → opens AR landing page
          → Taps "Launch AR" → camera activates
          → Points camera at AR Reference Image → model appears
```

## What Changes

### 1. New AR Reference Image Generator (`src/lib/generateTabletopMarker.ts`)

A new function that generates a high-contrast, feature-rich 1200x1200px image specifically designed for MindAR detection. Unlike the coloured multipoint markers, this uses a black-and-white pattern with:
- Bold geometric shapes (concentric squares, diagonal lines, circles, crosses)
- Project name and "AR MARKER" label for human readability
- High contrast — white on black or black on white — for reliable detection in varied lighting
- Unique corner features to help MindAR establish orientation

This image becomes the `.mind` compilation source for tabletop mode.

### 2. Generation Pipeline (`src/components/GenerateExperience.tsx`)

Update the tabletop branch of `handleGenerate` to:
1. Generate the AR reference image (canvas → blob)
2. Upload it to `project-assets/{projectId}/ar_reference.png`
3. Store the public URL (saved into `marker_image_urls` as `{ "tabletop": url }` so no schema change is needed)
4. Compile the `.mind` file from the AR reference image (NOT the QR code anymore)
5. Continue uploading QR code and `.mind` file as before

The QR code remains unchanged — it still encodes the share URL.

### 3. Downloads Section (`src/components/GenerateExperience.tsx` and `src/components/ProjectOverview.tsx`)

Add a second download button for tabletop mode:
- **QR Code** — unchanged, downloads the share link QR
- **AR Reference Image** — downloads the branded tracking marker image (new)
- **Print Sheet PDF** — a combined A4 PDF showing both images side-by-side with instructions (new, optional — see below)

### 4. Tabletop Print Sheet PDF (`src/lib/generateTabletopPDF.ts`)

A new PDF generator for tabletop mode (equivalent to the multipoint marker PDFs). A4 portrait layout:
- Header bar (project name)
- **Left column**: QR code with label "Scan to launch AR"
- **Right column**: AR Reference Image with label "Point camera here"
- Instructions section explaining the two-step process
- Footer branding

This gives clients a single printable sheet that explains the full workflow.

### 5. ARViewer / ARDetection (no change needed)

The AR viewer already reads `mind_file_url` from the project and passes it to MindARScene. Since we're now compiling the `.mind` file from the AR reference image instead of the QR code, MindAR will correctly track the reference image. No viewer code changes required.

## Technical Details

### Database (no migration needed)

The `marker_image_urls` column (JSONB) already exists and is used for multipoint markers. For tabletop, we store `{ "tabletop": "<url>" }` — the same column, different key. No schema change required.

### AR Reference Image Design

The image must be MindAR-friendly:
- Minimum 512x512px recommended; we'll use 1200x1200px
- High contrast (black/white preferred over color for reliability)
- Rich local features — avoid large uniform areas
- Unique enough to distinguish from background environments

The generator will draw: outer border, inner concentric square, diagonal corner lines, a central compass-style cross, circular dots at feature points, and clear text labels.

### Files to Create / Edit

- **Create** `src/lib/generateTabletopMarker.ts` — canvas-based AR reference image generator
- **Create** `src/lib/generateTabletopPDF.ts` — A4 print sheet PDF for tabletop projects
- **Edit** `src/components/GenerateExperience.tsx` — update tabletop pipeline + downloads section
- **Edit** `src/components/ProjectOverview.tsx` — add AR reference image download button for tabletop mode

### No changes to:
- `MindARScene.tsx` — already reads `imageTargetSrc` from `mind_file_url`
- `ARViewer.tsx` — already passes `mind_file_url` through
- `ARDetection.tsx` — unchanged
- Database schema — no migration needed
