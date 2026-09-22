
ALTER TABLE public.projects
  ADD COLUMN tracking_file_url TEXT,
  ADD COLUMN tracking_format TEXT NOT NULL DEFAULT 'mindar-mind';
