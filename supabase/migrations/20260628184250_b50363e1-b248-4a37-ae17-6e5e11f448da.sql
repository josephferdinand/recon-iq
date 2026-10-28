-- D3: Data Prep staging lifecycle marker on runs
-- Adds an immutable lifecycle marker copied from the parent pipeline at
-- run-creation time, so staging vs production runs are queryable without
-- a join after the pipeline itself is archived.
ALTER TABLE public.data_prep_runs
  ADD COLUMN IF NOT EXISTS pipeline_lifecycle text
    NOT NULL DEFAULT 'production'
    CHECK (pipeline_lifecycle IN ('production','staging','archived'));

CREATE INDEX IF NOT EXISTS data_prep_runs_pipeline_lifecycle_idx
  ON public.data_prep_runs(tenant_id, pipeline_lifecycle, started_at DESC);

-- Backfill any pre-existing rows by joining the current pipeline state.
UPDATE public.data_prep_runs r
  SET pipeline_lifecycle = COALESCE(p.lifecycle_state, 'production')
FROM public.data_prep_pipelines p
WHERE r.pipeline_id = p.id
  AND r.pipeline_lifecycle = 'production'
  AND p.lifecycle_state IS DISTINCT FROM 'production';

-- Trigger to auto-stamp lifecycle on insert from the parent pipeline.
CREATE OR REPLACE FUNCTION public.tg_data_prep_runs_stamp_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.pipeline_lifecycle IS NULL OR NEW.pipeline_lifecycle = 'production' THEN
    SELECT COALESCE(lifecycle_state, 'production')
      INTO NEW.pipeline_lifecycle
    FROM public.data_prep_pipelines
    WHERE id = NEW.pipeline_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_prep_runs_stamp_lifecycle ON public.data_prep_runs;
CREATE TRIGGER data_prep_runs_stamp_lifecycle
  BEFORE INSERT ON public.data_prep_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_data_prep_runs_stamp_lifecycle();
