-- PROD only. Parent wraps exact rollback/apply and all-row/ledger fence.
DO $next_guard$ DECLARE v jsonb;BEGIN
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) INTO v FROM pg_policies p WHERE p.schemaname='public' AND p.policyname IN ('bu_write','tg_admin') AND p.tablename IN ('business_units','tenant_groups');
 IF v IS DISTINCT FROM '[{"cmd":"ALL","qual":"(is_platform_admin(auth.uid()) OR has_tenant_role(auth.uid(), tenant_id, ''tenant_admin''::tenant_role))","roles":["authenticated"],"tablename":"business_units","permissive":"PERMISSIVE","policyname":"bu_write","schemaname":"public","with_check":"(is_platform_admin(auth.uid()) OR has_tenant_role(auth.uid(), tenant_id, ''tenant_admin''::tenant_role))"},{"cmd":"ALL","qual":"(private.has_tenant_role(auth.uid(), tenant_id, ''tenant_admin''::tenant_role) OR private.is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"tenant_groups","permissive":"PERMISSIVE","policyname":"tg_admin","schemaname":"public","with_check":"(private.has_tenant_role(auth.uid(), tenant_id, ''tenant_admin''::tenant_role) OR private.is_platform_admin(auth.uid()))"}]'::jsonb THEN RAISE EXCEPTION 'Exact BU/group write-policy preimage drift';END IF;
 IF md5(pg_get_functiondef('public.seed_default_tenant_groups(uuid)'::regprocedure))<>'b78908fd778aca6ade98a9190388a691' OR (SELECT proacl::text FROM pg_proc WHERE oid='public.seed_default_tenant_groups(uuid)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' OR (SELECT proowner::text FROM pg_proc WHERE oid='public.seed_default_tenant_groups(uuid)'::regprocedure)<>'16388' THEN RAISE EXCEPTION 'Seed body/owner/ACL drift';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='private' AND p.proname IN ('fvi_active_structure_admin','fvi_structure_write_context','fvi_bu_structure_guard','fvi_group_structure_guard','fvi_seed_missing_group_presets')) OR (n.nspname='public' AND p.proname='seed_tenant_group_presets_for_bu')) OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN ('a_fvi_bu_structure_write_guard','a_fvi_group_structure_write_guard')) THEN RAISE EXCEPTION 'New guard identity collision';END IF;
