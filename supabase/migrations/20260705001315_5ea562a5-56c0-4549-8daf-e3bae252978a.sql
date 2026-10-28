DO $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids FROM public.tenants WHERE slug <> 'fvihq-prod';
  IF v_ids IS NULL OR array_length(v_ids,1) = 0 THEN RETURN; END IF;

  SET LOCAL session_replication_role = 'replica';

  DELETE FROM public.tenant_members WHERE tenant_id = ANY(v_ids);
  DELETE FROM public.tenants WHERE id = ANY(v_ids);
END $$;