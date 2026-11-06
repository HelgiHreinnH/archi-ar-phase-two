
-- Step 1: Make storage buckets private to enforce RLS on reads
UPDATE storage.buckets SET public = false WHERE id IN ('project-models', 'project-assets');

-- Step 2: Add missing DELETE policy on profiles
CREATE POLICY "Users can delete own profile"
  ON public.profiles FOR DELETE
  USING (auth.uid() = user_id);
