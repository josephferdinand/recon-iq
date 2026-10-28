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
  head: () => ({
    meta: [
      { title: "Request access — ReconIQ" },
      {
        name: "description",
        content:
          "Request access to your organization’s ReconIQ workspace. Verify your work email, then your tenant administrator reviews your admission.",
      },
      { property: "og:title", content: "Request access — ReconIQ" },
      {
        property: "og:description",
        content: "Verify your work email and request admission to your organization’s ReconIQ tenant.",
      },
      { property: "og:url", content: "https://reconintelligence.app/request-invite" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/request-invite" }],
  }),
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
    <main className="min-h-dvh bg-black text-[#f5f5f7] xl:grid xl:grid-cols-2">
      <section className="hidden border-r border-white/10 bg-[#0b0b0f] px-12 py-10 text-[#f5f5f7] xl:flex xl:flex-col xl:justify-center">
        <FviApprovedLogo className="h-28 w-28 rounded-lg" />
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-[#86868b]">
          ReconIQ
        </p>
        <h1 className="mt-4 max-w-lg font-display text-4xl font-semibold leading-tight">
          Join your organization’s reconciliation workspace
        </h1>
        <p className="mt-5 max-w-lg text-sm leading-relaxed text-[#a1a1a6]">
          Your verified work email identifies the eligible organization. Its tenant administrator
          decides whether to admit you.
        </p>
        <ol className="mt-9 space-y-5 text-sm text-[#d4d4da]">
          <li>1. Request access using your work email.</li>
          <li>2. Verify that email using the link we send.</li>
          <li>3. Wait for your tenant administrator’s decision.</li>
        </ol>
      </section>
      <section className="flex min-h-dvh items-center justify-center bg-black px-5 py-8 xl:px-12">
        <div className="w-full max-w-md">
          <FviApprovedLogo className="mx-auto mb-5 h-32 w-32 rounded-lg xl:hidden" />
          <div className="rounded-3xl border border-white/10 bg-[#161617] p-7">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-[#86868b]">Request access</p>
            <h2 className="mt-2 text-center font-display text-3xl font-semibold">Sign Up</h2>
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
                  className="mt-4 border-white/20 bg-transparent text-[#f5f5f7] hover:bg-white/10 hover:text-white"
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
                        className="font-semibold text-[#2997ff] underline-offset-4 hover:text-white hover:underline"
                      >
                        Sign In
                      </Link>
                      <Link
                        to="/auth"
                        search={{ reset: true }}
                        className="font-semibold text-[#2997ff] underline-offset-4 hover:text-white hover:underline"
                      >
                        Forgot Password
                      </Link>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto px-0 py-0 text-[#2997ff] hover:text-white"
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
                          className="border-white/20 bg-transparent text-[#f5f5f7] hover:bg-white/10 hover:text-white"
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
                            className="border-white/20 bg-transparent text-[#f5f5f7] hover:bg-white/10 hover:text-white"
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
                        className="font-semibold text-[#2997ff] underline-offset-4 hover:text-white hover:underline"
                      >
                        Sign In
                      </Link>
                      <Link
                        to="/auth"
                        search={{ reset: true }}
                        className="font-semibold text-[#2997ff] underline-offset-4 hover:text-white hover:underline"
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
                <p className="text-center text-sm text-[#a1a1a6]">
                  Request admission to your organization’s ReconIQ tenant.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-name" className="text-sm font-medium text-[#f5f5f7]">Full name</Label>
                  <Input
                    id="signup-name"
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    required
                    maxLength={120}
                    disabled={phase !== "form" && phase !== "existing"}
                    className="h-11 rounded-xl border-white/15 bg-[#1c1c1f] px-3.5 text-[#f5f5f7] placeholder:text-[#86868b] focus-visible:ring-2 focus-visible:ring-[#2997ff]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email" className="text-sm font-medium text-[#f5f5f7]">Work email</Label>
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
                    aria-describedby="signup-email-helper"
                    className="h-11 rounded-xl border-white/15 bg-[#1c1c1f] px-3.5 text-[#f5f5f7] placeholder:text-[#86868b] focus-visible:ring-2 focus-visible:ring-[#2997ff]"
                  />
                  <p id="signup-email-helper" className="text-xs text-[#86868b]">
                    Use the work email your organization uses — we’ll send a verification link there.
                  </p>
                </div>
                {formError && phase === "form" ? (
                  <p className="text-sm text-red-400" role="alert">
                    {formError}
                  </p>
                ) : null}
                <Button type="submit" className="h-11 w-full bg-white text-black hover:bg-white/85" disabled={phase !== "form"}>
                  {phase === "sending"
                    ? "Sending verification…"
                    : "Verify email and request access"}
                </Button>
                <p className="text-center text-xs text-[#86868b]">
                  Submitting does not create tenant membership or grant access.
                </p>
              </form>
            ) : null}
            {phase !== "existing" && !["unknown", "checking", "not_sent"].includes(phase) ? (
              <p className="mt-6 text-center text-sm text-[#a1a1a6]">
                Already have access?{" "}
                <Link to="/auth" className="font-semibold text-[#2997ff] hover:text-white hover:underline">
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
