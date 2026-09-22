-- Final security posture from MIGRATION.md: both real buckets PRIVATE, public viewers
-- only ever get signed URLs from get-public-project (which uses the service role and so
-- bypasses RLS). The app never calls getPublicUrl — every read path already signs — so
-- this is safe.

update storage.buckets set public = false where id in ('project-models', 'project-assets');

-- The ONLY SELECT policy on each bucket was a blanket public one. Dropping it without a
-- replacement would stop owners signing URLs for their own files (ModelPreview,
-- ModelViewer3D, ModelStill, MarkerPlacementValidator all call createSignedUrl as the
-- signed-in user), so replace rather than remove.

drop policy if exists "Public can view project models" on storage.objects;
create policy "Owners can view their project models"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-models'
    and (storage.foldername(name))[1] in (
      select id::text from public.projects where user_id = auth.uid()
    )
  );

drop policy if exists "Public can view project assets" on storage.objects;
create policy "Authenticated users can view project assets"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-assets' and auth.role() = 'authenticated');

-- test-assets: not referenced anywhere in the repo and empty. Its "anon can upload"
-- policy is an open write target, so revoke access here. The bucket row itself cannot be
-- deleted in SQL (storage.protect_delete) — remove it via the Storage API / dashboard.
drop policy if exists "anon can upload test-assets" on storage.objects;
drop policy if exists "public read test-assets" on storage.objects;
update storage.buckets set public = false where id = 'test-assets';

-- Security advisor 0028/0029: these SECURITY DEFINER functions were callable over
-- /rest/v1/rpc/. handle_new_user is only ever invoked by the on_auth_user_created
-- trigger; is_project_owner is unused by current policies and app code.
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.is_project_owner(uuid) from anon, authenticated;
