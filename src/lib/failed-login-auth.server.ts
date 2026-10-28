import { createClient } from "@supabase/supabase-js";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getRuntimeEnv } from "./runtime-env.server";
import { captureFailedLogin } from "./failed-login-capture.server";
import { publicLoginError, type LoginStage } from "./failed-login-notifications";

export function failedLoginNotificationsEnabled() {
  return getRuntimeEnv("FAILED_LOGIN_NOTIFICATIONS_ENABLED") === "true";
}

function providerConfiguration() {
  const url = getRuntimeEnv("SUPABASE_URL");
  const key = getRuntimeEnv("SUPABASE_AUTH_SECRET_KEY");
  if (!url || !/^https:\/\/(YOUR_PROJECT_REF|YOUR_PROJECT_REF)\.supabase\.co\/?$/.test(url)
    || !key?.startsWith("sb_secret_") || getRuntimeEnv("SUPABASE_AUTH_IP_FORWARDING_VERIFIED") !== "true") {
    throw new Error("Failed-login provider forwarding prerequisites unavailable");
  }
  return { url, key };
}

export function failedLoginProxyReady() {
  if (!failedLoginNotificationsEnabled()) return false;
  try { providerConfiguration(); return true; } catch { return false; }
}

export function failedLoginCanonicalOrigin() {
  const url = getRuntimeEnv("SUPABASE_URL");
  if (url?.replace(/\/$/, "") === "https://YOUR_PROJECT_REF.supabase.co") return "https://app.reconiq.example";
  if (url?.replace(/\/$/, "") === "https://YOUR_PROJECT_REF.supabase.co") return "https://dev.app.reconiq.example";
  throw new Error("Failed-login environment unavailable");
}

export function verifiedLoginRequest(request: Request) {
  const origin = failedLoginCanonicalOrigin();
  // Cloudflare overwrites this header on the canonical hosted ingress. Do not
  // accept caller-supplied forwarded IP, tenant, account ID or country hints.
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  if (!isIP(ip) || new URL(request.url).origin !== origin || request.headers.get("origin") !== origin) {
    throw new Error("Failed-login request origin unavailable");
  }
  return ip;
}

export function createFailedLoginProvider(ip: string, bearer?: string) {
  const { url, key } = providerConfiguration();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { "Sb-Forwarded-For": ip, ...(bearer ? { Authorization: bearer } : {}) },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key); headers.set("Sb-Forwarded-For", ip);
        // No automatic retries on credential verification. Timeout is a truthful
        // unavailable/unknown result; it is never described as a password mismatch.
        return fetch(input, { ...init, headers, signal: AbortSignal.timeout(15000) });
      },
    },
  });
}

export async function loginCaptureDependencies(id: string, stage: LoginStage, ip: string, subject: { email?: string; userId?: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const secret = getRuntimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Failed-login recorder unavailable");
  const binding = createHmac("sha256", secret).update(`${stage}\n${subject.userId ?? subject.email?.trim().toLowerCase()}\n${ip}`).digest("hex");
  const rpc = async (name: string, data: Record<string, unknown>) => {
    const result = await (supabaseAdmin as any).rpc(name, data);
    if (result.error || result.data === null || result.data === false) throw new Error("Failed-login recorder unavailable");
    return result.data;
  };
  return {
    begin: (requestId?: string) => rpc("failed_login_begin", { _id: id, _binding: binding, _stage: stage, _email: subject.email ?? null, _user_id: subject.userId ?? null, _request_id: requestId ?? null }),
    finish: async (outcome: string) => { await rpc("failed_login_finish", { _id: id, _binding: binding, _outcome: outcome }); },
    diagnostic: (code: string, attemptId: string, requestId?: string) => { console.error("[failed-login]", { code, attemptId, ...(requestId ? { requestId } : {}) }); },
  };
}

// Invoked only inside the existing evaluator after a current rule actually
// matches with action=block. No browser-reported outcome or recipient is used.
export async function notifyVerifiedLoginPolicyBlock(attemptId: string, userId: string, request: Request) {
  if (!failedLoginNotificationsEnabled()) return;
  const deps = await loginCaptureDependencies(attemptId, "policy", verifiedLoginRequest(request), { userId });
  const begun = await deps.begin(randomUUID());
  if (begun.acquired || begun.outcome === "pending") {
    for (let retry = 0; retry < 2; retry++) {
      try { await deps.finish("policy_blocked"); return; }
      catch { if (retry === 1) deps.diagnostic("notification_record_unavailable", attemptId, begun.requestId); }
    }
  }
}

export async function serverPasswordSignIn(input: { attemptId: string; email: string; password: string; captchaToken?: string; expectedUserId?: string }, request: Request) {
  if (!failedLoginNotificationsEnabled()) return { mode: "legacy" as const };
  if (!failedLoginProxyReady()) return { mode: "captured" as const, ok: false as const, error: publicLoginError("provider_unavailable") };
  const ip = verifiedLoginRequest(request);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Same existing signin bucket/window/ceiling, counted exactly once, now server
  // enforced atomically. A real control rejection is retained as rate_limited;
  // it never claims that the provider checked or rejected the password.
  const bucket = `auth:signin:${createHash("sha256").update(ip).digest("hex").slice(0,16)}`;
  const rate = await supabaseAdmin.rpc("rate_limit_hit", { _key: bucket, _window_seconds: 300, _limit: 10 });
  const deps = await loginCaptureDependencies(input.attemptId, "password", ip, { email: input.email });
  if (!rate.error && rate.data?.[0]?.allowed === false) {
    const result = await captureFailedLogin<never>(input.attemptId, "password", {
      ...deps, authenticate: async () => ({ value: null, error: { status: 429, code: "over_request_rate_limit" } }),
    });
    return { mode: "captured" as const, ...result };
  }
  const result = await captureFailedLogin(input.attemptId, "password", {
    ...deps,
    authenticate: async () => {
      // Never call signInWithPassword on the shared service-role singleton.
      const provider = createFailedLoginProvider(ip);
      const res = await provider.auth.signInWithPassword({ email: input.email, password: input.password, options: { captchaToken: input.captchaToken } });
      if (!res.error && input.expectedUserId && res.data.user?.id !== input.expectedUserId) {
        return { value: null, error: { code: "invalid_credentials", status: 400 } };
      }
      return { value: res.data.session ? { access_token: res.data.session.access_token, refresh_token: res.data.session.refresh_token } : null, error: res.error };
    },
  });
  return { mode: "captured" as const, ...result };
}
