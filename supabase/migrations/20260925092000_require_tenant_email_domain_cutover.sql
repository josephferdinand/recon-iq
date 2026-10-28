-- APPLY ONLY AFTER the app using create_tenant_with_email_domain is deployed
-- and its exact tenant-create path has been checked. This is the strict cutover.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants t CROSS JOIN public.tenant_email_domain_rollout r
    WHERE t.created_at >= r.schema_ready_at
      AND NOT EXISTS (SELECT 1 FROM public.tenant_email_domains d WHERE d.tenant_id=t.id)
  ) THEN
    RAISE EXCEPTION 'Tenant email domain cutover blocked: backfill compatibility-window tenants first'
      USING ERRCODE='23514';
  END IF;
END $$;
CREATE FUNCTION public.require_tenant_email_domain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenant_email_domains WHERE tenant_id=NEW.id) THEN
    RAISE EXCEPTION 'Tenant email domain required' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.require_tenant_email_domain() FROM PUBLIC, anon, authenticated;
CREATE CONSTRAINT TRIGGER tenant_requires_email_domain
  AFTER INSERT ON public.tenants DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.require_tenant_email_domain();

-- A verified domain cannot be changed or suspended while non-platform users
-- retain any membership. Operators first revoke those memberships.
CREATE FUNCTION public.guard_tenant_email_domain_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.tenant_members m
               WHERE m.tenant_id=OLD.tenant_id AND NOT public.is_platform_admin(m.user_id)) THEN
      RAISE EXCEPTION 'Remove tenant memberships before changing its email domain'
        USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (OLD.domain IS DISTINCT FROM NEW.domain OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
      OR (OLD.status='verified' AND NEW.status<>'verified'))
     AND EXISTS (SELECT 1 FROM public.tenant_members m
                 WHERE m.tenant_id=OLD.tenant_id AND NOT public.is_platform_admin(m.user_id)) THEN
    RAISE EXCEPTION 'Remove tenant memberships before changing its email domain'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_tenant_email_domain_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tenant_email_domain_change_guard
  BEFORE UPDATE OF domain,tenant_id,status ON public.tenant_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_email_domain_change();
CREATE TRIGGER tenant_email_domain_delete_guard
  BEFORE DELETE ON public.tenant_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_email_domain_change();

-- Auth email changes for a governed member may stay only within the same
-- verified tenant domain. Removing membership first permits offboarding.
CREATE FUNCTION public.guard_governed_member_auth_email_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_domain text := split_part(lower(coalesce(NEW.email,'')),'@',2);
BEGIN
  IF NEW.email IS NOT DISTINCT FROM OLD.email
     AND NEW.email_confirmed_at IS NOT DISTINCT FROM OLD.email_confirmed_at THEN RETURN NEW; END IF;
  IF public.is_platform_admin(NEW.id) THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.tenant_members m
    JOIN public.tenant_email_domains d ON d.tenant_id=m.tenant_id
    WHERE m.user_id=NEW.id
      AND (NEW.email_confirmed_at IS NULL OR d.status<>'verified' OR d.domain<>v_domain)
  ) THEN
    RAISE EXCEPTION 'Remove tenant membership before changing account email'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_governed_member_auth_email_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER governed_member_auth_email_change_guard
  BEFORE UPDATE OF email,email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_governed_member_auth_email_change();
