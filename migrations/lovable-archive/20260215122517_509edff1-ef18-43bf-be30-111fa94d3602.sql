
-- Add columns for generated AR assets
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS mind_file_url TEXT,
  ADD COLUMN IF NOT EXISTS marker_image_urls JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS qr_code_url TEXT;

-- Create storage bucket for project assets (markers, .mind files, QR codes)
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-assets', 'project-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to project assets
CREATE POLICY "Public can view project assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-assets');

-- Allow authenticated users to upload project assets
CREATE POLICY "Authenticated users can upload project assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-assets' AND auth.role() = 'authenticated');

-- Allow users to update their own project assets
CREATE POLICY "Authenticated users can update project assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-assets' AND auth.role() = 'authenticated');

-- Allow users to delete their own project assets
CREATE POLICY "Authenticated users can delete project assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-assets' AND auth.role() = 'authenticated');
