import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { passwordSignInWithNotifications, evaluateLoginPolicyWithNotifications } from "@/lib/failed-login-notifications.functions";
import { resolveLandingTenant } from "@/lib/auth-landing.functions";
import { mapAuthError } from "@/lib/auth-audit";
import { requiresMfaChallenge } from "@/lib/mfa-assurance";
import { supabase } from "@/integrations/supabase/client";
import { getTenantBrandingBySlug, type TenantBranding } from "@/lib/tenant-branding.functions";
import { appUrl } from "@/lib/cross-domain";
import { RQApprovedLogo } from "@/components/rq-approved-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, ArrowRight, ShieldCheck, Mail, ExternalLink } from "lucide-react";


export const Route = createFileRoute("/t/$slug/auth")({
  loader: ({ params }) => getTenantBrandingBySlug({ data: { slug: params.slug } }),
  component: TenantAuthPage,
  errorComponent: () => <FallbackError />,
  notFoundComponent: () => <FallbackError />,
});

function FallbackError() {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--brand-coffee-deep)] text-[var(--brand-cream)]">
      <div className="text-center">
        <h1 className="font-display text-2xl">Sign-in unavailable</h1>
        <p className="mt-2 text-sm opacity-80">Please try again shortly.</p>
        <a href={appUrl("/auth")} className="mt-4 inline-block text-sm underline">Go to ReconIQ sign-in</a>
      </div>
    </div>
  );
}

// Locked ReconIQ defaults used when tenant branding is disabled or missing.
const FVI_DEFAULT: Pick<TenantBranding, "primary_hex" | "accent_hex" | "surface_hex" | "ink_hex"> = {
  primary_hex: "#3B2A1F",
  accent_hex: "#C9A24B",
  surface_hex: "#F5EFE3",
  ink_hex: "#1A120B",
};

