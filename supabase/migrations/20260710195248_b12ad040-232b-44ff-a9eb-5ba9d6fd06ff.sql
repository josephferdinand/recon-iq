DO $$
DECLARE
  t_id uuid;
BEGIN
  SET LOCAL session_replication_role = 'replica';
  FOR t_id IN SELECT id FROM public.tenants WHERE slug <> 'fvihq-prod' LOOP
    DELETE FROM public.tenant_members WHERE tenant_id = t_id;
    DELETE FROM public.tenants WHERE id = t_id;
  END LOOP;
END $$;