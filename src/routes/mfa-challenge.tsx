import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifyLoginMfaWithNotifications } from "@/lib/failed-login-notifications.functions";
import { failedLoginOutcome, publicLoginError } from "@/lib/failed-login-notifications";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reportAuthEvent } from "@/lib/auth-audit";
import { requiresMfaChallenge, safePostMfaRedirect } from "@/lib/mfa-assurance";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/mfa-challenge")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safePostMfaRedirect(search.redirect),
  }),
  component: MfaChallengePage,
});

type Factor = { id: string; friendly_name?: string; factor_type: string; status: string };

function MfaChallengePage() {
  const navigate = useNavigate();
  const verifyWithNotifications = useServerFn(verifyLoginMfaWithNotifications);
  const search = Route.useSearch();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const user = await supabase.auth.getUser();
      if (!user.data.user) {
        navigate({ to: "/auth", search: { redirect: search.redirect } as never, replace: true });
        return;
      }
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!assurance.error && !requiresMfaChallenge(assurance.data)) {
        navigate({ to: search.redirect as never, replace: true });
        return;
      }
      const result = await supabase.auth.mfa.listFactors();
      const verified = ((result.data?.all ?? []) as Factor[]).filter(
        (factor) => factor.status === "verified" && factor.factor_type === "totp",
      );
      if (active) {
        setFactors(verified);
        setSelected(verified[0]?.id ?? "");
        setLoading(false);
      }
    })().catch(() => {
      if (active) {
        setError("The MFA service is temporarily unavailable.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [navigate, search.redirect]);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || code.length !== 6) return;
    setVerifying(true);
    setError("");
    let failure: { message: string; requestId?: string } | null = null;
    try {
      const captured = await verifyWithNotifications({ data: { attemptId: crypto.randomUUID(), factorId: selected, code } });
      if (captured.mode === "legacy") {
        const result = await supabase.auth.mfa.challengeAndVerify({ factorId: selected, code });
        if (result.error) failure = publicLoginError(failedLoginOutcome(result.error, "mfa"));
      } else if (!captured.ok) {
        failure = captured.error;
      } else {
        const adopted = await supabase.auth.setSession(captured.value);
        if (adopted.error) failure = publicLoginError("provider_unavailable");
      }
    } catch {
      failure = publicLoginError("provider_unavailable");
    }
    if (failure) {
      setError(failure.requestId ? `${failure.message} Reference: ${failure.requestId}` : failure.message);
      reportAuthEvent("auth.mfa_failed", { context: { source: "login_challenge" } });
      setVerifying(false);
      return;
    }
    reportAuthEvent("auth.mfa_verified", { context: { source: "login_challenge" } });
    toast.success("Identity verified");
    navigate({ to: search.redirect as never, replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Multi-factor authentication</CardTitle>
          <CardDescription>Enter the current code from your authenticator app to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking authenticators…</div>
          ) : factors.length === 0 ? (
            <Alert variant="destructive">
              <KeyRound className="h-4 w-4" />
              <AlertTitle>No login authenticator is available</AlertTitle>
              <AlertDescription>
                Your legacy MFA record does not protect Supabase login. Return to your profile and enroll a login authenticator.
                <Button asChild variant="link" className="h-auto px-1"><Link to="/profile">Open Profile Security</Link></Button>
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              {factors.length > 1 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="mfa-factor">Authenticator</Label>
                  <select id="mfa-factor" value={selected} onChange={(event) => setSelected(event.target.value)} className="h-11 w-full rounded-md border bg-background px-3">
                    {factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendly_name ?? "Authenticator app"}</option>)}
                  </select>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="mfa-login-code">Six-digit code</Label>
                <Input id="mfa-login-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
              </div>
              {error ? <Alert variant="destructive" role="alert"><AlertTitle>Verification failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
              <Button type="submit" className="w-full" disabled={verifying || code.length !== 6}>
                {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Verify and continue
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
