
-- 1. Certification quiz answer-key leak: revoke column-level SELECT on correct_index
--    Keeps quiz question/options queryable, hides the answer. Scoring must go through
--    a security-definer RPC (already used by certification_attempts flow).
REVOKE SELECT (correct_index) ON public.certification_quizzes FROM PUBLIC;
REVOKE SELECT (correct_index) ON public.certification_quizzes FROM anon;
REVOKE SELECT (correct_index) ON public.certification_quizzes FROM authenticated;
-- service_role retains full access via GRANT ALL.
GRANT SELECT (id, track_id, ordering, question, options, explanation, created_at)
  ON public.certification_quizzes TO authenticated;

-- 2. Config change requests: enforce 4-eyes at RLS layer.
--    Requester cannot be the approver on the deciding UPDATE.
DROP POLICY IF EXISTS config_change_requests_decide ON public.config_change_requests;
CREATE POLICY config_change_requests_decide
  ON public.config_change_requests
  FOR UPDATE
  TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (
    has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    AND requested_by <> auth.uid()
    AND (decided_by IS NULL OR decided_by = auth.uid())
  );

-- 3. Storage buckets for file-reference tables:
--    Add pre-emptive restrictive tenant-scoped policies for the bucket names those
--    tables would use, so if a bucket is ever created it inherits ownership checks
--    instead of a bare bucket_id match. Path convention: <tenant_id>/<rest>.
DO $$
DECLARE
  b text;
  buckets text[] := ARRAY['break-attachments','signoff-evidence','workspace-data-sources','mkt-lead-files'];
BEGIN
  FOREACH b IN ARRAY buckets LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %I ON storage.objects;
      CREATE POLICY %I ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = %L AND (
        is_platform_admin(auth.uid())
        OR is_tenant_member(auth.uid(), ((string_to_array(name,'/'))[1])::uuid)
      ));
    $f$, b||'_read', b||'_read', b);
    EXECUTE format($f$
      DROP POLICY IF EXISTS %I ON storage.objects;
      CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = %L AND (
        is_platform_admin(auth.uid())
        OR has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_admin'::tenant_role)
        OR has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_analyst'::tenant_role)
      ));
    $f$, b||'_insert', b||'_insert', b);
    EXECUTE format($f$
      DROP POLICY IF EXISTS %I ON storage.objects;
      CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = %L AND (
        is_platform_admin(auth.uid())
        OR has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_admin'::tenant_role)
        OR has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_analyst'::tenant_role)
      ));
    $f$, b||'_update', b||'_update', b);
    EXECUTE format($f$
      DROP POLICY IF EXISTS %I ON storage.objects;
      CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = %L AND (
        is_platform_admin(auth.uid())
        OR has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_admin'::tenant_role)
      ));
    $f$, b||'_delete', b||'_delete', b);
  END LOOP;
END $$;

-- 4. Fix mutable search_path on the only user-defined function that lacks it.
ALTER FUNCTION public.mkt_touch_updated_at() SET search_path = public;
