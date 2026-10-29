import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { recoverableSignupInterest, signupInterestSchema, signupDigest, type SignupRecoveryDependencies } from "@/lib/signup-registration";

const tenantInput = z.object({ tenant_id: z.string().uuid() });

export function signupRedirectOrigin(projectRef: string): string {
  if (projectRef === "YOUR_PROJECT_REF") return "https://reconintelligence.app";
  if (projectRef === "YOUR_PROJECT_REF") return "https://reconintelligence.app";
  throw new Error("Signup environment is unavailable");
}

async function assertPlatformAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
  if (error || !data) throw new Error("Not authorized");
}

export const listTenantEmailDomains = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => tenantInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: rows, error } = await (context.supabase as any).from("tenant_email_domains")
      .select("id,tenant_id,domain,verification_token,status,verified_at")
      .eq("tenant_id", data.tenant_id).order("created_at");
    if (error) throw new Error("Unable to load email domains");
    return (rows ?? []).map((row: any) => ({
      id: row.id as string,
      tenant_id: row.tenant_id as string,
      domain: row.domain as string,
      status: row.status as "pending" | "verified" | "suspended",
      txt_name: `_fvi-email-verify.${row.domain}`,
      txt_value: row.verification_token as string,
      verified_at: row.verified_at as string | null,
    }));
  });

export const verifyTenantEmailDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => tenantInput.extend({ domain_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: row, error } = await (context.supabase as any).from("tenant_email_domains")
      .select("id,tenant_id,domain,verification_token,status,verified_at")
      .eq("tenant_id", data.tenant_id).eq("id", data.domain_id).single();
    if (error || !row || row.status !== "pending") throw new Error("Domain unavailable for verification");

    const dns = await import("node:dns/promises");
    const txtName = `_fvi-email-verify.${row.domain}`;
    let matches = false;
    try {
      const records = await dns.resolveTxt(txtName);
      matches = records.some((parts) => parts.join("").trim() === row.verification_token);
    } catch {
      // DNS propagation and temporary lookup failures share the same safe result.
    }
    if (!matches) return { verified: false, txt_name: txtName, txt_value: row.verification_token };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: markError } = await (supabaseAdmin as any).rpc("mark_tenant_email_domain_verified", {
      _domain_id: row.id, _verified_by: context.userId,
    });
    if (markError) throw new Error("Unable to verify email domain");
    return { verified: true, txt_name: txtName, txt_value: row.verification_token };
  });

/** Durable invitation/status recovery; never creates an admission or membership. */
export const submitSignupInterest = createServerFn({ method: "POST" })
  .validator((d: unknown) => signupInterestSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    type DomainLookup = {
      eq(field: "domain" | "status", value: string): DomainLookup;
      maybeSingle(): PromiseLike<{ data: { id: string } | null; error: unknown }>;
    };
    // Narrow bridge until the parent updates generated DB types for this packet.
    const recoveryAdmin = supabaseAdmin as unknown as {
      rpc(
        name: "signup_invite_recovery",
        values: Record<string, unknown>,
      ): PromiseLike<{
        data: Awaited<ReturnType<SignupRecoveryDependencies["record"]>> | null;
        error: unknown;
      }>;
      from(table: "tenant_email_domains"): { select(columns: "id"): DomainLookup };
    };
    // Bound public recovery polling/record creation without consuming the
    // existing email3/IP20 invitation budgets on every status lookup.
    const recoveryIp = getRequest().headers.get("cf-connecting-ip")?.trim();
    if (recoveryIp) {
      const { data: limit, error } = await supabaseAdmin.rpc("rate_limit_hit", {
        _key: `signup:recovery:${await signupDigest(recoveryIp)}`,
        _window_seconds: 60,
        _limit: 60,
      });
      const row = Array.isArray(limit) ? limit[0] : limit;
      if (error || !row?.allowed)
        return {
          accepted: false,
          outcome: "unknown" as const,
          retryable: false,
          code: error ? "SIGNUP_RECOVERY_UNAVAILABLE" : "SIGNUP_RECOVERY_RATE_LIMITED",
          status: error ? 503 : 429,
          requestId: undefined,
        };
    }
    return recoverableSignupInterest(data, {
      record: async (action, values) => {
        const answer = await recoveryAdmin.rpc("signup_invite_recovery", {
          _action: action,
          ...values,
        });
        if (answer.error || !answer.data || typeof answer.data.state !== "string")
          throw new Error("Signup recovery unavailable");
        return answer.data;
      },
      preflight: async (emailKey) => {
        const edgeIp = getRequest().headers.get("cf-connecting-ip")?.trim();
        const keys = [`signup:email:${emailKey}`];
        if (edgeIp) keys.push(`signup:ip:${edgeIp}`);
        for (const key of keys) {
          const { data: result, error } = await supabaseAdmin.rpc("rate_limit_hit", {
            _key: key,
            _window_seconds: 3600,
            _limit: key.startsWith("signup:email:") ? 3 : 20,
          });
          if (error) throw new Error("Signup is temporarily unavailable");
          const rate = Array.isArray(result) ? result[0] : result;
          if (!rate?.allowed) return { proceed: false, code: "SIGNUP_RATE_LIMITED", status: 429 };
        }
        const { data: domain, error } = await recoveryAdmin
          .from("tenant_email_domains")
          .select("id")
          .eq("domain", data.email.split("@")[1])
          .eq("status", "verified")
          .maybeSingle();
        if (error) throw new Error("Signup is temporarily unavailable");
        signupRedirectOrigin(process.env.SUPABASE_PROJECT_REF ?? "");
        return { proceed: Boolean(domain), code: "SIGNUP_NOT_STARTED", status: 503 };
      },
      invite: () =>
        supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
          redirectTo: `${signupRedirectOrigin(process.env.SUPABASE_PROJECT_REF ?? "")}/request-invite`,
          data: {
            full_name: data.full_name,
            name: data.full_name,
            fvi_invite_kind: "domain_signup",
          },
        }),
    });
  });

export const requestSignupAdmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { error } = await (context.supabase as any).rpc("request_tenant_admission");
    if (error) throw new Error("Unable to submit request");
    return { accepted: true };
  });

export const listSignupRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => tenantInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireTenantAdmin(context, data.tenant_id, { fnName: "listSignupRequests" });
    const { data: rows, error } = await (context.supabase as any).from("tenant_signup_requests")
      .select("id,tenant_id,user_id,email,full_name,status,requested_at,decided_at,decided_by")
      .eq("tenant_id", data.tenant_id).order("requested_at", { ascending: false }).limit(200);
    if (error) throw new Error("Unable to load signup requests");
    return rows ?? [];
  });

export const decideSignupRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => tenantInput.extend({
    request_id: z.string().uuid(), decision: z.enum(["approved", "denied"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any).rpc("decide_tenant_admission", {
      _tenant_id: data.tenant_id, _request_id: data.request_id, _decision: data.decision,
    });
    if (error || !row) throw new Error("Unable to decide signup request");
    return row;
  });
