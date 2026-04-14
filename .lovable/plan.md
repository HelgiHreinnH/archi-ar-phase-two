
# 8th Wall Migration — Implementation Status

## ✅ Completed

### Step 1: Database Migration
- Added `tracking_file_url TEXT` and `tracking_format TEXT DEFAULT 'mindar-mind'` to `projects` table

### Step 2: XR8Scene Component
- Created `src/components/ar/XR8Scene.tsx` — 8th Wall SLAM + Image Targets pipeline
- Mirrors MindARScene's state machine (tracking → locked) with variance gate, soft correction, gyro compensation
- Engine files expected at `/assets/xr8/xr8.js` and `/assets/xr8/xrextras.js`

### Step 3: ARDetection Engine Routing
- Updated `src/components/ar/ARDetection.tsx` to accept `trackingFormat` prop
- Routes to `XR8Scene` for `8thwall-wtc`, `MindARScene` for `mindar-mind` (default)

### Step 4: ARViewer Updates
- Added briefing screen between QR scan and camera launch
- Reads `tracking_format` from project data, passes to ARDetection
- Uses `tracking_file_url` as image target source for XR8 projects

### Step 5: Edge Function Update
- `get-public-project` now selects and signs `tracking_file_url`

### Step 6: .wtc Upload in Generate Experience
- Added .wtc file upload UI in the Downloads section (multipoint only)
- Uploads to `project-models/{projectId}/markers.wtc`
- Sets `tracking_format = '8thwall-wtc'` on the project
- Includes "Revert to MindAR" option

### Step 7: Bug Fixes
- Fixed GLTFLoader bare import in MindARScene (Bug 1) → full unpkg URL

## ⏳ Pending (User Action Required)

### Self-Host 8th Wall Engine
User needs to download and provide:
- XR8 engine from `github.com/8thwall/engine` → `public/assets/xr8/xr8.js`
- XRExtras from `github.com/8thwall/web` → `public/assets/xr8/xrextras.js`

### iOS SLAM Validation
Manual test on real iPhone required before production deployment.

### .wtc Compilation Workflow
V1 (current): Manual CLI compilation by architect
V2 (future): Vercel serverless function for automated compilation
