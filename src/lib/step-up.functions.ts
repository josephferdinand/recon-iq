// Client-safe step-up server function + action-key registry.
//
// The enforcement helpers (requireStepUp / requirePrivilegedAction) live in
// step-up.server.ts so import-protection keeps them out of the client bundle.
// This file only exposes the fn the UI calls to mint a grant, plus the
// action-key enum used by both sides.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const STEP_UP_ACTIONS = [
  "byok.rotate",
  "byok.delete",
  "ip_allowlist.write",
  "billing.change",
  "sso.write",
  "member.role_elevate",
  "platform.impersonate",
  "api_token.create",
  "tenant.delete",
  "auth_provider.toggle",
  "scim.toggle",
  "scim.settings.write",
  "tenant.settings.write",
  "break_glass.policy.write",
  "audit.export",
] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export const grantStepUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { actionKey: StepUpAction; password: string }) =>
    z.object({
      actionKey: z.enum(STEP_UP_ACTIONS),
      password: z.string().min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: userRes } = await context.supabase.auth.getUser();
    const email = userRes.user?.email;
    if (!email) throw new Response("No email on session", { status: 401 });

    const { createClient } = await import("@supabase/supabase-js");
    const verifier = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: pwErr } = await verifier.auth.signInWithPassword({
      email, password: data.password,
    });
    if (pwErr) {
      await context.supabase.from("security_events").insert({
        event_type: "stepup.failed",
        severity: "warning",
        context: { action_key: data.actionKey },
      } as never);
      throw new Response("Invalid password", { status: 401 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: grant, error } = await supabaseAdmin
      .from("step_up_grants")
      .insert({ user_id: context.userId, action_key: data.actionKey } as never)
      .select("id, expires_at")
      .single();
    if (error) throw new Response(error.message, { status: 500 });
    return grant;
  });
