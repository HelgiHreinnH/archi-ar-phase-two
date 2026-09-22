-- Add missing SELECT policy for authenticated users on project-assets
CREATE POLICY "Owners can view own project assets"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'project-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.projects WHERE user_id = auth.uid()
  )
);