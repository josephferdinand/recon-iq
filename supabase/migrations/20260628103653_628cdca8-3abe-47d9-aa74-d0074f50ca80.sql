
-- Outbox queue for webhook dispatcher
CREATE TABLE public.webhook_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','dead')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.webhook_outbox TO authenticated;
GRANT ALL ON public.webhook_outbox TO service_role;
ALTER TABLE public.webhook_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wob_read" ON public.webhook_outbox FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX idx_wob_pending ON public.webhook_outbox(status, next_attempt_at) WHERE status = 'pending';
CREATE TRIGGER trg_wob_updated BEFORE UPDATE ON public.webhook_outbox
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Structured break notes (Excel-grid editor backing store)
CREATE TABLE public.break_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  break_id uuid NOT NULL,
  note_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  category text NOT NULL DEFAULT 'investigation' CHECK (category IN ('investigation','counterparty','fx','timing','fees','manual_adj','sign_off','other')),
  comment text NOT NULL DEFAULT '',
  amount numeric(20,4),
  currency text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved')),
  author uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_notes TO authenticated;
GRANT ALL ON public.break_notes TO service_role;
ALTER TABLE public.break_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bn_read" ON public.break_notes FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "bn_insert" ON public.break_notes FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id) AND author = auth.uid());
CREATE POLICY "bn_update_own_or_admin" ON public.break_notes FOR UPDATE TO authenticated
  USING (author = auth.uid() OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "bn_delete_own_or_admin" ON public.break_notes FOR DELETE TO authenticated
  USING (author = auth.uid() OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE INDEX idx_break_notes_break ON public.break_notes(break_id, note_date DESC);
CREATE TRIGGER trg_break_notes_updated BEFORE UPDATE ON public.break_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
