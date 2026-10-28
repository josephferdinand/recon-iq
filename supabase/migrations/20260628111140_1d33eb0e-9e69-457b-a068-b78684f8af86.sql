CREATE TABLE IF NOT EXISTS public.chat_ops_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'slack' CHECK (platform IN ('slack','teams','email')),
  channel TEXT NOT NULL,
  webhook_url TEXT,
  events TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_ops_subscriptions TO authenticated;
GRANT ALL ON public.chat_ops_subscriptions TO service_role;

ALTER TABLE public.chat_ops_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_ops_read_members" ON public.chat_ops_subscriptions
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "chat_ops_write_admins" ON public.chat_ops_subscriptions
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::public.tenant_role)
         OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::public.tenant_role)
              OR public.is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_chat_ops_tenant ON public.chat_ops_subscriptions(tenant_id);

CREATE TRIGGER trg_chat_ops_subscriptions_updated_at
  BEFORE UPDATE ON public.chat_ops_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();