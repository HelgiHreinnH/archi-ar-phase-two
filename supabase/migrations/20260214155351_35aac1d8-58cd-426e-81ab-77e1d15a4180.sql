-- Make the bucket public
UPDATE storage.buckets SET public = true WHERE id = 'project-models';

-- Allow authenticated users to upload to their project folder
CREATE POLICY "Users can upload models to their projects"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-models'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.projects WHERE user_id = auth.uid()
  )
);

-- Allow authenticated users to update/replace their models
CREATE POLICY "Users can update their project models"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-models'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.projects WHERE user_id = auth.uid()
  )
);

-- Allow authenticated users to delete their models
CREATE POLICY "Users can delete their project models"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-models'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.projects WHERE user_id = auth.uid()
  )
);

-- Allow public read access for AR viewer
CREATE POLICY "Public can view project models"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'project-models');