import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { reportAuthEvent, mapAuthError } from "@/lib/auth-audit";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, KeyRound } from "lucide-react";
import { usePasswordPeek } from "@/hooks/use-password-peek";
import {
  RecoveryCallbackError,
  cleanRecoveryCallbackUrl,
  establishRecoverySession,
} from "@/lib/password-recovery-callback";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

/**
 * Completes the Supabase password-recovery flow. Supabase delivers a
 * one-time recovery session via the URL hash; we listen for the
 * PASSWORD_RECOVERY event, accept a new password, and audit the change.
 */
function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"validating" | "ready" | "invalid">("validating");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);
  const [done, setDone] = useState(false);
  const newPeek = usePasswordPeek();
  const confirmPeek = usePasswordPeek();

  useEffect(() => {
    let active = true;
    const validationTimeout = window.setTimeout(() => {
      if (!active) return;
      setStatus("invalid");
      setError({
        title: "This reset link could not be validated.",
        hint: "It may have expired or already been used. Request a new password-reset email.",
      });
    }, 10_000);
    const markReady = () => {
      if (!active) return;
      window.clearTimeout(validationTimeout);
      setStatus("ready");
      setError(null);
      window.history.replaceState(
        {},
        document.title,
        cleanRecoveryCallbackUrl(window.location.href),
      );
    };

    // Keep the provider event path while explicitly supporting callback forms
    // that can be missed during lazy client initialization.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) markReady();
    });

    void establishRecoverySession(supabase.auth, window.location.href)
      .then(({ session }) => {
        if (session) markReady();
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const message =
          cause instanceof RecoveryCallbackError
            ? cause.message
            : "The recovery link is invalid or expired.";
        setStatus("invalid");
        setError({
          title: "This reset link is not valid.",
          hint: message,
        });
        window.history.replaceState(
          {},
          document.title,
          cleanRecoveryCallbackUrl(window.location.href),
        );
      });

    return () => {
      active = false;
      window.clearTimeout(validationTimeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parse = z
      .string()
      .min(12, "Password must be at least 12 characters.")
      .safeParse(password);
    if (!parse.success) {
      setError({ title: parse.error.issues[0].message });
      return;
    }
    if (password !== confirm) {
      setError({ title: "Passwords do not match." });
      return;
    }
    setLoading(true);
    const { data, error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      const mapped = mapAuthError(err);
      setError({ title: mapped.title, hint: mapped.hint });
      reportAuthEvent("auth.password_reset_failed", { context: { code: mapped.code } });
      toast.error(mapped.title);
      return;
    }
    reportAuthEvent("auth.password_reset_completed", {
      email: data.user?.email ?? undefined,
      user_id: data.user?.id,
    });
    setDone(true);
    toast.success("Password updated");
    setTimeout(() => navigate({ to: "/home", replace: true }), 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-[var(--brand-cream)]">
      <div className="w-full max-w-md rounded-2xl border border-[var(--brand-coffee)]/15 bg-[var(--brand-cream-soft)] p-8">
        <div className="flex flex-col items-center text-center">
          <KeyRound className="h-10 w-10 text-primary" />
          <h1 className="mt-3 font-display text-2xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a strong password (minimum 12 characters).
          </p>
        </div>

        {status === "validating" ? (
          <Alert className="mt-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Validating reset link…</AlertTitle>
            <AlertDescription>This normally takes only a few seconds.</AlertDescription>
          </Alert>
        ) : status === "invalid" ? (
          <Alert className="mt-6" variant="destructive" role="alert" aria-live="assertive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{error?.title ?? "This reset link is not valid."}</AlertTitle>
            <AlertDescription>
              {error?.hint ?? "Request a new password-reset email."}{" "}
              <Link to="/auth" search={{ reset: true }} className="underline">
                Request a new one
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : done ? (
          <Alert className="mt-6">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Password updated</AlertTitle>
            <AlertDescription>Redirecting you to your workspace…</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {error ? (
              <Alert variant="destructive" role="alert" aria-live="assertive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{error.title}</AlertTitle>
                {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
              </Alert>
            ) : null}
            <div className="space-y-1.5">
              <Label
                htmlFor="new-password"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                New password
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={newPeek.type}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={newPeek.toggle}
                  aria-label={newPeek.visible ? "Hide password" : "Show password"}
                  aria-pressed={newPeek.visible}
                  className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {newPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="confirm-password"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Confirm password
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={confirmPeek.type}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-11 pr-10"
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
            <Button type="submit" disabled={loading} className="h-11 w-full">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Update password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
