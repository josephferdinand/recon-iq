ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department TEXT;
CREATE INDEX IF NOT EXISTS profiles_external_id_idx ON public.profiles(external_id) WHERE external_id IS NOT NULL;