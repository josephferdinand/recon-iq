-- C5: payload_hash column on stripe_events
ALTER TABLE public.stripe_events ADD COLUMN IF NOT EXISTS payload_hash text;
CREATE INDEX IF NOT EXISTS idx_stripe_events_payload_hash ON public.stripe_events(payload_hash) WHERE payload_hash IS NOT NULL;

-- D6: BYOK team key vaults
CREATE TABLE IF NOT EXISTS public.byok_key_vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.byok_key_vaults TO authenticated;
GRANT ALL ON public.byok_key_vaults TO service_role;
ALTER TABLE public.byok_key_vaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read vaults"
  ON public.byok_key_vaults FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = byok_key_vaults.tenant_id AND tm.user_id = auth.uid()));

CREATE POLICY "Tenant admins can manage vaults"
  ON public.byok_key_vaults FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = byok_key_vaults.tenant_id AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = byok_key_vaults.tenant_id AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'));

CREATE TABLE IF NOT EXISTS public.byok_key_vault_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id uuid NOT NULL REFERENCES public.byok_key_vaults(id) ON DELETE CASCADE,
  shared_with_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'read' CHECK (permission IN ('read','use','admin')),
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (vault_id, shared_with_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.byok_key_vault_shares TO authenticated;
GRANT ALL ON public.byok_key_vault_shares TO service_role;
ALTER TABLE public.byok_key_vault_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vault admins manage shares"
  ON public.byok_key_vault_shares FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.byok_key_vaults v
    JOIN public.tenant_members tm ON tm.tenant_id = v.tenant_id
    WHERE v.id = byok_key_vault_shares.vault_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'tenant_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.byok_key_vaults v
    JOIN public.tenant_members tm ON tm.tenant_id = v.tenant_id
    WHERE v.id = byok_key_vault_shares.vault_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'tenant_admin'
  ));

CREATE POLICY "Shared user reads own grant"
  ON public.byok_key_vault_shares FOR SELECT TO authenticated
  USING (shared_with_user_id = auth.uid());

ALTER TABLE public.byok_keys ADD COLUMN IF NOT EXISTS vault_id uuid REFERENCES public.byok_key_vaults(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_byok_keys_vault_id ON public.byok_keys(vault_id) WHERE vault_id IS NOT NULL;

-- D7: Certifications
CREATE TABLE IF NOT EXISTS public.certification_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  level text NOT NULL DEFAULT 'foundation' CHECK (level IN ('foundation','associate','professional','expert')),
  passing_score_pct integer NOT NULL DEFAULT 70 CHECK (passing_score_pct BETWEEN 50 AND 100),
  duration_minutes integer NOT NULL DEFAULT 30,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.certification_tracks TO authenticated;
GRANT ALL ON public.certification_tracks TO service_role;
ALTER TABLE public.certification_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can browse tracks"
  ON public.certification_tracks FOR SELECT TO authenticated USING (active = true);

CREATE TABLE IF NOT EXISTS public.certification_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL REFERENCES public.certification_tracks(id) ON DELETE CASCADE,
  ordering integer NOT NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  correct_index integer NOT NULL CHECK (correct_index >= 0),
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track_id, ordering)
);
GRANT SELECT ON public.certification_quizzes TO authenticated;
GRANT ALL ON public.certification_quizzes TO service_role;
ALTER TABLE public.certification_quizzes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view quizzes"
  ON public.certification_quizzes FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.certification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL REFERENCES public.certification_tracks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  score_pct numeric(5,2),
  passed boolean,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  certificate_number text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.certification_attempts TO authenticated;
GRANT ALL ON public.certification_attempts TO service_role;
ALTER TABLE public.certification_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own attempts"
  ON public.certification_attempts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users create own attempts"
  ON public.certification_attempts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own attempts"
  ON public.certification_attempts FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

INSERT INTO public.certification_tracks (slug, name, description, level, passing_score_pct, duration_minutes)
VALUES
  ('fvi-certified-builder',           'FVI Certified Builder',           'Build and configure reconciliations, transforms, schedules.', 'associate',    70, 30),
  ('fvi-certified-exceptions-handler','FVI Certified Exceptions Handler','Triage, comment, resolve, and bulk-handle reconciliation breaks.', 'foundation',   70, 30),
  ('fvi-certified-system-admin',      'FVI Certified System Admin',      'Tenant administration, RBAC/SCIM, residency, BYOK, retention.',    'professional', 75, 45)
