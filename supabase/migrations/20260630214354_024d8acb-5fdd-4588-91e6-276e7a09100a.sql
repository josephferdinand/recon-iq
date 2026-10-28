
-- S-7: BYOK key rotation reminder
ALTER TABLE public.llm_providers
  ADD COLUMN IF NOT EXISTS key_rotated_at timestamptz;

UPDATE public.llm_providers
  SET key_rotated_at = COALESCE(key_rotated_at, created_at, now())
  WHERE key_rotated_at IS NULL;

-- C-1: pii_policy_changes audit table
CREATE TABLE IF NOT EXISTS public.pii_policy_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_version text,
  new_version text NOT NULL,
  diff_summary text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  initiated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pii_policy_changes TO authenticated;
GRANT ALL ON public.pii_policy_changes TO service_role;

ALTER TABLE public.pii_policy_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins view pii_policy_changes" ON public.pii_policy_changes;
CREATE POLICY "Platform admins view pii_policy_changes"
  ON public.pii_policy_changes
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins insert pii_policy_changes" ON public.pii_policy_changes;
CREATE POLICY "Platform admins insert pii_policy_changes"
  ON public.pii_policy_changes
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE UNIQUE INDEX IF NOT EXISTS pii_policy_changes_new_version_uidx
  ON public.pii_policy_changes (new_version);

-- SECURITY DEFINER helper invoked from app code; lets the new code path
-- record a bump without requiring the caller to be a platform admin.
CREATE OR REPLACE FUNCTION public.record_pii_policy_change(
  _previous text,
  _new text,
  _summary text,
  _initiated_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _new IS NULL OR length(_new) = 0 THEN
    RAISE EXCEPTION 'new_version required';
  END IF;

  -- Idempotent: if this exact new_version is already recorded, return the
  -- existing id and do not duplicate.
  SELECT id INTO v_id FROM public.pii_policy_changes WHERE new_version = _new LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.pii_policy_changes (previous_version, new_version, diff_summary, initiated_by)
  VALUES (_previous, _new, _summary, _initiated_by)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pii_policy_change(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pii_policy_change(text, text, text, uuid) TO authenticated, service_role;
