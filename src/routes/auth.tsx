import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { reportAuthEvent, mapAuthError } from "@/lib/auth-audit";
import { requiresMfaChallenge } from "@/lib/mfa-assurance";
import { postLoginLanding } from "@/lib/auth-landing.functions";
import { passwordSignInWithNotifications, evaluateLoginPolicyWithNotifications } from "@/lib/failed-login-notifications.functions";
import { usePasswordPeek } from "@/hooks/use-password-peek";

import {
  Loader2, Eye, EyeOff, ArrowRight, ShieldCheck,
  AlertCircle, Mail, CheckCircle2, Check,
} from "lucide-react";

const searchSchema = z.object({
  redirect: z.string().optional(),
  tenant: z.string().trim().min(1).max(80).optional(),
  reset: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const resolveLanding = useServerFn(postLoginLanding);
  const signInWithNotifications = useServerFn(passwordSignInWithNotifications);
  const evaluateLoginPolicy = useServerFn(evaluateLoginPolicyWithNotifications);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passwordPeek = usePasswordPeek();
  const [remember, setRemember] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot">(
    search?.reset ? "forgot" : "signin",
  );
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<{ title: string; hint?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [resetSent, setResetSent] = useState(false);

  // If already signed in, route straight to the right landing surface.
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data, error }) => {
      if (error || !data.user) return;
      try {
        const res = await resolveLanding({ data: { preferred_slug: search?.tenant } });
        navigate({ to: res.path as any, replace: true });
      } catch {
        navigate({ to: "/home", replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Client-side validation. Returns true when inputs are well-formed and
   * sets per-field error messages otherwise.
   */
  const validateForm = (): boolean => {
    const errs: { email?: string; password?: string } = {};
    const emailResult = z.string().trim().toLowerCase().email().max(254).safeParse(email);
    if (!emailResult.success) errs.email = "Enter a valid email address (e.g. you@company.com).";

    if (mode !== "forgot") {
      if (!password) {
        errs.password = "Password is required.";
      }
    }
    setFieldErrors(errs);
    setFormError(null);
    return Object.keys(errs).length === 0;
  };

  const handleAuthError = (err: unknown) => {
    const mapped = mapAuthError(err);
    const requestId = err && typeof err === "object" && "requestId" in err && typeof err.requestId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(err.requestId) ? err.requestId : null;
    const hint = requestId && err && typeof err === "object" && "hint" in err && typeof err.hint === "string" ? err.hint : mapped.hint;
    setFormError({ title: mapped.title, hint: requestId ? `${hint ?? "Try again or contact your administrator."} Reference: ${requestId}` : hint });
    // Browser telemetry is advisory; only the server/provider path queues mail.
    reportAuthEvent("auth.failed_login", { context: { code: mapped.code } });
    toast.error(mapped.title);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);

    // Forgot-password retains its existing rate control. Captured sign-in is
    // limited once on the server; legacy fallback retains its current limiter.
    const legacyRateLimit = async (label: "reset" | "signin") => {
      try {
        const { checkAuthRateLimit } = await import("@/lib/security/auth-rate-limit.functions");
        const rl = await checkAuthRateLimit({
          data: { label },
        });
        if (!rl.allowed) {
          setLoading(false);
          setFormError({
            title: "Too many attempts",
            hint: `Please wait ${rl.retryAfterSec}s before trying again.`,
          });
          toast.error("Too many attempts — please wait a moment.");
          return false;
        }
      } catch {
        // fail-open — rate limit is defence-in-depth, not the primary gate.
      }
      return true;
    };

    if (mode === "signin") {
      let result;
      try {
        const captured = await signInWithNotifications({ data: { attemptId: crypto.randomUUID(), email: email.trim(), password } });
        if (captured.mode === "legacy") {
          if (!await legacyRateLimit("signin")) return;
          result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        } else if (!captured.ok) {
          setLoading(false);
          return handleAuthError(captured.error);
        } else {
          // Adopt only the provider-issued session; existing landing, policy and
          // MFA step-up checks below remain authoritative.
          result = await supabase.auth.setSession(captured.value);
        }
      } catch {
        setLoading(false);
        return handleAuthError({ message: "Sign-in service is temporarily unavailable", status: 503 });
      }
      const { data, error } = result;
      if (error) {
        setLoading(false);
        return handleAuthError(error);
      }
      reportAuthEvent("auth.success_login", {
        email: data.user?.email ?? email,
        user_id: data.user?.id,
        context: { remember },
      });
      try {
        const res = await resolveLanding({ data: { preferred_slug: search?.tenant } });
        // Conditional-access evaluation (T-17 wiring): block or step-up before landing.
        try {
          const evalRes = await evaluateLoginPolicy({
            data: { attemptId: crypto.randomUUID(), tenantId: (res as any).tenant?.id ?? (res as any).tenant_id ?? null },
          });
          if (evalRes.action === "block") {
            await supabase.auth.signOut();
            setLoading(false);
            setFormError({
              title: "Access blocked by policy",
              hint: `Rule "${evalRes.matched?.name ?? "conditional access"}" denied this sign-in.`,
            });
            reportAuthEvent("auth.failed_login", { email, context: { reason: "conditional_access_block", ruleId: evalRes.matched?.id } });
            toast.error("Sign-in blocked by tenant conditional-access policy.");
            return;
          }
          if (evalRes.action === "step_up") {
            toast.warning(`Step-up required by policy "${evalRes.matched?.name ?? "conditional access"}".`);
          }
        } catch {
          // fail-open — policy evaluator is defence-in-depth.
        }
        toast.success("Welcome back");
        const dest = (search?.redirect as string | undefined) || res.path;
        const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!assurance.error && requiresMfaChallenge(assurance.data)) {
          navigate({ to: "/mfa-challenge", search: { redirect: dest } as never, replace: true });
          return;
        }
        navigate({ to: dest as any, replace: true });
      } catch {
        navigate({ to: "/home", replace: true });
      } finally {
        setLoading(false);
      }
    } else {
      // forgot
      if (!await legacyRateLimit("reset")) return;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setLoading(false);
      if (error) {
        const mapped = mapAuthError(error);
        setFormError({ title: mapped.title, hint: mapped.hint });
        toast.error(mapped.title);
        return;
      }
      reportAuthEvent("auth.password_reset_requested", { email });
      setResetSent(true);
      toast.success("Reset link sent — check your email");
    }
  };

  return (
    <div className="grid min-h-screen bg-[#f5f5f7] text-neutral-900 antialiased lg:grid-cols-[1.05fr_1fr]">
      {/* LEFT — Onyx brand panel (large screens) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0b0b0f] px-12 py-10 text-neutral-100 lg:flex xl:px-16">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/[0.04]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-white/[0.03]" aria-hidden />

        <div className="relative flex items-center gap-3">
          <FviApprovedLogo className="h-11 w-11 rounded-xl" />
          <div className="leading-tight">
            <p className="font-display text-lg font-bold tracking-tight">RECONIQ</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-neutral-400">Intelligence</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-[1.12] tracking-tight xl:text-[44px]">
            Reconciliation,<br />verified by intelligence.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-neutral-400">
            Deterministic code does the matching. AI explains every break, and people approve every decision.
          </p>
          <ul className="mt-8 space-y-3.5 text-sm text-neutral-300">
            {[
              "Every break explained, with the evidence on one screen",
              "Human approval before anything changes state",
              "A hash-chained audit trail for every action",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10">
                  <Check className="h-3 w-3" aria-hidden />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative space-y-2 text-xs leading-relaxed text-neutral-500">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
            <span>
              Security controls aligned to SOC 2 and ISO 27001 frameworks. We don&rsquo;t claim certifications we haven&rsquo;t earned.{" "}
              <Link to="/security" className="font-medium text-neutral-300 underline-offset-4 hover:underline">
                Our security approach
              </Link>
            </span>
          </p>
          <p>&copy; 2026 ReconIQ. All rights reserved.</p>
        </div>
      </aside>

      {/* RIGHT — sign-in */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <FviApprovedLogo className="h-14 w-14 rounded-2xl" />
            <p className="mt-3 font-display text-xl font-bold tracking-tight">RECONIQ</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-neutral-500">Intelligence</p>
          </div>

          <div className="rounded-3xl border border-black/[0.06] bg-white p-7 shadow-[0_8px_30px_rgba(0,0,0,0.06)] sm:p-8">
            <h2 className="font-display text-[26px] font-semibold tracking-tight">
              {mode === "signin" ? "Welcome back" : "Reset password"}
            </h2>
            <p className="mt-1.5 text-sm text-neutral-500">
              {mode === "signin"
                ? "Sign in to your ReconIQ account to continue."
                : "Enter your email and we'll send a secure reset link."}
            </p>

            {formError ? (
              <Alert variant="destructive" className="mt-5" role="alert" aria-live="assertive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{formError.title}</AlertTitle>
                {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
              </Alert>
            ) : null}

            {mode === "forgot" && resetSent ? (
              <Alert className="mt-5" role="status" aria-live="polite">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Check your inbox</AlertTitle>
                <AlertDescription>
                  If an account exists for <strong>{email}</strong>, we just emailed a password-reset link.
                  It expires in 60 minutes for your security.
                </AlertDescription>
              </Alert>
            ) : null}

            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[13px] font-medium text-neutral-700">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane.doe@demo-bank.example"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                  className="h-11 rounded-xl border-neutral-300 bg-white px-3.5 text-[15px] shadow-none focus-visible:ring-2 focus-visible:ring-neutral-900/80"
                />
                {fieldErrors.email ? (
                  <p id="email-error" className="text-xs text-destructive">{fieldErrors.email}</p>
                ) : null}
              </div>

              {mode !== "forgot" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-[13px] font-medium text-neutral-700">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={passwordPeek.type}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby={fieldErrors.password ? "password-error" : undefined}
                      className="h-11 rounded-xl border-neutral-300 bg-white px-3.5 pr-10 text-[15px] shadow-none focus-visible:ring-2 focus-visible:ring-neutral-900/80"
                    />
                    <button
                      type="button"
                      onClick={passwordPeek.toggle}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-neutral-400 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/60"
                      aria-label={passwordPeek.visible ? "Hide password" : "Show password"}
                      aria-pressed={passwordPeek.visible}
                    >
                      {passwordPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {fieldErrors.password ? (
                    <p id="password-error" className="text-xs text-destructive">{fieldErrors.password}</p>
                  ) : null}
                </div>
              ) : null}

              {mode === "signin" ? (
                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-neutral-600">
                    <Checkbox
                      checked={remember}
                      onCheckedChange={(v) => setRemember(!!v)}
                      aria-label="Remember me"
                    />
                    Remember me
                  </label>
                  <button
                    type="button"
                    className="rounded-sm text-[13px] font-medium text-neutral-900 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/60"
                    onClick={() => { setMode("forgot"); setFormError(null); setResetSent(false); }}
                  >
                    Forgot password?
                  </button>
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={loading || (mode === "forgot" && resetSent)}
                className="group h-11 w-full rounded-xl bg-[#0b0b0f] text-sm font-semibold text-white shadow-none hover:bg-black focus-visible:ring-2 focus-visible:ring-neutral-900/60"
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {mode === "signin" ? "Sign In" : resetSent ? "Reset link sent" : "Send reset link"}
                {mode === "forgot" ? <Mail className="ml-2 h-4 w-4" /> : <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
              </Button>

              {mode === "forgot" ? (
                <button
                  type="button"
                  className="block w-full rounded-sm text-center text-[13px] text-neutral-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/60"
                  onClick={() => { setMode("signin"); setFormError(null); setResetSent(false); }}
                >
                  &larr; Back to sign in
                </button>
              ) : null}
            </form>

            {mode === "signin" ? (
              <p className="mt-5 text-center text-[13px] text-neutral-500">
                New to ReconIQ?{" "}
                <Link to="/request-invite" className="rounded-sm font-semibold text-neutral-900 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/60">
                  Sign Up &mdash; request an invitation
                </Link>
              </p>
            ) : null}
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-neutral-500">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Protected by multi-factor authentication and tenant isolation.
          </p>
        </div>
      </main>
    </div>
  );
}