ON CONFLICT (slug) DO NOTHING;

DO $seed$
DECLARE t_builder uuid; t_exc uuid; t_admin uuid;
BEGIN
  SELECT id INTO t_builder FROM public.certification_tracks WHERE slug='fvi-certified-builder';
  SELECT id INTO t_exc     FROM public.certification_tracks WHERE slug='fvi-certified-exceptions-handler';
  SELECT id INTO t_admin   FROM public.certification_tracks WHERE slug='fvi-certified-system-admin';

  INSERT INTO public.certification_quizzes (track_id, ordering, question, options, correct_index, explanation) VALUES
    (t_builder, 1, 'Which Rekon Studio component defines the matching rule chain?', '["Schedule","Definition","Pipeline","Watcher"]'::jsonb, 1, 'Definitions own matching rules; pipelines orchestrate them.'),
    (t_builder, 2, 'Where do you set carry-forward window for unmatched items?',     '["Schedule","Definition","Tolerance Ladder","Carry Forward Policy"]'::jsonb, 3, 'Carry-forward policies are managed per definition.'),
    (t_builder, 3, 'Which transform rule fills missing values from a reference table?', '["lookup","coalesce","mask","split"]'::jsonb, 0, 'lookup joins via reference_data_tables.'),
    (t_exc,     1, 'Which break lifecycle state requires counterparty input?',       '["new","investigating","pending_counterparty","resolved"]'::jsonb, 2, 'pending_counterparty is the canonical wait state.'),
    (t_exc,     2, 'Bulk-resolution jobs require which approver count by default?',  '["0","1","2","4"]'::jsonb, 1, 'Single approver under default policy; 4-eyes via tenant override.'),
    (t_exc,     3, 'Which audit field links a break to its parent reconciliation run?', '["recon_run_id","run_uid","definition_id","tenant_id"]'::jsonb, 0, 'recon_run_id is the FK on recon_exceptions.'),
    (t_admin,   1, 'Which feature pins customer data to specific regions?',          '["BYOK","Residency","SCIM","RLS"]'::jsonb, 1, 'tenant_data_residency enforces region pinning.'),
    (t_admin,   2, 'Step-up auth requires which factor when changing AI policies?',  '["password","TOTP","SMS","email-magic-link"]'::jsonb, 1, 'TOTP via step_up_grants.'),
    (t_admin,   3, 'Retention purge runs on which schedule by default?',             '["hourly","daily 02:00 UTC","weekly Sunday","monthly"]'::jsonb, 1, 'cron retention-and-watchers fires daily at 02:00 UTC.')
  ON CONFLICT (track_id, ordering) DO NOTHING;
END $seed$;

-- E3: audit_log_chain actor enforcement
CREATE OR REPLACE FUNCTION public.audit_log_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_prev bytea;
  v_payload text;
  v_session_role text;
  v_system_action boolean;
begin
  select row_hash into v_prev from public.audit_log order by id desc limit 1;
  new.prev_hash := v_prev;
  new.actor_user_id := coalesce(new.actor_user_id, auth.uid());

  v_session_role := current_setting('role', true);
  v_system_action := (
    new.actor_user_id IS NOT NULL
    OR v_session_role = 'service_role'
    OR new.scope = 'system'
    OR new.action LIKE 'cron.%'
    OR new.action LIKE 'webhook.%'
    OR new.action LIKE 'system.%'
    OR new.action LIKE 'scim.%'
    OR new.action LIKE 'retention.%'
    OR new.action LIKE 'backup.%'
  );
  if not v_system_action then
    raise exception 'audit_log: actor_user_id required for non-system action "%" (scope=%)', new.action, new.scope
      using errcode = 'check_violation';
  end if;

  v_payload := coalesce(encode(v_prev,'hex'),'')||'|'||coalesce(new.actor_user_id::text,'')||'|'||
               coalesce(new.tenant_id::text,'')||'|'||new.scope||'|'||new.action||'|'||
               coalesce(new.resource_type,'')||'|'||coalesce(new.resource_id,'')||'|'||
               coalesce(new.context::text,'{}')||'|'||new.occurred_at::text;
  new.row_hash := digest(v_payload, 'sha256');
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_byok_vaults_updated_at ON public.byok_key_vaults;
CREATE TRIGGER trg_byok_vaults_updated_at BEFORE UPDATE ON public.byok_key_vaults
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
