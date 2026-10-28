
CREATE OR REPLACE FUNCTION public.mkt_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS public.mkt_chatbot_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  system_prompt text NOT NULL,
  greeting text,
  model_hint text,
  temperature numeric(3,2) NOT NULL DEFAULT 0.20,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_chatbot_prompts TO authenticated;
GRANT ALL ON public.mkt_chatbot_prompts TO service_role;
ALTER TABLE public.mkt_chatbot_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_chatbot_prompts_read ON public.mkt_chatbot_prompts
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));
CREATE POLICY mkt_chatbot_prompts_write ON public.mkt_chatbot_prompts
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'));

CREATE TRIGGER trg_mkt_chatbot_prompts_updated_at BEFORE UPDATE ON public.mkt_chatbot_prompts
  FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at();

INSERT INTO public.mkt_chatbot_prompts (key, label, system_prompt, greeting, temperature) VALUES
  ('dr_falcon_default','Dr. Falcon — default',
   'You are Dr. Falcon, the AI concierge for Recon Spark (FVI), an enterprise-grade AI reconciliation platform for Tier-1 banks. Be precise, concise, and cite the Buyer''s Guide or Security page for regulatory questions (DORA, BCBS 239, SR 11-7, MAS TRM, APRA CPS 234, ISO 22301). Never mention competitors by name. Escalate procurement / security-review requests to the sales team.',
   'Hi — I''m Dr. Falcon. Ask me anything about FVI: architecture, security posture, deployment options, or ROI.', 0.20)
ON CONFLICT (key) DO NOTHING;
