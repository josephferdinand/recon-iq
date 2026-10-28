CREATE TABLE IF NOT EXISTS public.mkt_cta_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text NOT NULL CHECK (event_type IN ('view','click','form_submit','pack_download')),
  cta_id       text NOT NULL,
  source       text,
  page_path    text,
  referrer     text,
  region       text,
  session_id   text,
  lead_id      uuid REFERENCES public.mkt_leads(id) ON DELETE SET NULL,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,
  utm_term     text,
  user_agent   text,
  ip           text,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mkt_cta_events_created_idx ON public.mkt_cta_events (created_at DESC);
CREATE INDEX IF NOT EXISTS mkt_cta_events_cta_idx     ON public.mkt_cta_events (cta_id, event_type);
CREATE INDEX IF NOT EXISTS mkt_cta_events_source_idx  ON public.mkt_cta_events (source);
CREATE INDEX IF NOT EXISTS mkt_cta_events_region_idx  ON public.mkt_cta_events (region);
CREATE INDEX IF NOT EXISTS mkt_cta_events_lead_idx    ON public.mkt_cta_events (lead_id);

GRANT SELECT ON public.mkt_cta_events TO authenticated;
GRANT ALL    ON public.mkt_cta_events TO service_role;

ALTER TABLE public.mkt_cta_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY mkt_cta_events_admin_read ON public.mkt_cta_events
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));

CREATE POLICY mkt_cta_events_admin_write ON public.mkt_cta_events
  FOR ALL TO authenticated
  USING (public.has_any_mkt_role(auth.uid()))
  WITH CHECK (public.has_any_mkt_role(auth.uid()));