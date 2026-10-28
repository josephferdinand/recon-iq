import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requirePrivilegedAction } from "@/lib/step-up.server";

export type AuthProviderRow = {
  provider: string;
  enabled: boolean;
  label: string;
  description: string | null;
  updated_at: string;
};

/** Public read — used by login page + admin panel. Calls a SECURITY DEFINER
 *  RPC that returns only the enabled providers with safe fields, so the
 *  underlying `platform_auth_providers` table no longer needs anon SELECT.
 *  Uses raw PostgREST fetch to stay compatible with both legacy JWT and new
 *  `sb_publishable_*` opaque publishable-key formats. */
export const listAuthProviders = createServerFn({ method: "GET" }).handler(async () => {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const res = await fetch(`${url}/rest/v1/rpc/list_public_auth_providers`, {
    method: "POST",
    headers: {
      apikey: key,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`listAuthProviders failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const rows = (await res.json()) as Array<Omit<AuthProviderRow, "updated_at">>;
  // Fill updated_at with epoch — the public RPC intentionally omits it.
  return rows.map((r) => ({ ...r, updated_at: "1970-01-01T00:00:00Z" })) as AuthProviderRow[];
});

/** Platform-admin write — RLS enforces platform_admin. */
export const setAuthProviderEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((raw) =>
    z.object({ provider: z.string().min(1), enabled: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await requirePrivilegedAction(context, "auth_provider.toggle", {
      resourceType: "platform_auth_provider",
      resourceId: data.provider,
      payload: { enabled: data.enabled },
    });
    const { error } = await context.supabase
      .from("platform_auth_providers")
      .update({ enabled: data.enabled })
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
