-- Exact read-only metadata request for Primary. No data/identity/credential rows.
SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS identity,
 pg_get_functiondef(p.oid) AS definition,p.proacl,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname='effective_user_permissions')
 OR (n.nspname='private' AND p.proname='has_platform_role')
ORDER BY n.nspname,p.proname,p.oid;
-- Then include only additional referenced helper definitions absent from the
-- extended capture, after reading the actual effective resolver body.
