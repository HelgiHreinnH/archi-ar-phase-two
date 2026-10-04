-- 011 · project-assets: owner-only access (4 Oct 2026)
--
-- project-assets holds QR images, .mind tracking files, marker PNGs and
-- thumbnails. Its policies allowed ANY authenticated user to read, overwrite
-- or delete ANY object. Scope every operation to the owner of the project in
-- the first path segment (<project_id>/...) — the same rule project-models
-- already uses. All app paths follow that layout (useTabletopGeneration,
-- useMultipointGeneration, ModelUploader/ModelStill thumbnails,
-- GenerateExperience markers.wtc, projectActions duplicate).
--
-- The public AR viewer is unaffected: get-public-project signs URLs with the
-- service role, which bypasses RLS. delete-user-data also uses the service role.

DROP POLICY IF EXISTS "Authenticated users can view project assets"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload project assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update project assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete project assets" ON storage.objects;

CREATE POLICY "Owners can view their project assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'project-assets' AND (storage.foldername(name))[1] IN (
    SELECT p.id::text FROM public.projects p WHERE p.user_id = (SELECT auth.uid())));

CREATE POLICY "Owners can upload their project assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-assets' AND (storage.foldername(name))[1] IN (
    SELECT p.id::text FROM public.projects p WHERE p.user_id = (SELECT auth.uid())));

CREATE POLICY "Owners can update their project assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'project-assets' AND (storage.foldername(name))[1] IN (
    SELECT p.id::text FROM public.projects p WHERE p.user_id = (SELECT auth.uid())))
  WITH CHECK (bucket_id = 'project-assets' AND (storage.foldername(name))[1] IN (
    SELECT p.id::text FROM public.projects p WHERE p.user_id = (SELECT auth.uid())));

CREATE POLICY "Owners can delete their project assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'project-assets' AND (storage.foldername(name))[1] IN (
    SELECT p.id::text FROM public.projects p WHERE p.user_id = (SELECT auth.uid())));
