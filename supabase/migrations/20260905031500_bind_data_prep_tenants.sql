-- Bind Data Prep child rows and source/output references to their authoritative
-- parent tenant. This prevents cross-tenant identifiers from being paired in
-- otherwise individually valid foreign-key columns.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.workspace_data_source_uploads upload
    JOIN public.workspace_data_sources source ON source.id = upload.data_source_id
    WHERE upload.tenant_id <> source.tenant_id
  ) THEN
    RAISE EXCEPTION 'Existing workspace upload tenant mismatch requires review';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.data_prep_pipelines pipeline
    LEFT JOIN public.workspace_data_sources source ON source.id = pipeline.source_data_source_id
    LEFT JOIN public.workspace_data_sources output ON output.id = pipeline.output_data_source_id
    WHERE (pipeline.source_data_source_id IS NOT NULL AND source.tenant_id <> pipeline.tenant_id)
       OR (pipeline.output_data_source_id IS NOT NULL AND output.tenant_id <> pipeline.tenant_id)
  ) THEN
    RAISE EXCEPTION 'Existing Data Prep pipeline tenant mismatch requires review';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.data_prep_runs run
    JOIN public.data_prep_pipelines pipeline ON pipeline.id = run.pipeline_id
    WHERE run.tenant_id <> pipeline.tenant_id
  ) THEN
    RAISE EXCEPTION 'Existing Data Prep run tenant mismatch requires review';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_bind_workspace_upload_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT ds.tenant_id INTO parent_tenant
  FROM public.workspace_data_sources ds
  WHERE ds.id = NEW.data_source_id;

  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'Data source not found';
  END IF;

  NEW.tenant_id := parent_tenant;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_uploads_bind_tenant ON public.workspace_data_source_uploads;
CREATE TRIGGER workspace_uploads_bind_tenant
  BEFORE INSERT OR UPDATE OF data_source_id, tenant_id
  ON public.workspace_data_source_uploads
  FOR EACH ROW EXECUTE FUNCTION public.tg_bind_workspace_upload_tenant();

CREATE OR REPLACE FUNCTION public.tg_validate_data_prep_pipeline_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  source_tenant uuid;
  output_tenant uuid;
BEGIN
  IF NEW.source_data_source_id IS NOT NULL THEN
    SELECT ds.tenant_id INTO source_tenant
    FROM public.workspace_data_sources ds
    WHERE ds.id = NEW.source_data_source_id;

    IF source_tenant IS NULL OR source_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Data Prep source must belong to the pipeline tenant';
    END IF;
  END IF;

  IF NEW.output_data_source_id IS NOT NULL THEN
    SELECT ds.tenant_id INTO output_tenant
    FROM public.workspace_data_sources ds
    WHERE ds.id = NEW.output_data_source_id;

    IF output_tenant IS NULL OR output_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Data Prep output must belong to the pipeline tenant';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_prep_pipelines_validate_tenant ON public.data_prep_pipelines;
CREATE TRIGGER data_prep_pipelines_validate_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, source_data_source_id, output_data_source_id
  ON public.data_prep_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_data_prep_pipeline_tenant();

CREATE OR REPLACE FUNCTION public.tg_bind_data_prep_run_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT pipeline.tenant_id INTO parent_tenant
  FROM public.data_prep_pipelines pipeline
  WHERE pipeline.id = NEW.pipeline_id;

  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'Data Prep pipeline not found';
  END IF;

  NEW.tenant_id := parent_tenant;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_prep_runs_bind_tenant ON public.data_prep_runs;
CREATE TRIGGER data_prep_runs_bind_tenant
  BEFORE INSERT OR UPDATE OF pipeline_id, tenant_id
  ON public.data_prep_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_bind_data_prep_run_tenant();

REVOKE EXECUTE ON FUNCTION public.tg_bind_workspace_upload_tenant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_validate_data_prep_pipeline_tenant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_bind_data_prep_run_tenant() FROM PUBLIC, anon, authenticated;
