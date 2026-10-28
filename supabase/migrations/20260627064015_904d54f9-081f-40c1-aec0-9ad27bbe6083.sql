
CREATE OR REPLACE FUNCTION public.ip_in_tenant_allowlist(_tenant_id uuid, _ip text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip inet;
  v_hit boolean;
BEGIN
  IF _ip IS NULL OR _ip = '' THEN RETURN false; END IF;
  BEGIN v_ip := _ip::inet; EXCEPTION WHEN others THEN RETURN false; END;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_ip_allowlist
    WHERE tenant_id = _tenant_id AND v_ip <<= cidr::inet
  ) INTO v_hit;
  RETURN coalesce(v_hit, false);
END $$;
