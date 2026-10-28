import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { requestSignupAdmission, submitSignupInterest } from "@/lib/signup-admission.functions";
import {
  createSignupAttempt,
  signupAttemptSchema,
  signupRecoveryStorageKey,
  type SignupAttempt,
  type SignupInterestResult,
} from "@/lib/signup-registration";

export const Route = createFileRoute("/request-invite")({
  component: RequestInvitePage,
});

type Phase =
  | "form"
  | "sending"
  | "existing"
  | "unknown"
  | "checking"
  | "not_sent"
  | "verify"
  | "submitting"
  | "pending"
  | "error";

function RequestInvitePage() {
  const submitInterest = useServerFn(submitSignupInterest);
  const requestAdmission = useServerFn(requestSignupAdmission);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [formError, setFormError] = useState("");
  const requested = useRef(false);
  const submitting = useRef(false);
  const admissionSubmitting = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<SignupAttempt | null>(null);
  const [recovery, setRecovery] = useState<SignupInterestResult | null>(null);

  const recoverAttempt = useCallback(
    async (saved: SignupAttempt, mode: "submit" | "check") => {
      if (submitting.current) return;
      submitting.current = true;
      setPhase(mode === "check" ? "checking" : "sending");
      try {
        const result = await submitInterest({ data: { ...saved, mode } });
        if (requested.current) return;
        setRecovery((previous) =>
          result.requestId ? result : { ...result, requestId: previous?.requestId },
        );
        if (result.outcome === "existing") setPhase("existing");
        else if (result.outcome === "accepted") setPhase("verify");
        else if (result.outcome === "not_sent" && result.retryable === true) setPhase("not_sent");
        else setPhase("unknown");
      } catch {
        if (!requested.current) setPhase("unknown");
      } finally {
        submitting.current = false;
      }
    },
    [submitInterest],
  );

  useEffect(() => {
    try {
      const value = sessionStorage.getItem(signupRecoveryStorageKey);
      if (!value) return;
      const parsed = signupAttemptSchema.safeParse(JSON.parse(value));
      if (!parsed.success) {
        setFormError(
          "The saved request could not be read. Contact support before starting another invitation.",
        );
        setPhase("unknown");
        return;
      }
      attempt.current = parsed.data;
      setFullName(parsed.data.full_name);
      setEmail(parsed.data.email);
      void recoverAttempt(parsed.data, "check");
    } catch {
      setFormError(
        "The saved request could not be recovered. Refresh this page or check browser storage before continuing.",
      );
      setPhase("unknown");
    }
  }, [recoverAttempt]);

  const startAnotherEmail = () => {
    try {
      sessionStorage.removeItem(signupRecoveryStorageKey);
    } catch {
      setFormError(
        "The saved request could not be cleared. Check browser storage before continuing.",
      );
      return;
    }
    attempt.current = null;
    setRecovery(null);
    setPhase("form");
    emailInput.current?.focus();
    emailInput.current?.select();
  };

  const submitVerifiedAdmission = useCallback(async () => {
    if (admissionSubmitting.current) return;
    admissionSubmitting.current = true;
    setPhase("submitting");
    try {
      await requestAdmission();
      requested.current = true;
      setPhase("pending");
    } catch {
      requested.current = false;
      setPhase("error");
    } finally {
      admissionSubmitting.current = false;
    }
  }, [requestAdmission]);

  useEffect(() => {
    let mounted = true;
    const completeVerifiedSignup = async () => {
      if (requested.current) return;
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user?.email_confirmed_at || !mounted) return;
      requested.current = true;
      await submitVerifiedAdmission();
    };
    void completeVerifiedSignup();
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN")
        queueMicrotask(() => {
          void completeVerifiedSignup();
        });
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [requestAdmission, submitVerifiedAdmission]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || phase !== "form") return;
    const parsed = z
      .object({
        full_name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email().max(254),
      })
      .safeParse({ full_name: fullName, email });
    if (!parsed.success) {
      setFormError("Enter your name and a valid work email address.");
      return;
    }
    setFormError("");
    try {
      const saved = createSignupAttempt(parsed.data.email, parsed.data.full_name);
      const serialized = JSON.stringify(saved);
      sessionStorage.setItem(signupRecoveryStorageKey, serialized);
      if (sessionStorage.getItem(signupRecoveryStorageKey) !== serialized)
        throw new Error("Recovery storage unavailable");
      attempt.current = saved;
      await recoverAttempt(saved, "submit");
    } catch {
      setFormError(
        "A recoverable request could not be saved. Check browser storage or refresh this page before submitting.",
      );
    }
  };

  return (
    <main className="min-h-dvh bg-[var(--brand-cream)] text-[var(--brand-coffee-deep)] xl:grid xl:grid-cols-2">
      <section className="hidden bg-[#102743] px-12 py-10 text-white xl:flex xl:flex-col xl:justify-center">
        <FviApprovedLogo className="h-28 w-28 rounded-lg" />
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.25em] text-[#d6b46f]">
          ReconIQ
        </p>
        <h1 className="mt-4 max-w-lg font-display text-4xl font-semibold leading-tight">
          Join your organization’s reconciliation workspace
        </h1>
        <p className="mt-5 max-w-lg text-sm leading-relaxed text-slate-200">
          Your verified work email identifies the eligible organization. Its tenant administrator
          decides whether to admit you.
        </p>
        <ol className="mt-9 space-y-5 text-sm text-slate-100">
          <li>1. Request access using your work email.</li>
          <li>2. Verify that email using the link we send.</li>
          <li>3. Wait for your tenant administrator’s decision.</li>
        </ol>
      </section>
      <section className="flex min-h-dvh items-center justify-center px-5 py-8 xl:px-12">
        <div className="w-full max-w-md">
          <FviApprovedLogo className="mx-auto mb-5 h-32 w-32 rounded-lg" />
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <h2 className="text-center font-display text-3xl font-semibold">Sign Up</h2>
            {phase === "verify" ? (
              <p className="mt-5 text-center text-sm leading-relaxed" role="status">
                Your verification request was accepted. Check your inbox for the link; delivery has
                not been confirmed. No workspace access is granted yet.
              </p>
            ) : phase === "submitting" ? (
              <p className="mt-5 text-center text-sm" role="status">
                Submitting your verified admission request…
              </p>
            ) : phase === "pending" ? (
              <p className="mt-5 text-center text-sm leading-relaxed" role="status">
                If your verified work email matches an approved domain, its tenant administrator
                will review your request. No workspace access is granted while admission is pending.
              </p>
            ) : phase === "error" ? (
              <div className="mt-5 text-center text-sm" role="alert">
                <p>
                  Your verified access request could not be confirmed. Sign in again, then retry it
                  here. Repeating this request will not create a second admission request.
                </p>
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => {
                    void submitVerifiedAdmission();
                  }}
                >
                  Retry access request
                </Button>
              </div>
            ) : phase === "existing" ||
              phase === "unknown" ||
              phase === "checking" ||
              phase === "not_sent" ? (
              <div className="mt-5 space-y-3 text-sm" role="alert" aria-live="assertive">
                {phase === "existing" ? (
                  <>
                    <p>
                      An account already exists with this email address. Please sign in using your
                      existing account or use the Forgot Password option to reset your password.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                      <Link
                        to="/auth"
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        Sign In
                      </Link>
                      <Link
                        to="/auth"
                        search={{ reset: true }}
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        Forgot Password
                      </Link>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto px-0 py-0"
                        onClick={startAnotherEmail}
                      >
                        Use Another Email Address
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>
                      {phase === "checking"
                        ? "Checking the existing verification request…"
                        : phase === "not_sent"
                          ? "The original request has not reached the invitation step. Continue that same request when you are ready."
                          : "We couldn’t confirm whether the verification request completed. Check the existing request and your inbox; do not submit another invitation while its outcome is unresolved."}
                    </p>
                    {attempt.current ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={phase === "checking"}
                          onClick={() => {
                            if (attempt.current) void recoverAttempt(attempt.current, "check");
                          }}
                        >
                          Check request status
                        </Button>
                        {phase === "not_sent" && recovery?.retryable === true ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              if (attempt.current) void recoverAttempt(attempt.current, "submit");
                            }}
                          >
                            Continue original request
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-4">
                      <Link
                        to="/auth"
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        Sign In
                      </Link>
                      <Link
                        to="/auth"
                        search={{ reset: true }}
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        Forgot Password
                      </Link>
                    </div>
                    {recovery?.requestId && /^FVI-[A-F0-9]{12}$/.test(recovery.requestId) ? (
                      <p>Request reference: {recovery.requestId}</p>
                    ) : null}
                    {formError ? <p>{formError}</p> : null}
                  </>
                )}
              </div>
            ) : null}
            {(
              ["form", "sending", "existing", "unknown", "checking", "not_sent"] as Phase[]
            ).includes(phase) ? (
              <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
                <p className="text-center text-sm text-muted-foreground">
                  Request admission to your organization’s ReconIQ tenant.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-name">Full name</Label>
                  <Input
                    id="signup-name"
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    required
                    maxLength={120}
                    disabled={phase !== "form" && phase !== "existing"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Work email</Label>
                  <Input
                    ref={emailInput}
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (phase === "existing") startAnotherEmail();
                    }}
                    required
                    maxLength={254}
                    disabled={phase !== "form" && phase !== "existing"}
                  />
                </div>
                {formError && phase === "form" ? (
                  <p className="text-sm text-destructive" role="alert">
                    {formError}
                  </p>
                ) : null}
                <Button type="submit" className="w-full" disabled={phase !== "form"}>
                  {phase === "sending"
                    ? "Sending verification…"
                    : "Verify email and request access"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Submitting does not create tenant membership or grant access.
                </p>
              </form>
            ) : null}
            {phase !== "existing" && !["unknown", "checking", "not_sent"].includes(phase) ? (
              <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have access?{" "}
                <Link to="/auth" className="font-semibold text-primary hover:underline">
                  Sign In
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
