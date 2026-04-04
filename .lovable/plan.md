

## Security Fix Plan — Deep Analysis

### Current State

A fresh security scan confirms only **1 real issue** from the Supabase scanner: Leaked Password Protection Disabled. The other findings in the UI are **stale entries from previous scans** that were never cleared from the agent_security/supabase_lov scanners, even though the underlying database policies are already correct.

**Live database policies are properly configured:**
- Storage INSERT/UPDATE/DELETE: all owner-scoped via `projects.user_id = auth.uid()`
- Storage SELECT (anon): restricted to `share_link IS NOT NULL AND status = 'active'`
- Storage SELECT (authenticated): restricted to own projects
- Projects table: fully owner-scoped (no anon access)

### The Real Problem

The two **ERROR** findings are misleading but one points to a genuine architectural issue:

1. **"Any Authenticated User Can Modify Other Users' Assets"** — **FALSE**. The live policies are owner-scoped. This is a stale finding that needs deletion.

2. **"Project model files are publicly accessible without access control enforcement"** — **PARTIALLY TRUE**. While the RLS policies are correct, both buckets are configured as `public: true`. For public buckets, Supabase serves files via the `/storage/v1/object/public/` endpoint which **bypasses RLS entirely** for reads. This means anyone with a file URL can access any model, including drafts.

   **However**, making these buckets private would break the AR viewer — `<model-viewer>` and MindAR load models via direct URLs. The solution is to use **signed URLs** served from the edge function for public AR access, and from the authenticated client for dashboard access.

### Findings & Actions

| # | Finding | Real Status | Action |
|---|---------|-------------|--------|
| 1 | Authenticated user can modify assets | **Stale/False** | Delete finding |
| 2 | Public bucket bypasses RLS for reads | **Real but functional trade-off** | Make buckets private + use signed URLs |
| 3 | Profiles missing DELETE policy | **Real** | Add DELETE policy via migration |
| 4 | Models accessible without share check | **Stale** (policies correct, but moot while bucket is public) | Fixed by making bucket private |
| 5 | Leaked Password Protection | **Real** | Manual action in Cloud UI |
| 6 | mind-ar supply chain | **No fix available** | Acknowledge as accepted risk |

### Implementation Steps

#### Step 1: Make storage buckets private (migration)

```sql
UPDATE storage.buckets SET public = false WHERE id IN ('project-models', 'project-assets');
```

This ensures all file access goes through RLS policies, making the existing owner-scoped and share-check policies actually enforceable.

#### Step 2: Update edge function to return signed URLs

Modify `get-public-project` to generate short-lived signed URLs (15 min) for the model, mind file, marker images, and QR code — instead of returning raw storage paths. The edge function already uses the service role key, so it can generate signed URLs.

Fields to sign: `model_url`, `mind_file_url`, `marker_image_urls` (each value), `qr_code_url`.

#### Step 3: Update ARViewer to use signed URLs from edge function

Remove the `getPublicUrl` call in `ARViewer.tsx`. The edge function response will already contain ready-to-use signed URLs, so `publicModelUrl` simply becomes `project.model_url` directly.

#### Step 4: Update dashboard components for signed URLs

In `ModelPreview.tsx`, `useTabletopGeneration.ts`, `useMultipointGeneration.ts`, and `ProjectOverview.tsx` — replace `getPublicUrl()` calls with `createSignedUrl()` for displaying/downloading models and assets. Authenticated users already have RLS access, so signed URLs will work.

#### Step 5: Add profiles DELETE policy (migration)

```sql
CREATE POLICY "Users can delete own profile"
  ON public.profiles FOR DELETE
  USING (auth.uid() = user_id);
```

#### Step 6: Clean up stale scanner findings

Delete the stale agent_security findings and mark supply chain as accepted risk.

### Functionality Impact

- **AR viewer**: No change in behavior. Models load via signed URLs (valid 15 min) instead of public URLs. The `<model-viewer>` and MindAR components accept any valid URL.
- **Dashboard**: Models and assets load via signed URLs instead of public URLs. Downloads already use signed URLs.
- **QR codes**: The QR code links to the AR page URL (e.g., `/ar/{shareId}`), not to a storage file. No impact.
- **Generation hooks**: Store paths in the database as before, but use signed URLs when displaying. The stored `marker_image_urls` and `qr_code_url` fields will contain storage paths, and the edge function will sign them on retrieval.

### Risk Assessment

- **Low risk**: Signed URLs are standard Supabase functionality, already used in `ModelPreview.handleDownload`
- **Cache consideration**: Signed URLs expire after 15 min; the edge function response is cached for 5 min — so there is a 10-min buffer before expiry
- **No breaking change**: All components receive URLs the same way, just signed instead of public

