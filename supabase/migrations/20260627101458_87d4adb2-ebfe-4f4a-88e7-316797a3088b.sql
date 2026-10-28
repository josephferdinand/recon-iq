
ALTER TABLE public.data_prep_pipelines
  ADD COLUMN IF NOT EXISTS public_uid text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_prep_pipelines_status_check') THEN
    ALTER TABLE public.data_prep_pipelines
      ADD CONSTRAINT data_prep_pipelines_status_check
      CHECK (status = ANY (ARRAY['draft','approved','archived']));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS data_prep_pipelines_tenant_public_uid_idx
  ON public.data_prep_pipelines (tenant_id, public_uid)
  WHERE public_uid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_data_prep_pipeline_uid()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.public_uid IS NULL THEN
    NEW.public_uid := 'DP-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(NEW.id::text,'-',''),1,8);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS data_prep_pipelines_set_uid ON public.data_prep_pipelines;
CREATE TRIGGER data_prep_pipelines_set_uid
  BEFORE INSERT ON public.data_prep_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.tg_data_prep_pipeline_uid();

-- Backfill existing rows
UPDATE public.data_prep_pipelines
   SET public_uid = 'DP-' || to_char(created_at,'YYYYMMDD') || '-' || substr(replace(id::text,'-',''),1,8)
 WHERE public_uid IS NULL;
