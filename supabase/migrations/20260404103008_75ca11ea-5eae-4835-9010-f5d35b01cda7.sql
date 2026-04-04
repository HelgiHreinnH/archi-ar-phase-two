
-- ============================================================
-- 1. Fix project-assets: Replace broad auth-only policies with owner-scoped ones
-- ============================================================

-- Drop the 3 overly-broad policies
DROP POLICY IF EXISTS "Authenticated users can upload project assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update project assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete project assets" ON storage.objects;

-- Add owner-scoped INSERT policy for project-assets
CREATE POLICY "Users can upload assets to their projects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-assets' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- Add owner-scoped UPDATE policy for project-assets
CREATE POLICY "Users can update assets in their projects"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-assets' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- Add owner-scoped DELETE policy for project-assets
CREATE POLICY "Users can delete assets from their projects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-assets' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 2. Fix project-models: Remove duplicate weaker INSERT and DELETE policies
-- ============================================================

-- Remove the weaker uid-based policies, keep the project-ownership-based ones
DROP POLICY IF EXISTS "Users can upload own project models" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own project models" ON storage.objects;

-- Also remove the weak SELECT that checks uid as folder name (redundant with public read)
DROP POLICY IF EXISTS "Users can view own project models" ON storage.objects;

-- Add proper owner SELECT for project-models (authenticated owners can always see their models)
CREATE POLICY "Owners can view own project models"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-models' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 3. Restrict public/anon read access to active shared projects only
-- ============================================================

-- Drop the overly-broad public SELECT policies
DROP POLICY IF EXISTS "Public can view project models" ON storage.objects;
DROP POLICY IF EXISTS "Public can view project assets" ON storage.objects;

-- Anon can only read models belonging to active shared projects
CREATE POLICY "Public can view active project models"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'project-models' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects
      WHERE share_link IS NOT NULL AND status = 'active'
    )
  );

-- Anon can only read assets belonging to active shared projects
CREATE POLICY "Public can view active project assets"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'project-assets' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects
      WHERE share_link IS NOT NULL AND status = 'active'
    )
  );
