

## Security & GDPR Analysis

### Current Security State — Already Correct

The live storage policies are **owner-scoped** and working correctly:

| Operation | Bucket | Who | Condition |
|-----------|--------|-----|-----------|
| INSERT | project-assets | authenticated | File path matches a project owned by `auth.uid()` |
| UPDATE | project-assets | authenticated | Same ownership check |
| DELETE | project-assets | authenticated | Same ownership check |
| SELECT | project-assets | authenticated | Owner's projects only |
| SELECT | project-assets | anon | Only projects with `share_link IS NOT NULL AND status = 'active'` |
| INSERT/UPDATE/DELETE | project-models | authenticated | Same ownership pattern |
| SELECT | project-models | anon | Same active+shared restriction |

Both buckets are **private** — no public URL bypass. The old broad `auth.role() = 'authenticated'` policies were already dropped. The finding in the security panel has a `deleted_at` timestamp, meaning it is a ghost entry still being displayed.

### The Access Model You Described

```text
┌─────────────────────────────────────────────┐
│  Project Owner (authenticated, email login)  │
│  ─ Full read/write on own projects           │
│  ─ Upload/update/delete models & assets      │
│  ─ Generate QR codes, activate sharing       │
│  ─ Cannot touch other users' projects        │
└──────────────────────┬──────────────────────┘
                       │ activates share_link
                       ▼
┌─────────────────────────────────────────────┐
│  Guest (anonymous, via QR code link)         │
│  ─ Read-only access to ONE active project    │
│  ─ Assets served via 15-min signed URLs      │
│  ─ No login required                         │
│  ─ Cannot list, modify, or discover projects │
└─────────────────────────────────────────────┘
```

**This is exactly what the live database already enforces.** No new migrations are needed for the core security model.

### What IS Missing: GDPR Compliance

The app collects user data (email, name, company, designs) but lacks GDPR-required mechanisms:

1. **No account/data deletion flow** — users cannot delete their account and all associated data
2. **No data export** — users cannot download their personal data
3. **No privacy policy page** — required for EU compliance
4. **No cookie/consent banner** — if analytics or third-party scripts are used

### Implementation Plan

#### Step 1: Account Deletion Cascade (migration)

Add a database function that deletes all user data when triggered:
- Delete all projects owned by the user
- Delete all storage files in both buckets for those projects
- Delete the user's profile
- Call `auth.admin.deleteUser()` via an edge function

This ensures "right to erasure" (GDPR Article 17).

#### Step 2: Data Export Edge Function

Create a `export-user-data` edge function that:
- Queries all projects, profile data for the authenticated user
- Packages it as a JSON download
- Returns it to the client

This ensures "right to data portability" (GDPR Article 20).

#### Step 3: Delete Account UI in Settings

Add a "Delete My Account" section to `/settings` with:
- Clear warning about permanent deletion
- Confirmation dialog requiring email re-entry
- Calls the deletion edge function

#### Step 4: Export Data Button in Settings

Add a "Download My Data" button to `/settings` that:
- Calls the export edge function
- Downloads the JSON file

#### Step 5: Privacy Policy Page

Add a `/privacy` route with a standard privacy policy covering:
- What data is collected (email, name, company, 3D models)
- How it is used (AR experience generation)
- Data retention and deletion rights
- Contact information

#### Step 6: Dismiss the Stale Finding

Use the security management tool to permanently clear the ghost finding so it stops reappearing.

### Files to Create/Modify

- `supabase/functions/delete-user-data/index.ts` — new edge function
- `supabase/functions/export-user-data/index.ts` — new edge function  
- `src/pages/SettingsPage.tsx` — add delete account + export data sections
- `src/pages/PrivacyPolicy.tsx` — new page
- `src/App.tsx` — add `/privacy` route
- 1 migration for the cascade deletion function

### No Changes To

- Storage bucket configuration (already private)
- Storage RLS policies (already owner-scoped)
- Edge function `get-public-project` (already correct)
- AR viewer flow (already uses signed URLs)

