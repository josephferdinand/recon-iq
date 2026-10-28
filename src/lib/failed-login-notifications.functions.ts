import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Active-session reauthentication never accepts a caller-selected address/id.
export const reauthenticateCurrentPasswordWithNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((value: unknown) => z.object({ attemptId: z.string().uuid(), password: z.string().min(1).max(10000) }).strict().parse(value))
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { serverPasswordSignIn, failedLoginNotificationsEnabled } = await import("./failed-login-auth.server");
    const { publicLoginError, failedLoginOutcome } = await import("./failed-login-notifications");
    if (!failedLoginNotificationsEnabled()) return { mode: "legacy" as const };
    try {
      const identity = await context.supabase.auth.getUser();
      if (identity.error) {
        return { mode: "captured" as const, ok: false as const, error: publicLoginError(failedLoginOutcome(identity.error, "password")) };
      }
      if (identity.data.user?.id !== context.userId || !identity.data.user.email) {
        return { mode: "captured" as const, ok: false as const, error: publicLoginError("verification_failed") };
      }
      return await serverPasswordSignIn({ ...data, email: identity.data.user.email, expectedUserId: context.userId }, getRequest());
    } catch { return { mode: "captured" as const, ok: false as const, error: publicLoginError("provider_unavailable") }; }
  });

export const passwordSignInWithNotifications = createServerFn({ method: "POST" })
  .validator((value: unknown) => z.object({ attemptId: z.string().uuid(), email: z.string().trim().email().max(254), password: z.string().min(1).max(10000), captchaToken: z.string().max(4096).optional() }).strict().parse(value))
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { serverPasswordSignIn } = await import("./failed-login-auth.server");
    try { return await serverPasswordSignIn(data, getRequest()); }
    catch { return { mode: "captured" as const, ok: false as const, error: { code: "provider_unavailable", message: "Sign-in service is temporarily unavailable", status: 503 } }; }
  });

// Re-evaluates current policy on the authenticated server request. A browser's
// claim that a policy blocked sign-in is never accepted as evidence.
export const evaluateLoginPolicyWithNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((value: unknown) => z.object({ attemptId: z.string().uuid(), tenantId: z.string().uuid().nullable() }).strict().parse(value))
  .handler(async ({ data }) => {
    const { evaluateConditionalAccess } = await import("./tenant-admin-batch2.functions");
    return evaluateConditionalAccess({ data: { tenantId: data.tenantId, loginAttemptId: data.attemptId } });
  });

// The current MFA sign-in page uses real TOTP verification and adopts only the
// provider-issued elevated session. Enrollment/profile flows remain separate.
export const verifyLoginMfaWithNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((value: unknown) => z.object({ attemptId: z.string().uuid(), factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict().parse(value))
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { failedLoginNotificationsEnabled, failedLoginProxyReady, verifiedLoginRequest, createFailedLoginProvider, loginCaptureDependencies } = await import("./failed-login-auth.server");
    const { captureFailedLogin } = await import("./failed-login-capture.server");
    const { publicLoginError } = await import("./failed-login-notifications");
    if (!failedLoginNotificationsEnabled()) return { mode: "legacy" as const };
    if (!failedLoginProxyReady()) return { mode: "captured" as const, ok: false as const, error: publicLoginError("provider_unavailable") };
    try {
      const request = getRequest(); const ip = verifiedLoginRequest(request);
      const factors = await context.supabase.auth.mfa.listFactors();
      if (factors.error) {
        const deps = await loginCaptureDependencies(data.attemptId, "mfa", ip, { userId: context.userId });
        const result = await captureFailedLogin<never>(data.attemptId, "mfa", {
          ...deps, authenticate: async () => ({ value: null, error: factors.error }),
        });
        return { mode: "captured" as const, ...result };
      }
      if (!factors.data?.totp.some(f => f.id === data.factorId && f.status === "verified")) {
        return { mode: "captured" as const, ok: false as const, error: publicLoginError("verification_failed") };
      }
      const provider = createFailedLoginProvider(ip, request.headers.get("authorization") ?? "");
      const deps = await loginCaptureDependencies(data.attemptId, "mfa", ip, { userId: context.userId });
      const result = await captureFailedLogin(data.attemptId, "mfa", {
        ...deps,
        authenticate: async () => {
          const res = await provider.auth.mfa.challengeAndVerify({ factorId: data.factorId, code: data.code });
          return { value: res.data ? { access_token: res.data.access_token, refresh_token: res.data.refresh_token } : null, error: res.error };
        },
      });
      return { mode: "captured" as const, ...result };
    } catch { return { mode: "captured" as const, ok: false as const, error: publicLoginError("provider_unavailable") }; }
  });
