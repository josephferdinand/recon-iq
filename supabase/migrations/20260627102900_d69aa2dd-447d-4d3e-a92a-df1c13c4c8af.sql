
-- 1) New columns
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'workspace'
    CHECK (scope IN ('workspace','tenant','platform')),
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general_question',
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recon_id uuid NULL REFERENCES public.recon_definitions(id) ON DELETE SET NULL;

-- 2) Allow tenant_id to be null for platform-scope tickets
ALTER TABLE public.support_tickets
  ALTER COLUMN tenant_id DROP NOT NULL;

-- Enforce: tenant_id null only when scope=platform
ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_tenant_scope_chk;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_tenant_scope_chk
  CHECK ((scope = 'platform') OR (tenant_id IS NOT NULL));

-- Helpful index
CREATE INDEX IF NOT EXISTS support_tickets_scope_status_idx
  ON public.support_tickets (scope, status);
CREATE INDEX IF NOT EXISTS support_tickets_category_idx
  ON public.support_tickets (category);

-- 3) Rewrite RLS policies to support all 3 scopes
DROP POLICY IF EXISTS "ticket read" ON public.support_tickets;
DROP POLICY IF EXISTS "ticket create as member" ON public.support_tickets;
DROP POLICY IF EXISTS "ticket update tenant or platform" ON public.support_tickets;

CREATE POLICY "ticket read"
ON public.support_tickets FOR SELECT
USING (
  created_by = auth.uid()
  OR (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id))
  OR public.is_platform_admin(auth.uid())
);

CREATE POLICY "ticket create"
ON public.support_tickets FOR INSERT
WITH CHECK (
  created_by = auth.uid()
  AND (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope IN ('workspace','tenant') AND tenant_id IS NOT NULL
        AND public.is_tenant_member(auth.uid(), tenant_id))
  )
);

CREATE POLICY "ticket update"
ON public.support_tickets FOR UPDATE
USING (
  created_by = auth.uid()
  OR (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  OR public.is_platform_admin(auth.uid())
)
WITH CHECK (
  created_by = auth.uid()
  OR (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  OR public.is_platform_admin(auth.uid())
);

-- 4) Update ticket_messages policies to handle null tenant_id (platform tickets)
DROP POLICY IF EXISTS "msg read" ON public.ticket_messages;
DROP POLICY IF EXISTS "msg insert" ON public.ticket_messages;

CREATE POLICY "msg read"
ON public.ticket_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND (
        t.created_by = auth.uid()
        OR (t.tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), t.tenant_id))
        OR public.is_platform_admin(auth.uid())
      )
      AND (
        NOT ticket_messages.internal_note
        OR (t.tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), t.tenant_id, 'tenant_admin'))
        OR public.is_platform_admin(auth.uid())
      )
  )
);

CREATE POLICY "msg insert"
ON public.ticket_messages FOR INSERT
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND (
        t.created_by = auth.uid()
        OR (t.tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), t.tenant_id))
        OR public.is_platform_admin(auth.uid())
      )
  )
);