END $next_guard$;
-- New private helpers. No existing global role helper is replaced.
CREATE FUNCTION private.fvi_active_structure_admin(_tenant uuid,_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth AS $f$
 SELECT coalesce(_actor=auth.uid() AND EXISTS(SELECT 1 FROM public.tenant_members m
   WHERE m.tenant_id=_tenant AND m.user_id=_actor AND m.active
     AND m.role='tenant_admin'::public.tenant_role),false)
$f$;
REVOKE ALL ON FUNCTION private.fvi_active_structure_admin(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.fvi_active_structure_admin(uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION private.fvi_structure_write_context(_tenant uuid,_actor uuid,_executor name,_depth integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth AS $f$
BEGIN
 IF _actor IS DISTINCT FROM auth.uid() THEN RETURN false;END IF;
 IF private.fvi_active_structure_admin(_tenant,_actor) THEN RETURN true;END IF;
 IF auth.role()='service_role' AND _executor IN ('service_role','postgres','supabase_admin') THEN RETURN true;END IF;
 IF auth.role() IS NULL AND _executor IN ('postgres','supabase_admin') THEN RETURN true;END IF;
 -- Only the existing nested new-tenant bootstrap, not a caller-controlled GUC.
 IF auth.role()='authenticated' AND _executor IN ('postgres','supabase_admin') AND _depth>1
   AND public.is_platform_admin(_actor) IS TRUE
   AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_tenant AND t.xmin=pg_current_xact_id()::xid)
 THEN RETURN true;END IF;
 RETURN false;
END $f$;
REVOKE ALL ON FUNCTION private.fvi_structure_write_context(uuid,uuid,name,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.fvi_structure_write_context(uuid,uuid,name,integer) TO authenticated,service_role;

CREATE FUNCTION private.fvi_bu_structure_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,private,auth AS $f$
BEGIN
 IF NOT private.fvi_structure_write_context(NEW.tenant_id,auth.uid(),current_user,pg_trigger_depth()) THEN
   RAISE EXCEPTION 'Active tenant administrator required for business-unit writes' USING ERRCODE='42501';END IF;
 IF TG_OP='UPDATE' AND NEW.tenant_id=OLD.tenant_id AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN RETURN NEW;END IF;
 IF NEW.parent_id IS NOT NULL THEN
   PERFORM 1 FROM public.business_units b WHERE b.id=NEW.parent_id AND b.tenant_id=NEW.tenant_id AND NOT b.is_archived FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Parent business unit must be active in this tenant' USING ERRCODE='22023';END IF;
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.fvi_bu_structure_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a_fvi_bu_structure_write_guard BEFORE INSERT OR UPDATE OF tenant_id,parent_id ON public.business_units
FOR EACH ROW EXECUTE FUNCTION private.fvi_bu_structure_guard();

CREATE FUNCTION private.fvi_group_structure_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,private,auth AS $f$
BEGIN
 IF NOT private.fvi_structure_write_context(NEW.tenant_id,auth.uid(),current_user,pg_trigger_depth()) THEN
   RAISE EXCEPTION 'Active tenant administrator required for group writes' USING ERRCODE='42501';END IF;
 IF TG_OP='UPDATE' AND NEW.tenant_id=OLD.tenant_id AND NEW.bu_id IS NOT DISTINCT FROM OLD.bu_id THEN RETURN NEW;END IF;
 IF NEW.bu_id IS NULL THEN RAISE EXCEPTION 'Every new or reassociated group requires a business unit' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.business_units b WHERE b.id=NEW.bu_id AND b.tenant_id=NEW.tenant_id AND NOT b.is_archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group business unit must be active in this tenant' USING ERRCODE='22023';END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.fvi_group_structure_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a_fvi_group_structure_write_guard BEFORE INSERT OR UPDATE OF tenant_id,bu_id ON public.tenant_groups
FOR EACH ROW EXECUTE FUNCTION private.fvi_group_structure_guard();

DROP POLICY bu_write ON public.business_units;
CREATE POLICY bu_write ON public.business_units FOR ALL TO authenticated
USING(private.fvi_active_structure_admin(tenant_id,auth.uid()))
WITH CHECK(private.fvi_active_structure_admin(tenant_id,auth.uid()));
DROP POLICY tg_admin ON public.tenant_groups;
CREATE POLICY tg_admin ON public.tenant_groups FOR ALL TO authenticated
USING(private.fvi_active_structure_admin(tenant_id,auth.uid()))
WITH CHECK(private.fvi_active_structure_admin(tenant_id,auth.uid()));

-- Creates only missing defaults. Existing rows/names/roles/BU links remain untouched.
CREATE FUNCTION private.fvi_seed_missing_group_presets(_tenant uuid,_bu uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth AS $f$
DECLARE p record;g uuid;r uuid;rk text;n integer:=0;
BEGIN
 PERFORM 1 FROM public.business_units b WHERE b.id=_bu AND b.tenant_id=_tenant AND NOT b.is_archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Select an active business unit in this tenant' USING ERRCODE='22023';END IF;
 FOR p IN SELECT * FROM public.tenant_group_presets WHERE is_default ORDER BY sort_order LOOP
   IF EXISTS(SELECT 1 FROM public.tenant_groups x WHERE x.tenant_id=_tenant AND x.preset_key=p.preset_key) THEN CONTINUE;END IF;
   INSERT INTO public.tenant_groups(tenant_id,name,description,is_system,preset_key,bu_id)
   VALUES(_tenant,p.name,p.description,true,p.preset_key,_bu)
   ON CONFLICT(tenant_id,preset_key) DO NOTHING RETURNING id INTO g;
   IF g IS NULL THEN CONTINUE;END IF;
   INSERT INTO public.bu_group_assignments(tenant_id,bu_id,group_id,role,inherit_descendants,created_by)
   VALUES(_tenant,_bu,g,'bu_member',false,auth.uid());
   FOREACH rk IN ARRAY p.role_keys LOOP
     SELECT id INTO r FROM public.rbac_roles WHERE key=rk AND is_system LIMIT 1;
     IF r IS NOT NULL THEN INSERT INTO public.tenant_group_roles(group_id,role_id) VALUES(g,r) ON CONFLICT DO NOTHING;END IF;
   END LOOP;
   n:=n+1;
 END LOOP;
 RETURN n;
END $f$;
REVOKE ALL ON FUNCTION private.fvi_seed_missing_group_presets(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.seed_tenant_group_presets_for_bu(_tenant_id uuid,_bu_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth AS $f$
BEGIN
 IF NOT private.fvi_active_structure_admin(_tenant_id,auth.uid()) THEN
   RAISE EXCEPTION 'Active tenant administrator required for group presets' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.tenants WHERE id=_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tenant not found' USING ERRCODE='22023';END IF;
 RETURN private.fvi_seed_missing_group_presets(_tenant_id,_bu_id);
END $f$;
REVOKE ALL ON FUNCTION public.seed_tenant_group_presets_for_bu(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.seed_tenant_group_presets_for_bu(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.seed_default_tenant_groups(_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_bu uuid;v_processed integer;
BEGIN
 PERFORM 1 FROM public.tenants WHERE id=_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tenant not found' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO v_processed FROM public.tenant_group_presets WHERE is_default;
 IF NOT EXISTS(SELECT 1 FROM public.tenant_group_presets p WHERE p.is_default AND NOT EXISTS(SELECT 1 FROM public.tenant_groups g WHERE g.tenant_id=_tenant_id AND g.preset_key=p.preset_key)) THEN RETURN v_processed;END IF;
 -- Explicit NEW foundation BU; no arbitrary old-BU selection or backfill.
 INSERT INTO public.business_units(tenant_id,name,code,description,created_by)
 VALUES(_tenant_id,'Preset groups business unit','FVI-PRESET-'||left(gen_random_uuid()::text,8),'Explicit foundation for newly seeded default groups',auth.uid()) RETURNING id INTO v_bu;
 PERFORM private.fvi_seed_missing_group_presets(_tenant_id,v_bu);
 RETURN v_processed;
END;
$function$;
DO $next_authority$ BEGIN
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.seed_default_tenant_groups(uuid)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' OR (SELECT proowner::text FROM pg_proc WHERE oid='public.seed_default_tenant_groups(uuid)'::regprocedure)<>'16388' OR (SELECT to_jsonb(proconfig) FROM pg_proc WHERE oid='public.seed_default_tenant_groups(uuid)'::regprocedure) IS DISTINCT FROM '["search_path=public"]'::jsonb OR pg_get_function_identity_arguments('public.seed_default_tenant_groups(uuid)'::regprocedure)<>'_tenant_id uuid' OR pg_get_function_result('public.seed_default_tenant_groups(uuid)'::regprocedure)<>'integer' THEN RAISE EXCEPTION 'Seed authority/ABI/config changed';END IF;
END $next_authority$;
