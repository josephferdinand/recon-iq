-- Atomic, tenant-bound reference-data imports with deterministic composite-key uniqueness.

ALTER TABLE public.reference_data_rows
  ADD COLUMN IF NOT EXISTS key_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS reference_data_rows_table_key_uq
  ON public.reference_data_rows(table_id, key_hash)
  WHERE key_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_reference_data_row_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  table_tenant uuid;
  keys text[];
  key_payload jsonb;
BEGIN
  SELECT tenant_id, key_columns INTO table_tenant, keys
  FROM public.reference_data_tables
  WHERE id = NEW.table_id;
  IF table_tenant IS NULL OR table_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Reference row table must belong to the same tenant';
  END IF;
  IF coalesce(array_length(keys, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Reference table must define at least one key column';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(keys) AS key_name
    WHERE NOT (NEW.row_data ? key_name)
       OR NEW.row_data -> key_name IS NULL
       OR btrim(NEW.row_data ->> key_name) = ''
  ) THEN
    RAISE EXCEPTION 'Reference row is missing a required key value';
  END IF;
  SELECT jsonb_agg(NEW.row_data -> key_name ORDER BY ordinal)
  INTO key_payload
  FROM unnest(keys) WITH ORDINALITY AS ordered_keys(key_name, ordinal);
  NEW.key_hash := encode(digest(key_payload::text, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_reference_data_row_integrity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reference_data_rows_integrity ON public.reference_data_rows;
CREATE TRIGGER reference_data_rows_integrity
  BEFORE INSERT OR UPDATE OF table_id, tenant_id, row_data
  ON public.reference_data_rows
  FOR EACH ROW EXECUTE FUNCTION public.tg_reference_data_row_integrity();

CREATE OR REPLACE FUNCTION public.bulk_import_reference_data(
  _tenant_id uuid,
  _table_id uuid,
  _rows jsonb,
  _replace boolean DEFAULT false
)
RETURNS TABLE(imported_count integer, total_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  actor uuid := auth.uid();
  incoming_count integer;
BEGIN
  IF actor IS NULL OR NOT (
    public.has_tenant_role(actor, _tenant_id, 'tenant_admin')
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_analyst')
    OR public.is_platform_admin(actor)
  ) THEN
    RAISE EXCEPTION 'Forbidden: analyst or admin required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reference_data_tables
    WHERE id = _table_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Reference table not found';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'Reference rows must be a JSON array';
  END IF;
  incoming_count := jsonb_array_length(_rows);
  IF incoming_count < 1 OR incoming_count > 10000 THEN
    RAISE EXCEPTION 'Reference import must contain between 1 and 10000 rows';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_rows) AS item WHERE jsonb_typeof(item) <> 'object') THEN
    RAISE EXCEPTION 'Every reference row must be a JSON object';
  END IF;

  IF _replace THEN
    DELETE FROM public.reference_data_rows
    WHERE table_id = _table_id AND tenant_id = _tenant_id;
  END IF;

  INSERT INTO public.reference_data_rows(table_id, tenant_id, row_data)
  SELECT _table_id, _tenant_id, item
  FROM jsonb_array_elements(_rows) AS item;

  SELECT count(*)::integer INTO total_count
  FROM public.reference_data_rows
  WHERE table_id = _table_id AND tenant_id = _tenant_id;
  imported_count := incoming_count;

  UPDATE public.reference_data_tables
  SET row_count = total_count
  WHERE id = _table_id AND tenant_id = _tenant_id;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    actor, _tenant_id, 'tenant', 'reference_data.bulk_load',
    'reference_data_tables', _table_id::text,
    jsonb_build_object('rows', imported_count, 'total_rows', total_count, 'replace', _replace)
  );

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_import_reference_data(uuid, uuid, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_import_reference_data(uuid, uuid, jsonb, boolean)
  TO authenticated, service_role;
