-- Add a separate, server-derived editor provenance channel for resource roots.
-- Historical rows intentionally remain NULL/unknown; legacy created_by fields
-- retain their existing meanings and are not used to infer actor identity.

CREATE OR REPLACE FUNCTION public.set_resource_actor_attribution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid;
  v_actor_status text;
BEGIN
  -- Only a signed authenticated-user request is attributable to a person.
  -- Service-role, anon, SQL maintenance, and missing-claim writes are explicit
  -- unattributed events; never trust actor values supplied by the caller.
  IF coalesce(auth.role(), '') = 'authenticated' THEN
    v_actor := auth.uid();
  ELSE
    v_actor := NULL;
  END IF;
  v_actor_status := CASE WHEN v_actor IS NULL THEN 'unattributed' ELSE 'authenticated_user' END;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by_actor_id := v_actor;
    NEW.created_by_actor_status := v_actor_status;
  ELSE
    -- Preserve creation provenance from the stored row, never from UPDATE input.
    NEW.created_by_actor_id := OLD.created_by_actor_id;
    NEW.created_by_actor_status := OLD.created_by_actor_status;
  END IF;

  NEW.updated_by_actor_id := v_actor;
  NEW.updated_by_actor_status := v_actor_status;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_resource_actor_attribution() FROM PUBLIC, anon, authenticated, service_role;

DO $migration$
DECLARE
  v_table text;
  v_tables constant text[] := ARRAY[
    'workspace_data_sources',
    'workspace_data_source_uploads',
    'data_source_schedules',
    'rekon_db_connections',
    'rekon_inline_api_sources',
    'erp_connector_configs',
    'data_watchers',
    'aidp_templates',
    'aidp_documents',
    'reference_data_tables',
    'data_prep_pipelines',
    'recon_definitions'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD COLUMN IF NOT EXISTS created_by_actor_id uuid,
         ADD COLUMN IF NOT EXISTS created_by_actor_status text,
         ADD COLUMN IF NOT EXISTS updated_by_actor_id uuid,
         ADD COLUMN IF NOT EXISTS updated_by_actor_status text',
      v_table
    );
    EXECUTE format('COMMENT ON COLUMN public.%I.created_by_actor_id IS %L', v_table,
      'Verified auth.uid() for authenticated INSERT; NULL for historical, deleted, or unattributed actors. Do not expose raw UUID to UI.');
    EXECUTE format('COMMENT ON COLUMN public.%I.created_by_actor_status IS %L', v_table,
      'authenticated_user or unattributed for post-migration writes; NULL means historical/unknown.');
    EXECUTE format('COMMENT ON COLUMN public.%I.updated_by_actor_id IS %L', v_table,
      'Verified auth.uid() for authenticated UPDATE; NULL for unattributed actors. Do not expose raw UUID to UI.');
    EXECUTE format('COMMENT ON COLUMN public.%I.updated_by_actor_status IS %L', v_table,
      'authenticated_user or unattributed for post-migration updates; NULL means historical/unknown.');
    EXECUTE format('DROP TRIGGER IF EXISTS zz_resource_actor_attribution ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER zz_resource_actor_attribution
       BEFORE INSERT OR UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_resource_actor_attribution()',
      v_table
    );
  END LOOP;
END
$migration$;
