DO $$
DECLARE v_deleted int;
BEGIN
  ALTER TABLE public.tenant_members DISABLE TRIGGER USER;
  DELETE FROM public.tenants
   WHERE slug ~ '-[0-9]{13}$'
     AND id <> '355f850e-fee7-4b42-a64e-202779921de4';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  ALTER TABLE public.tenant_members ENABLE TRIGGER USER;
  RAISE NOTICE 'Purged % test tenants', v_deleted;
END $$;