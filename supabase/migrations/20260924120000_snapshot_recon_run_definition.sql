-- New runs retain the definition and source labels visible when they were created.
-- Existing runs remain NULL: current definition values cannot reconstruct history.
ALTER TABLE public.recon_runs
  ADD COLUMN IF NOT EXISTS definition_snapshot jsonb;

COMMENT ON COLUMN public.recon_runs.definition_snapshot IS
  'Definition and source labels captured at run insertion. NULL on pre-migration runs; not a historical backfill.';

CREATE OR REPLACE FUNCTION public.tg_snapshot_recon_run_definition()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  definition_row public.recon_definitions%ROWTYPE;
  source_rows jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.definition_snapshot IS DISTINCT FROM OLD.definition_snapshot THEN
      RAISE EXCEPTION 'reconciliation run definition snapshot is immutable'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.definition_id IS DISTINCT FROM OLD.definition_id THEN
      RAISE EXCEPTION 'reconciliation run scope is immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO definition_row
  FROM public.recon_definitions
  WHERE id = NEW.definition_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation definition does not belong to run tenant'
      USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'side_id', side.value->>'side_id',
    'data_source_id', side.value->>'data_source_id',
    'name', ds.name,
    'source_type', ds.source_type
  ) ORDER BY side.ordinality), '[]'::jsonb)
  INTO source_rows
  FROM jsonb_array_elements(definition_row.sides) WITH ORDINALITY AS side(value, ordinality)
  LEFT JOIN public.workspace_data_sources ds
    ON ds.id::text = side.value->>'data_source_id'
   AND ds.tenant_id = NEW.tenant_id;

  -- Always overwrite caller-supplied JSON so it cannot forge historical evidence.
  NEW.definition_snapshot := jsonb_build_object(
    'name', definition_row.name,
    'recon_type', definition_row.recon_type,
    'sides', definition_row.sides,
    'rules', definition_row.rules,
    'sources', source_rows
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS recon_runs_definition_snapshot ON public.recon_runs;
CREATE TRIGGER recon_runs_definition_snapshot
  BEFORE INSERT OR UPDATE ON public.recon_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_snapshot_recon_run_definition();

REVOKE ALL ON FUNCTION public.tg_snapshot_recon_run_definition() FROM PUBLIC, anon, authenticated;
