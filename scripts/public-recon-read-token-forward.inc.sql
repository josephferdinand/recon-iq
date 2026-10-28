-- Additional immutable guard; existing classification/issuer alias are reused.
-- Applies no UPDATE/backfill to existing rows and denies reclassification even by service.
CREATE FUNCTION private.guard_qualified_api_token_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth AS $guard$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id
   OR NEW.created_at IS DISTINCT FROM OLD.created_at
   OR NEW.principal_kind IS DISTINCT FROM OLD.principal_kind
   OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
   OR NEW.service_principal_id IS DISTINCT FROM OLD.service_principal_id
   OR NEW.scopes IS DISTINCT FROM OLD.scopes OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
   OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)) THEN
   RAISE EXCEPTION 'immutable_api_token_binding' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION private.guard_qualified_api_token_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_qualified_api_token_identity_before_update BEFORE UPDATE ON public.api_tokens
FOR EACH ROW EXECUTE FUNCTION private.guard_qualified_api_token_identity();

-- Shared with Heisenberg through parent. Only trusted, named service RPCs can
-- invoke this private helper; it returns principal metadata, never business data.
CREATE FUNCTION private.qualified_user_delegated_api_token(
 _token_id uuid,_tenant_id uuid,_required_scope text
) RETURNS TABLE(token_id uuid,tenant_id uuid,actor_user_id uuid,principal_kind text,expires_at timestamptz,scopes text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,auth SET row_security=on AS $principal$
DECLARE token_row public.api_tokens%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role'
   OR _required_scope IS NULL OR _required_scope NOT IN ('recons.read','ai.inference') THEN
   RAISE EXCEPTION 'not permitted' USING ERRCODE='42501';
 END IF;
 SELECT t.* INTO token_row FROM public.api_tokens t WHERE t.id=_token_id AND t.tenant_id=_tenant_id
   AND t.principal_kind='user_delegated' AND t.subject_user_id=t.created_by AND t.issuer_user_id=t.created_by
   AND t.service_principal_id IS NULL AND t.revoked_at IS NULL AND t.created_by IS NOT NULL
   AND (t.expires_at IS NULL OR t.expires_at>clock_timestamp()) AND _required_scope=ANY(t.scopes) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id AND m.user_id=token_row.subject_user_id AND m.active=true FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT token_row.id,token_row.tenant_id,token_row.subject_user_id,token_row.principal_kind,token_row.expires_at,token_row.scopes;
END $principal$;
REVOKE ALL ON FUNCTION private.qualified_user_delegated_api_token(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.issue_user_delegated_api_token(
 _tenant_id uuid,_name text,_prefix text,_token_hash text,_scopes text[],_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,auth SET row_security=on AS $issue$
DECLARE actor uuid := auth.uid(); token_id uuid; audit_id bigint; slug text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR current_setting('role',true) IS DISTINCT FROM 'authenticated'
   OR actor IS NULL THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 IF _tenant_id IS NULL OR _name IS NULL OR length(btrim(_name)) NOT BETWEEN 1 AND 120
   OR _prefix IS NULL OR _prefix !~ '^fvi_[0-9a-f]{8}$'
   OR _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$'
   OR _scopes IS NULL OR cardinality(_scopes) NOT BETWEEN 1 AND __SCOPE_COUNT__
   OR array_position(_scopes,NULL) IS NOT NULL OR NOT (_scopes <@ ARRAY[__SUPPORTED_SCOPES__]::text[])
   OR cardinality(_scopes)<>(SELECT count(DISTINCT s) FROM unnest(_scopes) s)
   OR (_expires_at IS NOT NULL AND (_expires_at<=clock_timestamp() OR _expires_at>clock_timestamp()+interval '730 days')) THEN
   RAISE EXCEPTION 'invalid token issuance input' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant_id AND user_id=actor AND active=true AND role='tenant_admin' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 SELECT t.slug INTO slug FROM public.tenants t WHERE t.id=_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 -- Reject hash reuse without printing any token/hash. Existing hash index is nonunique.
 PERFORM pg_advisory_xact_lock(hashtextextended(_token_hash,743301));
 IF EXISTS(SELECT 1 FROM public.api_tokens WHERE token_hash=_token_hash) THEN
   RAISE EXCEPTION 'token collision' USING ERRCODE='23505';
 END IF;
 INSERT INTO public.api_tokens(tenant_id,name,prefix,token_hash,scopes,expires_at,created_by,principal_kind,subject_user_id)
 VALUES(_tenant_id,btrim(_name),_prefix,_token_hash,_scopes,_expires_at,actor,'user_delegated',actor) RETURNING id INTO token_id;
 INSERT INTO public.audit_log(tenant_id,tenant_slug,actor_user_id,scope,action,resource_type,resource_id,context)
 VALUES(_tenant_id,slug,actor,'tenant','api.token.create','api_tokens',token_id::text,
   jsonb_build_object('name',btrim(_name),'scopes',_scopes,'principal_kind','user_delegated','subject_user_id',actor)) RETURNING id INTO audit_id;
 IF NOT EXISTS(SELECT 1 FROM public.audit_log a JOIN public.audit_chain_head h ON h.singleton=true
   AND h.last_audit_id=a.id AND h.last_hash=a.row_hash WHERE a.id=audit_id
   AND a.actor_user_id=actor AND a.tenant_id=_tenant_id AND a.resource_id=token_id::text AND octet_length(a.row_hash)=32) THEN
   RAISE EXCEPTION 'token issuance audit receipt absent';
 END IF;
 RETURN jsonb_build_object('id',token_id,'audit_id',audit_id::text);
END $issue$;
REVOKE ALL ON FUNCTION public.issue_user_delegated_api_token(uuid,text,text,text,text[],timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_user_delegated_api_token(uuid,text,text,text,text[],timestamptz) TO authenticated;

CREATE FUNCTION public.revoke_user_delegated_api_token(_tenant_id uuid,_token_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,auth SET row_security=on AS $revoke$
DECLARE actor uuid := auth.uid(); audit_id bigint; slug text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR current_setting('role',true) IS DISTINCT FROM 'authenticated'
   OR actor IS NULL THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant_id AND user_id=actor AND active=true AND role='tenant_admin' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 SELECT t.slug INTO slug FROM public.tenants t WHERE t.id=_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.api_tokens WHERE id=_token_id AND tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 -- Idempotent repeat keeps the existing timestamp and creates an attributed receipt.
 UPDATE public.api_tokens SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=_token_id AND tenant_id=_tenant_id;
 INSERT INTO public.audit_log(tenant_id,tenant_slug,actor_user_id,scope,action,resource_type,resource_id,context)
 VALUES(_tenant_id,slug,actor,'tenant','api.token.revoke','api_tokens',_token_id::text,'{}') RETURNING id INTO audit_id;
 IF NOT EXISTS(SELECT 1 FROM public.audit_log a JOIN public.audit_chain_head h ON h.singleton=true
   AND h.last_audit_id=a.id AND h.last_hash=a.row_hash WHERE a.id=audit_id
   AND a.actor_user_id=actor AND a.tenant_id=_tenant_id AND a.resource_id=_token_id::text AND octet_length(a.row_hash)=32) THEN
   RAISE EXCEPTION 'token revocation audit receipt absent';
 END IF;
 RETURN jsonb_build_object('id',_token_id,'audit_id',audit_id::text);
END $revoke$;
REVOKE ALL ON FUNCTION public.revoke_user_delegated_api_token(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.revoke_user_delegated_api_token(uuid,uuid) TO authenticated;
