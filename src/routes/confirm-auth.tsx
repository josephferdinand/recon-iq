import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { isSupportedEmailOtpType, safeConfirmationDestination } from "@/lib/auth-confirmation";
import { mapAuthError } from "@/lib/auth-audit";
import { supabase } from "@/integrations/supabase/client";

const searchSchema = z.object({
  token_hash: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  redirect_to: z.string().optional(),
});

export const Route = createFileRoute("/confirm-auth")({
  validateSearch: (search) => searchSchema.parse(search),
  component: AuthConfirmationPage,
});

function AuthConfirmationPage() {
  const routeSearch = Route.useSearch();
  const [confirmationRequest] = useState(routeSearch);
  const navigate = useNavigate();
  const [status, setStatus] = useState<"ready" | "verifying" | "complete" | "error">("ready");
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);
  const actionType =
    confirmationRequest.type && isSupportedEmailOtpType(confirmationRequest.type)
      ? confirmationRequest.type
      : null;
  const isRecovery = actionType === "recovery";
  const isValidRequest = Boolean(confirmationRequest.token_hash && actionType);

  // Retain the token only in router state and remove it from the visible URL so
  // it is not copied, bookmarked, or retained in browser history.
  useEffect(() => {
    window.history.replaceState({}, document.title, "/confirm-auth");
  }, []);

  const copy = useMemo(() => {
    if (isRecovery) {
      return {
        eyebrow: "Password recovery",
        title: "Continue your password reset",
        detail:
          "For your security, ReconIQ waits for you to continue before consuming this single-use link.",
        button: "Continue password reset",
      };
    }
    return {
      eyebrow: "Secure verification",
      title: "Continue account verification",
      detail:
        "Confirm that you initiated this action before ReconIQ consumes the single-use link.",
      button: "Continue verification",
    };
  }, [isRecovery]);

  const verify = async () => {
    if (!confirmationRequest.token_hash || !actionType) {
      setStatus("error");
      setError({
        title: "This verification link is incomplete.",
        hint: "Request a new email and use the newest link.",
      });
      return;
    }

    setStatus("verifying");
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: confirmationRequest.token_hash,
      type: actionType,
    });
    if (verifyError) {
      const mapped = mapAuthError(verifyError);
      setStatus("error");
      setError({
        title: "This verification link is not valid.",
        hint:
          mapped.code === "unknown"
            ? "It may have expired or already been used. Request a new email and use only the newest link."
            : mapped.hint,
      });
      return;
    }

    setStatus("complete");
    const destination = safeConfirmationDestination(
      actionType,
      confirmationRequest.redirect_to,
      window.location.origin,
    );
    window.setTimeout(() => navigate({ to: destination as "/home", replace: true }), 500);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--brand-cream)] px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[var(--brand-coffee)]/15 bg-[var(--brand-cream-soft)] p-8 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <ShieldCheck className="h-10 w-10 text-primary" aria-hidden="true" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.detail}</p>
        </div>

        {!isValidRequest && status === "ready" ? (
          <Alert className="mt-6" variant="destructive" role="alert">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>This verification link is incomplete.</AlertTitle>
            <AlertDescription>Request a new email and use only the newest link.</AlertDescription>
          </Alert>
        ) : null}

        {status === "error" && error ? (
          <Alert className="mt-6" variant="destructive" role="alert" aria-live="assertive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{error.title}</AlertTitle>
            {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
          </Alert>
        ) : null}

        {status === "complete" ? (
          <Alert className="mt-6" aria-live="polite">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Verification complete</AlertTitle>
            <AlertDescription>
              {isRecovery ? "Opening the new-password form…" : "Opening ReconIQ…"}
            </AlertDescription>
          </Alert>
        ) : (
          <Button
            type="button"
            className="mt-6 h-11 w-full"
            disabled={!isValidRequest || status === "verifying"}
            onClick={() => void verify()}
          >
            {status === "verifying" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {status === "verifying" ? "Verifying…" : copy.button}
          </Button>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          If you did not request this action, close this page. No account change occurs until you
          continue.
        </p>
        {status === "error" || !isValidRequest ? (
          <p className="mt-3 text-center text-sm">
            <Link to="/auth" search={{ reset: true }} className="underline">
              Request a new password-reset email
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
