-- ── Profiles table ────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  company TEXT,
  logo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"   ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Projects table ────────────────────────────────────────────────────
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  client_name TEXT,
  location TEXT,
  description TEXT,
  model_url TEXT,
  marker_data JSONB DEFAULT '{}',
  share_link UUID UNIQUE DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_project_owner(_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects WHERE id = _project_id AND user_id = auth.uid()
  );
$$;

CREATE POLICY "Owners can view own projects"   ON public.projects FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Owners can insert projects"     ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners can update own projects" ON public.projects FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Owners can delete own projects" ON public.projects FOR DELETE USING (user_id = auth.uid());

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Storage: project-models bucket ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('project-models', 'project-models', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "Users can upload models to their projects"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-models'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their project models"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'project-models'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their project models"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-models'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Public can view project models"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'project-models');