function TenantAuthPage() {
  const branding = Route.useLoaderData() as TenantBranding | null;
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const signInWithNotifications = useServerFn(passwordSignInWithNotifications);
  const resolveTenant = useServerFn(resolveLandingTenant);
  const evaluateLoginPolicy = useServerFn(evaluateLoginPolicyWithNotifications);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (!error && data.user) navigate({ to: "/$slug/workspace", params: { slug } });
    });
  }, [navigate, slug]);

  const palette = branding ?? FVI_DEFAULT;
  const tenantName = branding?.tenant_name ?? "ReconIQ";
  const headline = branding?.headline ?? "Welcome back";
  const tagline =
    branding?.tagline ??
    "Reconciliation, verified by intelligence — securely sign in to your workspace.";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const captured = await signInWithNotifications({ data: { attemptId: crypto.randomUUID(), email: email.trim(), password } });
      const result = captured.mode === "legacy"
        ? await supabase.auth.signInWithPassword({ email, password })
        : captured.ok ? await supabase.auth.setSession(captured.value) : { error: captured.error };
      if (result.error) {
        const mapped = mapAuthError(result.error);
        const requestId = "requestId" in result.error && typeof result.error.requestId === "string"
          && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.error.requestId) ? result.error.requestId : null;
        toast.error(requestId ? `${mapped.title} Reference: ${requestId}` : mapped.title);
        return;
      }
      const resolved = await resolveTenant({ data: { preferred_slug: slug } });
      // Actual membership-resolved tenant, never a branding record as authority.
      const tenant = "tenant" in resolved && resolved.tenant.slug === slug ? resolved.tenant : null;
      const policy = await evaluateLoginPolicy({ data: { attemptId: crypto.randomUUID(), tenantId: tenant?.id ?? null } });
      if (policy.action === "block") {
        await supabase.auth.signOut({ scope: "local" });
        toast.error("Sign-in blocked by your organization's access policy.");
        return;
      }
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!assurance.error && requiresMfaChallenge(assurance.data)) {
        navigate({ to: "/mfa-challenge", search: { redirect: `/${slug}/workspace` } as never, replace: true });
        return;
      }
      toast.success("Welcome back");
      navigate({ to: "/$slug/workspace", params: { slug } });
    } catch {
      toast.error("Sign-in could not be completed. Please try again shortly.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-screen text-foreground"
      style={
        {
          // Scoped brand-var overrides — never mutate global theme.
          ["--tb-primary" as never]: palette.primary_hex,
          ["--tb-accent" as never]: palette.accent_hex,
          ["--tb-surface" as never]: palette.surface_hex,
          ["--tb-ink" as never]: palette.ink_hex,
          background: `linear-gradient(90deg, ${palette.primary_hex} 56%, ${palette.surface_hex} 56%)`,
          color: palette.ink_hex,
        } as React.CSSProperties
      }
    >
      <div className="relative mx-auto grid min-h-screen max-w-[1280px] grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[1.1fr_1fr] lg:px-12">
        {/* LEFT — tenant brand panel */}
        <section className="flex flex-col" style={{ color: palette.surface_hex }}>
          <div className="flex flex-1 flex-col justify-center">
            <div className="flex items-center gap-5">
              {branding?.logo_url ? (
                <img
                  src={branding.logo_url}
                  alt={`${tenantName} logo`}
                  className="h-20 w-20 rounded-xl bg-white/5 object-contain p-2 ring-1 ring-white/15"
                />
              ) : (
                <RQApprovedLogo className="h-20 w-20 rounded-xl" />
              )}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.32em]" style={{ color: palette.accent_hex }}>
                  Secure workspace sign-in
                </div>
                <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{tenantName}</h1>
              </div>
            </div>

            <h2 className="mt-10 max-w-xl font-display text-[34px] font-semibold leading-tight">
              {headline}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed" style={{ color: `color-mix(in oklab, ${palette.surface_hex} 80%, transparent)` }}>
              {tagline}
            </p>

            <p className="mt-10 flex max-w-md items-start gap-1.5 text-[11px] leading-relaxed" style={{ color: `color-mix(in oklab, ${palette.surface_hex} 70%, transparent)` }}>
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" style={{ color: palette.accent_hex }} />
              Security controls aligned to SOC 2 and ISO 27001 frameworks. We don&rsquo;t claim certifications we haven&rsquo;t earned.
            </p>
          </div>

          <div className="pt-6 text-[11px]" style={{ color: `color-mix(in oklab, ${palette.surface_hex} 60%, transparent)` }}>
            Powered by{" "}
            <Link to="/" className="underline" style={{ color: palette.accent_hex }}>
              ReconIQ
            </Link>
          </div>
        </section>

        {/* RIGHT — sign-in card */}
        <section className="flex items-center justify-center">
          <div className="w-full max-w-md">
            <div
              className="rounded-2xl border p-8 shadow-sm"
              style={{
                background: palette.surface_hex,
                color: palette.ink_hex,
                borderColor: `color-mix(in oklab, ${palette.primary_hex} 18%, transparent)`,
              }}
            >
              <h3 className="font-display text-2xl font-semibold">Sign in</h3>
              <p className="mt-1 text-sm opacity-70">Use your {tenantName} account.</p>

              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs uppercase tracking-wider opacity-70">Email</Label>
                  <Input
                    id="email" type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane.doe@demo-bank.example" className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs uppercase tracking-wider opacity-70">Password</Label>
                  <div className="relative">
                    <Input
                      id="password" type={showPw ? "text" : "password"} required
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••" className="h-11 pr-10"
                    />
                    <button
                      type="button" onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={showPw ? "Hide password" : "Show password"}
                      aria-pressed={showPw}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit" disabled={loading}
                  className="group h-11 w-full text-sm font-semibold"
                  style={{ background: palette.primary_hex, color: palette.surface_hex }}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sign In <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </form>

              {(branding?.support_email || branding?.support_url) && (
                <div className="mt-6 border-t pt-4 text-center text-xs opacity-70"
                     style={{ borderColor: `color-mix(in oklab, ${palette.primary_hex} 12%, transparent)` }}>
                  Need help?{" "}
                  {branding.support_email ? (
                    <a className="inline-flex items-center gap-1 underline" href={`mailto:${branding.support_email}`}>
                      <Mail className="h-3 w-3" /> {branding.support_email}
                    </a>
                  ) : null}
                  {branding.support_email && branding.support_url ? " · " : ""}
                  {branding.support_url ? (
                    <a className="inline-flex items-center gap-1 underline" href={branding.support_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3 w-3" /> Support
                    </a>
                  ) : null}
                </div>
              )}

              <p className="mt-4 text-center text-[11px] opacity-60">
                Not your tenant?{" "}
                <a href={appUrl("/auth")} className="underline">Use ReconIQ sign-in</a>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
