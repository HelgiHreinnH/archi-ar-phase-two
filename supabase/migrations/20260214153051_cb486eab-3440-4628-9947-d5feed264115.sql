-- Allow unauthenticated users to view active projects via share_link
CREATE POLICY "Public can view active shared projects"
ON public.projects
FOR SELECT
TO anon
USING (share_link IS NOT NULL AND status = 'active');
