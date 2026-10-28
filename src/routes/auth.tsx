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
  Loader2, Eye, EyeOff, Lock, ArrowRight, ShieldCheck,
  Layers, Sparkles, KeyRound, Workflow, Wand2, FileText,
  LineChart, Bell, Users, Activity, ShieldAlert, History,
  AlertCircle, Mail, CheckCircle2,
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
    <div className="fvi-auth-page relative min-h-screen overflow-hidden text-foreground">
      {/* Full cream background on small/medium so the card sits in the middle */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 xl:hidden"
        style={{ background: "var(--brand-cream)" }}
      />
      {/* Two-tone split only when the brand panel is visible (xl+) */}
      <div
        aria-hidden
        className="fvi-auth-backdrop pointer-events-none absolute inset-0 hidden xl:block"
        style={{
          backgroundImage: "url('/fvi-login-approved-background-20260925.png')",
        }}
      />

      {/* LL-052: Back-to-main link removed — dev/staging app subdomains must show ONLY auth,
          never a marketing affordance. Production (app.reconiq.example) has no marketing
          host to link to anyway; apex reconiq.example is unreachable from app context. */}

      <div className="fvi-auth-shell relative mx-auto grid min-h-screen grid-cols-1 items-center gap-10 px-6 pb-10 pt-20 xl:grid-cols-2">

        {/* LEFT: brand + manifesto (on coffee) — hidden below xl so the login card can truly center */}
        <section className="fvi-auth-story hidden xl:flex flex-col" style={{ color: "var(--brand-cream)" }}>


            <div className="fvi-auth-story-main flex flex-1 flex-col justify-center">
              <div className="fvi-auth-brand flex items-start gap-6">
                <FviApprovedLogo className="fvi-auth-brand-logo h-[140px] w-[140px] shrink-0 rounded-xl" />
                <div className="min-w-0 pt-1">
                  <h1 className="fvi-auth-brand-title font-display text-[44px] font-bold leading-[1.05] tracking-tight">
                    RECONIQ
                  </h1>
                  <div
                    className="mt-1 font-display text-lg font-medium tracking-[0.3em]"
                    style={{ color: "var(--brand-gold)" }}
                  >
                    INTELLIGENCE
                  </div>
                  <div
                    className="mt-3 h-px w-72 bg-[var(--brand-gold)]/60"
                  />
                  <p className="mt-3 font-display text-sm italic" style={{ color: "color-mix(in oklab, var(--brand-cream) 80%, transparent)" }}>
                    "Every break explained. Every figure proven."
                  </p>
                </div>
              </div>

              {/* Platform badge */}
              <div
                className="fvi-auth-platform mt-10 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em]"
                style={{
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 45%, transparent)",
                  background: "color-mix(in oklab, var(--brand-gold) 12%, transparent)",
                  color: "var(--brand-gold)",
                }}
              >
                <Sparkles className="h-3 w-3" />
                Platform v6 — Agentic Operations
              </div>

              <div
                className="fvi-auth-eyebrow mt-5 text-[11px] font-semibold uppercase tracking-[0.32em]"
                style={{ color: "var(--brand-gold)" }}
              >
                The Future of AI-Powered Reconciliation
              </div>
              <h2 className="fvi-auth-headline mt-3 max-w-2xl font-display text-[40px] font-semibold leading-[1.08] tracking-tight">
                Reconciliation,
                <br />
                verified by{" "}
                <span style={{ color: "var(--brand-gold)" }}>intelligence</span>.
              </h2>

              <p
                className="fvi-auth-intro mt-4 max-w-2xl text-sm leading-relaxed"
                style={{ color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)" }}
              >
                Cash &amp; nostro, securities &amp; trades, intercompany &amp; GL — matched, triaged
                and explained by AI agents under enterprise-grade governance. Multi-LLM, no-code,
                zero vendor lock-in.
              </p>

              {/* Capability tiles — 2 columns × 6 rows */}
              <div className="fvi-auth-features mt-7 grid max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                {[
                  { icon: Layers,       title: "20+ matching rules",      sub: "1:1, 1:N, N:N, fuzzy, tolerance, composite keys" },
                  { icon: Sparkles,     title: "Agentic AI triage",       sub: "Auto root-cause, NL rule builder, AIDP for PDFs" },
                  { icon: KeyRound,     title: "BYO-LLM",                 sub: "Bring your own model · token & cost limits" },
                  { icon: Workflow,     title: "Run Orchestrator",        sub: "Cron schedules, retries, run history (90d+)" },
                  { icon: Wand2,        title: "Data Prep pipelines",     sub: "Quality rules, transforms, watchers & connectors" },
                  { icon: FileText,     title: "Break Manager",           sub: "Kanban, side-by-side inspector, 4-eyes approvals" },
                  { icon: LineChart,    title: "Reports & SLA",           sub: "MTTR, ageing, dashboards, scheduled exports" },
                  { icon: Activity,     title: "Live collaboration",      sub: "Presence, comments, attachments, activity timeline" },
                  { icon: Bell,         title: "Notifications",           sub: "Email digests · Slack · Teams · in-app center" },
                  { icon: Users,        title: "Multi-tenant RBAC",       sub: "Groups, per-reconciliation permissions, custom tenant URLs" },
                  { icon: History,      title: "Hash-chained audit",      sub: "Immutable, tenant-isolated, platform-action logged" },
                  { icon: ShieldAlert,  title: "Zero-trust security",     sub: "TOTP MFA · SSO/SAML · IP allowlist · PII redaction" },
                ].map(({ icon: Icon, title, sub }) => (
                  <div
                    key={title}
                    className="fvi-auth-feature group rounded-lg px-3.5 py-2.5 transition"
                  >
                    <div className="fvi-auth-feature-title flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--brand-cream)" }}>
                      <Icon className="h-3.5 w-3.5" style={{ color: "var(--brand-gold)" }} />
                      {title}
                    </div>
                    <div
                      className="fvi-auth-feature-copy mt-0.5 pl-[22px] text-[11.5px] leading-snug"
                      style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}
                    >
                      {sub}
                    </div>
                  </div>
                ))}
              </div>

            </div>

          <div
            className="fvi-auth-story-footer mt-10 flex flex-col gap-1.5 pt-4 text-[11px]"
            style={{
              borderTop: "1px solid color-mix(in oklab, var(--brand-cream) 18%, transparent)",
              color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)",
            }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5" style={{ color: "var(--brand-gold)" }}>
                <Lock className="h-3 w-3" /> SOC 2
              </span>
              <span>· ISO 27001</span>
              <span>· GDPR</span>
              <span>· DORA-ready</span>
              <span>· Configurable data residency</span>
            </div>
            <div style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
              Designed and Architected by ReconIQ Team
            </div>

          </div>

        </section>


        {/* RIGHT: login card */}
        <section className="fvi-auth-signin flex items-center justify-center">
          <div className="fvi-auth-signin-stack w-full max-w-md">
            <FviApprovedLogo className="fvi-auth-primary-logo h-28 w-28 rounded-lg" />
            <div
              className="fvi-auth-form-card relative rounded-2xl border border-[var(--brand-coffee)]/15 bg-[var(--brand-cream-soft)] p-8 shadow-none"
              style={{ color: "var(--brand-coffee-deep)" }}
            >
              <div className="flex flex-col items-center">
                <div className="fvi-auth-maxim mt-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.35em] text-primary">
                  <span>Match</span>
                  <span className="h-1 w-1 rounded-full bg-primary/60" />
                  <span>Explain</span>
                  <span className="h-1 w-1 rounded-full bg-primary/60" />
                  <span>Prove</span>
                </div>
                <p className="fvi-auth-maxim-copy mt-4 max-w-xs text-center font-display text-[12.5px] leading-relaxed text-muted-foreground">
                  Deterministic code does the <span className="font-medium" style={{ color: "var(--brand-gold-ink)" }}>matching</span>.{" "}
                  <span className="font-medium" style={{ color: "var(--brand-gold-ink)" }}>AI</span> explains every break, and{" "}
                  <span className="font-medium" style={{ color: "var(--brand-gold-ink)" }}>people</span> approve every decision.
                </p>
                <h3 className="fvi-auth-welcome mt-5 font-display text-3xl font-semibold">
                  {mode === "signin" ? "Welcome back" : "Reset password"}
                </h3>
                <p className="mt-1 text-center text-sm text-muted-foreground">
                  {mode === "signin"
                    ? "Sign in to your ReconIQ account"
                    : "Enter your email and we'll send a secure reset link."}
                </p>
              </div>

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

              <form onSubmit={onSubmit} className="fvi-auth-form mt-6 space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
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
                    className="h-11 bg-background/60"
                  />
                  {fieldErrors.email ? (
                    <p id="email-error" className="text-[11px] text-destructive">{fieldErrors.email}</p>
                  ) : null}
                </div>

                {mode !== "forgot" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
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
                        className="h-11 bg-background/60 pr-10"
                      />
                      <button
                        type="button"
                        onClick={passwordPeek.toggle}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={passwordPeek.visible ? "Hide password" : "Show password"}
                        aria-pressed={passwordPeek.visible}
                      >
                        {passwordPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {fieldErrors.password ? (
                      <p id="password-error" className="text-[11px] text-destructive">{fieldErrors.password}</p>
                    ) : null}
                  </div>
                ) : null}

                {mode === "signin" ? (
                  <div className="flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={remember}
                        onCheckedChange={(v) => setRemember(!!v)}
                        aria-label="Remember me"
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      className="rounded-sm text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      style={{ color: "var(--brand-gold-ink)" }}
                      onClick={() => { setMode("forgot"); setFormError(null); setResetSent(false); }}
                    >
                      Forgot password?
                    </button>
                  </div>
                ) : null}

                <Button
                  type="submit"
                  disabled={loading || (mode === "forgot" && resetSent)}
                  className="group h-11 w-full text-sm font-semibold"
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {mode === "signin" ? "Sign In" : resetSent ? "Reset link sent" : "Send reset link"}
                  {mode === "forgot" ? <Mail className="ml-2 h-4 w-4" /> : <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
                </Button>

                {mode === "forgot" ? (
                  <button
                    type="button"
                    className="block w-full rounded-sm text-center text-xs text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => { setMode("signin"); setFormError(null); setResetSent(false); }}
                  >
                    ← Back to sign in
                  </button>
                ) : null}
              </form>

              {mode === "signin" ? (
                <p className="fvi-auth-invite mt-4 text-center text-xs text-muted-foreground">
                  New to ReconIQ?{" "}
                  <Link to="/request-invite" className="rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    Sign Up — request an invitation
                  </Link>
                </p>
              ) : null}

              <div className="fvi-auth-footer-line mt-6 h-px bg-[var(--brand-coffee)]/15" />
              <p className="fvi-auth-compliance mt-3 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-primary" /> SOC 2 · ISO 27001 · GDPR · DORA
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
