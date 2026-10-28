// Platform-admin controls for per-tenant Sandbox (the 4th, lowest environment).
// Backend enforcement lives in the SECURITY DEFINER `set_tenant_sandbox` RPC
// which rejects non-platform-admin callers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listTenantSandboxStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("tenants")
      .select(
        "id, slug, name, environment, sandbox_enabled, sandbox_enabled_at, sandbox_enabled_by, sandbox_expires_at, sandbox_notes",
      )
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { tenants: data ?? [] };
  });

const setInput = z.object({
  tenant_id: z.string().uuid(),
  enabled: z.boolean(),
  expires_at: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const setTenantSandbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => setInput.parse(v))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_tenant_sandbox", {
      _tenant_id: data.tenant_id,
      _enabled: data.enabled,
      _expires_at: data.expires_at ?? undefined,
      _notes: data.notes ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
