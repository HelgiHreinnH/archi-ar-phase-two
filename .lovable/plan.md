

# Updated Plan: Model Upload System with 250 MB Limit

## Change from Previous Plan

The maximum file upload size is now **250 MB** instead of 50 MB. This comfortably covers most architectural models (residential through commercial) without requiring Draco compression, though optimization tips will still be offered as best practice.

## What Gets Built

### New Components

**`src/components/ModelUploader.tsx`**
- Drag-and-drop zone accepting GLB and USDZ files
- Client-side validation: file type + 250 MB size limit
- Real-time progress bar via Supabase Storage `onUploadProgress`
- "Don't close this tab" warning during upload
- Retry button on failure
- If file exceeds 250 MB, show a helpful message with optimization tips (Draco compression, texture reduction)

**`src/components/UploadProgress.tsx`**
- Reusable progress bar showing percentage, uploaded/total size (e.g., "47 MB / 128 MB"), and estimated time
- Cancel button during upload

**`src/components/ModelPreview.tsx`**
- Displays uploaded model info: file name, human-readable size, format badge (GLB/USDZ), upload date
- Download and replace/delete options

### Modified Files

**`src/pages/ProjectDetail.tsx`**
- Replace the static "Upload Model" placeholder with the functional `ModelUploader` and `ModelPreview` components

**`src/pages/ProjectsList.tsx`**
- Add model status badge on each project card: "No model", "Uploading...", "Ready"

**`src/hooks/useProjects.ts`**
- Add optimistic update logic for project creation

### Technical Details

- **Max size constant**: Single `MAX_FILE_SIZE_MB = 250` constant for easy future adjustment
- **Storage path**: `project-models/{project_id}/{filename}` in the existing `project-models` bucket
- **Database**: After upload, update the project's `model_url` column with the storage path
- **Accepted formats**: `.glb` (model/gltf-binary) and `.usdz` (model/vnd.usdz+zip)
- **No new dependencies** -- uses existing Supabase SDK, React state, and the Progress UI component

