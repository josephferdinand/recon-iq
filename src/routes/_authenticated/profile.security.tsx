/**
 * /profile/security — Deep-linkable sub-route for password changes.
 *
 * Re-auth gate pattern (GitHub/Salesforce): before calling updateUser({ password }),
 * call signInWithPassword({ email, currentPassword }) — if it fails, do NOT
 * proceed. This protects against stale session hijack where an attacker already
 * has a valid session token.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { usePasswordPeek } from "@/hooks/use-password-peek";

import { BackButton } from "@/components/back-button";

import { supabase } from "@/integrations/supabase/client";
import { reportAuthEvent, mapAuthError } from "@/lib/auth-audit";
import { revokeAllSessions } from "@/lib/sessions.functions";
import { useServerFn } from "@tanstack/react-start";
import { reauthenticateCurrentPasswordWithNotifications, verifyLoginMfaWithNotifications } from "@/lib/failed-login-notifications.functions";
import { profileLoginVerification } from "@/lib/profile-login-notifications";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation } from "@tanstack/react-query";
import {
  PasswordChangeFailure,
  PROFILE_PASSWORD_MIN_LENGTH,
  changeProfilePassword,
  safePasswordChangeFailureCode,
} from "@/lib/profile-password-change";

export const Route = createFileRoute("/_authenticated/profile/security")({
  component: ProfileSecurityPage,
});

function ProfileSecurityPage() {
  const navigate = useNavigate();
  const revokeAll = useServerFn(revokeAllSessions);
  const reauthenticate = useServerFn(reauthenticateCurrentPasswordWithNotifications);
  const verifyMfa = useServerFn(verifyLoginMfaWithNotifications);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);
  const currentPeek = usePasswordPeek();
  const nextPeek = usePasswordPeek();
  const confirmPeek = usePasswordPeek();
  const [success, setSuccess] = useState<{
    otherSessionsRevoked: boolean;
    revocationWarning: boolean;
  } | null>(null);

  const changeMutation = useMutation({
    mutationFn: async () => {
      const result = await changeProfilePassword(supabase.auth, {
        currentPassword: current,
        newPassword: next,
        confirmation: confirm,
        signOutOthers,
        mfaCode,
      }, profileLoginVerification(supabase.auth, { password: reauthenticate, mfa: verifyMfa }));

      // Audit
      reportAuthEvent("auth.password_reset_completed", {
        email: result.user.email ?? undefined,
        user_id: result.user.id,
        context: {
          source: "profile_security",
          revoke_others_requested: signOutOthers,
          revoke_others_completed: result.otherSessionsRevoked,
        },
      });

      // Preserve the local revocation ledger after Supabase has actually
      // revoked other refresh sessions. This record is evidence, not revocation.
      if (result.otherSessionsRevoked) {
        try {
          await revokeAll({ data: { reason: "password_change_force_logout" } });
        } catch {
          // Evidence persistence is best-effort; the Supabase revocation succeeded.
        }
      }
      return result;
    },
    onSuccess: (result) => {
      const revocationWarning = signOutOthers && Boolean(result.revocationError);
      setSuccess({
        otherSessionsRevoked: result.otherSessionsRevoked,
        revocationWarning,
      });
      toast.success("Password updated", {
        description: result.otherSessionsRevoked
          ? "All other sessions were signed out."
          : revocationWarning
            ? "Your password changed, but other sessions could not be signed out."
            : "Other sessions remain active. You can keep using the app.",
      });
      // Clear the form fields so the user can see the success state clearly.
      setCurrent("");
      setNext("");
      setConfirm("");
      setMfaCode("");
      setNeedsMfa(false);
      // Do NOT signOut — the user should be able to keep using the app
      // after changing their password. The new password is now active;
      // the existing JWT remains valid until it expires (typically 1 hour).
    },
    onError: (e: unknown) => {
      const failure = e instanceof PasswordChangeFailure ? e : null;
      const mapped = failure?.authError ? mapAuthError(failure.authError) : null;
      const isReauth = failure?.code === "reauthentication";
      const serviceFailure = mapped && ["network", "server_error", "rate_limited"].includes(mapped.code) ? mapped : null;
      if (failure?.code === "mfa_required") {
        setNeedsMfa(true);
        setError({
          title: "Authenticator code required.",
          hint: "Enter the current six-digit code, then submit the password change again.",
        });
        return;
      }
      const message = e instanceof Error ? e.message : "Could not update password";
      setError({
        title: isReauth
          ? mapped?.code === "invalid_credentials" ? "Current password is incorrect." : (mapped?.title ?? "Current password could not be verified.")
          : failure?.code === "mfa_verification"
            ? serviceFailure?.title ?? "Multi-factor verification failed."
            : (mapped?.title ?? message),
        hint: isReauth
          ? mapped?.code === "invalid_credentials" ? "Re-enter the password you currently use to sign in to ReconIQ." : (mapped?.hint ?? "Try again shortly or contact your administrator.")
          : failure?.code === "mfa_verification"
            ? serviceFailure?.hint ?? "Check the current code in your authenticator app and try again."
            : mapped?.hint,
      });
      // Keep provider exception text out of client telemetry/logs; it is not
      // needed to distinguish the actionable password-change failure path.
      const safeFailureCode = safePasswordChangeFailureCode(e);
      console.error("[profile/security] password change failed", safeFailureCode);
      reportAuthEvent("auth.password_reset_requested", {
        context: {
          code: "failed",
          source: "profile_security",
          reason: safeFailureCode,
        },
      });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    changeMutation.mutate();
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <BackButton fallbackTo="/profile" label="Back" className="mb-3" />
        <h1 className="font-display text-2xl font-semibold">Change password</h1>
        <p className="text-sm text-muted-foreground">
          Choose a unique password of at least {PROFILE_PASSWORD_MIN_LENGTH} characters.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Update your password
          </CardTitle>
          <CardDescription>
            For your security, we confirm it's really you by re-checking your current password
            before changing it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="space-y-4" aria-live="polite">
              <Alert variant={success.revocationWarning ? "destructive" : "default"}>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Password updated</AlertTitle>
                <AlertDescription>
                  {success.otherSessionsRevoked
                    ? "Your password has changed and every other session has been signed out. This device remains signed in."
                    : success.revocationWarning
                      ? "Your password changed, but we could not sign out other sessions. Review your active sessions now."
                      : "Your password has changed. Other sessions remain active, as requested."}
                </AlertDescription>
              </Alert>
              <div>
                <Button type="button" onClick={() => navigate({ to: "/profile" })}>
                  Return to profile
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              {error ? (
                <Alert variant="destructive" role="alert" aria-live="assertive">
                  <AlertTitle>{error.title}</AlertTitle>
                  {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
                </Alert>
              ) : null}

              <div className="space-y-1.5">
                <Label
                  htmlFor="current"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Current password
                </Label>
                <div className="relative">
                  <Input
                    id="current"
                    type={currentPeek.type}
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => {
                      setCurrent(e.target.value);
                      setError(null);
                    }}
                    className="h-11 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={currentPeek.toggle}
                    aria-label={currentPeek.visible ? "Hide password" : "Show password"}
                    aria-pressed={currentPeek.visible}
                    className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {currentPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="next"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  New password
                </Label>
                <div className="relative">
                  <Input
                    id="next"
                    type={nextPeek.type}
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => {
                      setNext(e.target.value);
                      setError(null);
                    }}
                    className="h-11 pr-10"
                    required
                    minLength={PROFILE_PASSWORD_MIN_LENGTH}
                    aria-describedby="password-requirements"
                  />
                  <button
                    type="button"
                    onClick={nextPeek.toggle}
                    aria-label={nextPeek.visible ? "Hide password" : "Show password"}
                    aria-pressed={nextPeek.visible}
                    className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {nextPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="confirm"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Confirm new password
                </Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    type={confirmPeek.type}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      setError(null);
                    }}
                    className="h-11 pr-10"
                    required
                    minLength={PROFILE_PASSWORD_MIN_LENGTH}
                  />
                  <button
                    type="button"
                    onClick={confirmPeek.toggle}
                    aria-label={confirmPeek.visible ? "Hide password" : "Show password"}
                    aria-pressed={confirmPeek.visible}
                    className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {confirmPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <p id="password-requirements" className="text-xs text-muted-foreground">
                Use at least {PROFILE_PASSWORD_MIN_LENGTH} characters and do not reuse your current
                password.
              </p>

              {needsMfa ? (
                <div className="space-y-1.5">
                  <Label htmlFor="password-change-mfa-code" className="text-xs uppercase tracking-wider text-muted-foreground">
                    Authenticator code
                  </Label>
                  <Input
                    id="password-change-mfa-code"
                    value={mfaCode}
                    onChange={(event) => {
                      setMfaCode(event.target.value.replace(/\D/gu, "").slice(0, 6));
                      setError(null);
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="h-11"
                    required
                  />
                </div>
              ) : null}

              <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
                <Checkbox
                  id="signout-others"
                  checked={signOutOthers}
                  onCheckedChange={(v) => setSignOutOthers(v === true)}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="signout-others" className="text-sm font-medium">
                    <LogOut className="mr-1 inline h-3.5 w-3.5" /> Sign out of all other devices
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Recommended. Other active sessions will need to sign in again with your new
                    password.
                  </p>
                </div>
              </div>

              <Button
                type="submit"
                className="h-11 w-full"
                disabled={
                  changeMutation.isPending ||
                  !current ||
                  !next ||
                  !confirm ||
                  (needsMfa && mfaCode.length !== 6)
                }
              >
                {changeMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                Update password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
