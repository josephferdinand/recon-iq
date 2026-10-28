-- Bind every Copilot thread to a scope the owning user is authorized to use.
-- The original owner-only policy allowed an authenticated user to label their
-- own thread with another tenant_id, which then became trusted AI context.

CREATE OR REPLACE FUNCTION private.can_use_copilot_scope(
  _user_id uuid,
  _scope public.copilot_scope,
  _tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user_id IS NOT NULL
    AND (
      (
        _scope = 'platform'::public.copilot_scope
        AND _tenant_id IS NULL
        AND (
          private.is_platform_admin(_user_id)
          OR private.is_platform_super_admin(_user_id)
        )
      )
      OR
      (
        _scope IN ('tenant'::public.copilot_scope, 'workspace'::public.copilot_scope)
        AND _tenant_id IS NOT NULL
        AND (
          private.is_platform_admin(_user_id)
          OR private.is_platform_super_admin(_user_id)
          OR EXISTS (
            SELECT 1
            FROM public.tenant_members tm
            WHERE tm.user_id = _user_id
              AND tm.tenant_id = _tenant_id
              AND tm.active = true
          )
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION private.can_use_copilot_scope(uuid, public.copilot_scope, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_use_copilot_scope(uuid, public.copilot_scope, uuid)
  TO authenticated, service_role;

ALTER TABLE public.copilot_threads
  DROP CONSTRAINT IF EXISTS copilot_threads_scope_tenant_consistency;
ALTER TABLE public.copilot_threads
  ADD CONSTRAINT copilot_threads_scope_tenant_consistency
  CHECK (
    (scope = 'platform'::public.copilot_scope AND tenant_id IS NULL)
    OR
    (scope IN ('tenant'::public.copilot_scope, 'workspace'::public.copilot_scope)
      AND tenant_id IS NOT NULL)
  ) NOT VALID;

DROP POLICY IF EXISTS "own threads" ON public.copilot_threads;
DROP POLICY IF EXISTS copilot_threads_select_own_scope ON public.copilot_threads;
DROP POLICY IF EXISTS copilot_threads_insert_own_scope ON public.copilot_threads;
DROP POLICY IF EXISTS copilot_threads_update_own_scope ON public.copilot_threads;
DROP POLICY IF EXISTS copilot_threads_delete_own_scope ON public.copilot_threads;

CREATE POLICY copilot_threads_select_own_scope
  ON public.copilot_threads
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND private.can_use_copilot_scope(auth.uid(), scope, tenant_id)
  );

CREATE POLICY copilot_threads_insert_own_scope
  ON public.copilot_threads
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND private.can_use_copilot_scope(auth.uid(), scope, tenant_id)
  );

CREATE POLICY copilot_threads_update_own_scope
  ON public.copilot_threads
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND private.can_use_copilot_scope(auth.uid(), scope, tenant_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND private.can_use_copilot_scope(auth.uid(), scope, tenant_id)
  );

CREATE POLICY copilot_threads_delete_own_scope
  ON public.copilot_threads
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND private.can_use_copilot_scope(auth.uid(), scope, tenant_id)
  );

-- New rows are checked immediately by a NOT VALID constraint. Validate the
-- historical population only when it is already shape-correct; otherwise the
-- new RLS policies quarantine malformed rows for deliberate remediation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.copilot_threads
    WHERE NOT (
      (scope = 'platform'::public.copilot_scope AND tenant_id IS NULL)
      OR
      (scope IN ('tenant'::public.copilot_scope, 'workspace'::public.copilot_scope)
        AND tenant_id IS NOT NULL)
    )
  ) THEN
    ALTER TABLE public.copilot_threads
      VALIDATE CONSTRAINT copilot_threads_scope_tenant_consistency;
  END IF;
END
$$;
