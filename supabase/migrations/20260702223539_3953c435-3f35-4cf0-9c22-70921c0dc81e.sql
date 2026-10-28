
-- 1. Table
CREATE TABLE public.mkt_content_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_key  text,
  action      text NOT NULL CHECK (action IN ('create','update','delete','reset')),
  actor_id    uuid,
  actor_email text,
  before      jsonb,
  after       jsonb,
  summary     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mkt_content_audit_log_entity_idx
  ON public.mkt_content_audit_log (entity_type, entity_key, created_at DESC);
CREATE INDEX mkt_content_audit_log_created_idx
  ON public.mkt_content_audit_log (created_at DESC);
CREATE INDEX mkt_content_audit_log_actor_idx
  ON public.mkt_content_audit_log (actor_id, created_at DESC);

-- 2. Grants
GRANT SELECT ON public.mkt_content_audit_log TO authenticated;
GRANT ALL    ON public.mkt_content_audit_log TO service_role;

-- 3. RLS
ALTER TABLE public.mkt_content_audit_log ENABLE ROW LEVEL SECURITY;

-- Marketing admins can read
CREATE POLICY "mkt admins read audit log"
  ON public.mkt_content_audit_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_mkt_role(auth.uid(), 'super_admin')
    OR public.has_mkt_role(auth.uid(), 'sales_admin')
    OR public.has_mkt_role(auth.uid(), 'marketing_admin')
    OR public.has_mkt_role(auth.uid(), 'ai_admin')
  );

-- No client insert/update/delete: only the security-definer helper (service role) writes rows.
CREATE POLICY "no direct writes to audit log"
  ON public.mkt_content_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- 4. Append helper
CREATE OR REPLACE FUNCTION public.log_mkt_content_change(
  _entity_type text,
  _entity_key  text,
  _action      text,
  _actor_id    uuid,
  _actor_email text,
  _before      jsonb,
  _after       jsonb,
  _summary     text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.mkt_content_audit_log
    (entity_type, entity_key, action, actor_id, actor_email, before, after, summary)
  VALUES
    (_entity_type, _entity_key, _action, _actor_id, _actor_email, _before, _after, _summary)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_mkt_content_change(text,text,text,uuid,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_mkt_content_change(text,text,text,uuid,text,jsonb,jsonb,text) TO authenticated, service_role;
