
CREATE TYPE public.platform_role_request_status AS ENUM ('pending','approved','denied','cancelled');

CREATE TABLE public.platform_role_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_role public.platform_role NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 2000),
  status public.platform_role_request_status NOT NULL DEFAULT 'pending',
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prr_requester ON public.platform_role_requests(requester_id, created_at DESC);
CREATE INDEX idx_prr_status ON public.platform_role_requests(status, created_at DESC);
CREATE UNIQUE INDEX uniq_prr_pending_per_role
  ON public.platform_role_requests(requester_id, requested_role)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE ON public.platform_role_requests TO authenticated;
GRANT ALL ON public.platform_role_requests TO service_role;

ALTER TABLE public.platform_role_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prr_select_own" ON public.platform_role_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid());
CREATE POLICY "prr_select_superadmin" ON public.platform_role_requests FOR SELECT TO authenticated
  USING (public.is_platform_super_admin(auth.uid()));
CREATE POLICY "prr_insert_own" ON public.platform_role_requests FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());
CREATE POLICY "prr_update_own_cancel" ON public.platform_role_requests FOR UPDATE TO authenticated
  USING (requester_id = auth.uid()) WITH CHECK (requester_id = auth.uid());
CREATE POLICY "prr_update_superadmin" ON public.platform_role_requests FOR UPDATE TO authenticated
  USING (public.is_platform_super_admin(auth.uid())) WITH CHECK (public.is_platform_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_prr_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER prr_updated_at
  BEFORE UPDATE ON public.platform_role_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_prr_touch_updated_at();
