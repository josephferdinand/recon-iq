
CREATE OR REPLACE FUNCTION public.tenant_user_analytics(_tenant uuid, _window_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_platform boolean;
  v_is_tenant_admin boolean;
  v_window int := GREATEST(1, LEAST(_window_days, 365));
  v_cutoff timestamptz := now() - make_interval(days => v_window);
  v_total int; v_active int; v_inactive int; v_never int;
  v_mfa int; v_sso int;
  v_roles jsonb; v_groups jsonb; v_trend jsonb;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT public.is_platform_admin(v_caller) INTO v_is_platform;
  SELECT public.has_tenant_role(v_caller, _tenant, 'tenant_admin'::tenant_role) INTO v_is_tenant_admin;
  IF NOT (v_is_platform OR v_is_tenant_admin) THEN
    RAISE EXCEPTION 'Forbidden: tenant_admin or platform_admin required';
  END IF;

  WITH members AS (
    SELECT DISTINCT tm.user_id FROM public.tenant_members tm WHERE tm.tenant_id = _tenant
  ),
  users AS (
    SELECT u.id, u.last_sign_in_at FROM members m JOIN auth.users u ON u.id = m.user_id
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE last_sign_in_at >= v_cutoff)::int,
    COUNT(*) FILTER (WHERE last_sign_in_at IS NOT NULL AND last_sign_in_at < v_cutoff)::int,
    COUNT(*) FILTER (WHERE last_sign_in_at IS NULL)::int
  INTO v_total, v_active, v_inactive, v_never FROM users;

  SELECT COUNT(DISTINCT f.user_id)::int INTO v_mfa
  FROM auth.mfa_factors f
  WHERE f.status = 'verified'
    AND f.user_id IN (SELECT user_id FROM public.tenant_members WHERE tenant_id = _tenant);

  SELECT COUNT(DISTINCT i.user_id)::int INTO v_sso
  FROM auth.identities i
  WHERE i.provider <> 'email'
    AND i.user_id IN (SELECT user_id FROM public.tenant_members WHERE tenant_id = _tenant);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('role', role, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_roles
  FROM (
    SELECT tm.role::text AS role, COUNT(DISTINCT tm.user_id)::int AS cnt
    FROM public.tenant_members tm WHERE tm.tenant_id = _tenant GROUP BY tm.role
  ) r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('group_id', g.id, 'name', g.name, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_groups
  FROM public.tenant_groups g
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT gm.user_id)::int AS cnt
    FROM public.tenant_group_members gm WHERE gm.group_id = g.id
  ) c ON TRUE
  WHERE g.tenant_id = _tenant;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'signins', signins) ORDER BY day), '[]'::jsonb)
    INTO v_trend
  FROM (
    SELECT d::date AS day,
           (SELECT COUNT(*)::int FROM auth.users u
              JOIN public.tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = _tenant
             WHERE u.last_sign_in_at::date = d::date) AS signins
    FROM generate_series(v_cutoff::date, now()::date, interval '1 day') d
  ) s;

  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
  VALUES (v_caller, _tenant, 'tenant', 'analytics.users.viewed', 'tenant', _tenant::text,
          jsonb_build_object('window_days', v_window));

  RETURN jsonb_build_object(
    'tenant_id', _tenant,
    'window_days', v_window,
    'totals', jsonb_build_object(
      'total', v_total, 'active', v_active, 'inactive', v_inactive, 'never_signed_in', v_never,
      'mfa_enrolled', v_mfa, 'sso_users', v_sso
    ),
    'roles', v_roles, 'groups', v_groups, 'trend', v_trend, 'generated_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.tenant_user_analytics(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_user_analytics(uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_user_analytics(_window_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_window int := GREATEST(1, LEAST(_window_days, 365));
  v_cutoff timestamptz := now() - make_interval(days => v_window);
  v_total int; v_active int; v_inactive int; v_never int;
  v_mfa int; v_sso int;
  v_per_tenant jsonb; v_trend jsonb;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_platform_admin(v_caller) THEN
    RAISE EXCEPTION 'Forbidden: platform_admin required';
  END IF;

  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE last_sign_in_at >= v_cutoff)::int,
    COUNT(*) FILTER (WHERE last_sign_in_at IS NOT NULL AND last_sign_in_at < v_cutoff)::int,
    COUNT(*) FILTER (WHERE last_sign_in_at IS NULL)::int
  INTO v_total, v_active, v_inactive, v_never FROM auth.users;

  SELECT COUNT(DISTINCT user_id)::int INTO v_mfa FROM auth.mfa_factors WHERE status = 'verified';
  SELECT COUNT(DISTINCT user_id)::int INTO v_sso FROM auth.identities WHERE provider <> 'email';

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY (x->>'active_users')::int DESC NULLS LAST), '[]'::jsonb)
    INTO v_per_tenant
  FROM (
    SELECT
      t.id AS tenant_id, t.name, t.slug,
      COUNT(DISTINCT tm.user_id)::int AS total_users,
      COUNT(DISTINCT tm.user_id) FILTER (WHERE u.last_sign_in_at >= v_cutoff)::int AS active_users,
      COUNT(DISTINCT tm.user_id) FILTER (WHERE u.last_sign_in_at IS NULL)::int AS never_signed_in,
      COUNT(DISTINCT tm.user_id) FILTER (WHERE u.id IN (SELECT user_id FROM auth.mfa_factors WHERE status='verified'))::int AS mfa_users,
      COUNT(DISTINCT tm.user_id) FILTER (WHERE u.id IN (SELECT user_id FROM auth.identities WHERE provider <> 'email'))::int AS sso_users
    FROM public.tenants t
    LEFT JOIN public.tenant_members tm ON tm.tenant_id = t.id
    LEFT JOIN auth.users u ON u.id = tm.user_id
    GROUP BY t.id, t.name, t.slug
  ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'signins', signins) ORDER BY day), '[]'::jsonb)
    INTO v_trend
  FROM (
    SELECT d::date AS day,
           (SELECT COUNT(*)::int FROM auth.users WHERE last_sign_in_at::date = d::date) AS signins
    FROM generate_series(v_cutoff::date, now()::date, interval '1 day') d
  ) s;

  INSERT INTO public.audit_log(actor_user_id, scope, action, resource_type, resource_id, context)
  VALUES (v_caller, 'platform', 'analytics.users.viewed', 'platform', 'platform',
          jsonb_build_object('window_days', v_window));

  RETURN jsonb_build_object(
    'window_days', v_window,
    'totals', jsonb_build_object(
      'total', v_total, 'active', v_active, 'inactive', v_inactive, 'never_signed_in', v_never,
      'mfa_enrolled', v_mfa, 'sso_users', v_sso
    ),
    'per_tenant', v_per_tenant, 'trend', v_trend, 'generated_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.platform_user_analytics(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_user_analytics(int) TO authenticated;
