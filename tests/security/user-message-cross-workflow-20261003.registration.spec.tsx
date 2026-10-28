// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { AuthApiError } from "@supabase/auth-js";
import { createSignupAttempt } from "@/lib/signup-registration";

const fixture = vi.hoisted(() => ({
  invite: vi.fn(),
  rpc: vi.fn(),
  domain: vi.fn(),
  getUser: vi.fn(),
  subscription: vi.fn(),
  recovery: new Map<string, { state: string; request_id: string; lease_id?: string }>(),
}));

// Execute the actual public handler and its Zod validator. Only infrastructure
// boundaries are fixtures: no credentials, real provider call, or auth grant.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => {
    let validate: ((input: unknown) => unknown) | undefined;
    const builder = {
      middleware: () => builder,
      validator: (fn: (input: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (input: { data: unknown; context: unknown }) => unknown) =>
        (input: { data?: unknown; context?: unknown } = {}) =>
          fn({ data: validate ? validate(input.data) : input.data, context: input.context }),
    };
    return builder;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://app.reconiq.example/request-invite", {
      headers: { "cf-connecting-ip": "192.0.2.1" },
    }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: () => ({}),
}));
vi.mock("@/lib/rbac-guards.server", () => ({ requireTenantAdmin: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: fixture.rpc,
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: fixture.domain };
      return query;
    },
    auth: { admin: { inviteUserByEmail: fixture.invite } },
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: fixture.getUser,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: fixture.subscription } } }),
    },
  },
}));
vi.mock("@/lib/auth-landing.functions", () => ({ postLoginLanding: vi.fn() }));
vi.mock("@/lib/failed-login-notifications.functions", () => ({
  passwordSignInWithNotifications: vi.fn(),
  evaluateLoginPolicyWithNotifications: vi.fn(),
}));

import { submitSignupInterest } from "@/lib/signup-admission.functions";
import { Route as InviteRoute } from "@/routes/request-invite";
import { Route as AuthRoute } from "@/routes/auth";

const poison = "QA_ONLY_SQL_STACK_password=never-real_OTP=818181_JWT=never-real";
const existingCopy =
  "An account already exists with this email address. Please sign in using your existing account or use the Forgot Password option to reset your password.";

async function mountInvite() {
  const root = createRootRoute({ component: () => <Outlet /> });
  const invite = createRoute({
    getParentRoute: () => root,
    path: "/request-invite",
    component: InviteRoute.options.component,
  });
  const auth = createRoute({
    getParentRoute: () => root,
    path: "/auth",
    component: AuthRoute.options.component,
    validateSearch: AuthRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([invite, auth]),
    history: createMemoryHistory({ initialEntries: ["/request-invite"] }),
    defaultPendingMinMs: 0,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByLabelText("Work email");
  return router;
}

function submit() {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "QA Cross Workflow" } });
  fireEvent.change(screen.getByLabelText("Work email"), {
    target: { value: "cross-workflow@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify email and request access" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  fixture.recovery.clear();
  vi.stubEnv("SUPABASE_PROJECT_REF", "YOUR_PROJECT_REF");
  fixture.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== "signup_invite_recovery") return { data: { allowed: true }, error: null };
    const key = String(args._attempt_id);
    if (args._action === "reserve" && !fixture.recovery.has(key))
      fixture.recovery.set(key, { state: "reserved", request_id: "FVI-ABCDEF123456" });
    const row = fixture.recovery.get(key);
    if (!row) return { data: { state: "not_found" }, error: null };
    let claimed = false;
    if (args._action === "claim" && row.state === "reserved") {
      row.state = "sending";
      row.lease_id = "40000000-0000-4000-8000-000000000001";
      claimed = true;
    }
    if (args._action === "settle") row.state = String(args._outcome);
    return { data: { ...row, claimed, lease_id: claimed ? row.lease_id : undefined }, error: null };
  });
  fixture.domain.mockResolvedValue({ data: { id: "fixture-verified-domain" }, error: null });
  fixture.getUser.mockResolvedValue({ data: { user: null }, error: null });
  fixture.invite.mockResolvedValue({ error: new AuthApiError(poison, 422, "email_exists") });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("20261003 new registration handler-to-route message checks", () => {
  async function checkRecoveryAction(link: string, heading: string, reset: boolean) {
    const router = await mountInvite();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.replace(/\s+/g, " ").trim()).toContain(existingCopy);
    expect(document.body.textContent).not.toContain(poison);
    expect(fixture.invite).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: link }));
    await screen.findByRole("heading", { name: heading });
    expect(router.state.location.pathname).toBe("/auth");
    expect(Boolean(router.state.location.search.reset)).toBe(reset);
    expect(screen.queryByLabelText("Password") !== null).toBe(!reset);
  }

  // Real auth components require browser ResizeObserver. No dummy observer or
  // replacement auth screen is installed to manufacture a navigation pass.
  it.skipIf(typeof globalThis.ResizeObserver === "undefined")(
    "XWF-REG-ACTION: Sign In reaches actual auth mode (SETUP_BLOCK if ResizeObserver is absent)",
    () => checkRecoveryAction("Sign In", "Welcome back", false),
  );
  it("XWF-REG-ACTION: Forgot Password reaches the actual reset mode", () =>
    checkRecoveryAction("Forgot Password", "Reset password", true));

  it("XWF-REG-SAFE: actual unknown provider result cannot leak diagnostics or claim a confirmed send", async () => {
    fixture.invite.mockResolvedValue({
      error: new AuthApiError(poison, 503, "unexpected_failure"),
    });
    await mountInvite();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "couldn’t confirm whether the verification request completed",
    );
    expect(document.body.textContent).not.toContain(poison);
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByLabelText("Work email") as HTMLInputElement).value).toBe(
      "cross-workflow@example.test",
    );
    expect(
      (screen.getByRole("button", { name: "Verify email and request access" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("XWF-REG-DTO: an unknown invitation result carries machine state and safe retry/correlation guidance", async () => {
    fixture.invite.mockResolvedValue({
      error: new AuthApiError(poison, 503, "unexpected_failure"),
    });
    const result = await submitSignupInterest({
      data: {
        ...createSignupAttempt("cross-workflow@example.test", "QA Cross Workflow"),
        mode: "submit",
      },
    });
    expect(JSON.stringify(result)).not.toContain(poison);
    expect.soft(result).toMatchObject({ outcome: "unknown", retryable: false });
    expect.soft(result).toHaveProperty("code");
    expect.soft(result).toHaveProperty("status");
    // No request header is fabricated or echoed as a trusted correlation.
    expect.soft(result).toHaveProperty("requestId");
  });

  it("XWF-REG-UNKNOWN-RETRY: status checks and forged form submits cannot resend an unresolved invitation", async () => {
    fixture.invite.mockResolvedValue({
      error: new AuthApiError(poison, 503, "unexpected_failure"),
    });
    await mountInvite();
    submit();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Check request status" }));
    await waitFor(() =>
      expect(fixture.rpc).toHaveBeenCalledWith(
        "signup_invite_recovery",
        expect.objectContaining({ _action: "check" }),
      ),
    );
    fireEvent.submit(screen.getByLabelText("Work email").closest("form")!);
    await screen.findByRole("alert");
    expect(fixture.invite).toHaveBeenCalledTimes(1);
  });
  it("recovery polling limits preserve machine429 and do not fall back to Auth", async () => {
    fixture.rpc.mockResolvedValue({ data: { allowed: false }, error: null });
    const result = await submitSignupInterest({
      data: {
        ...createSignupAttempt("cross-workflow@example.test", "QA Cross Workflow"),
        mode: "check",
      },
    });
    expect(result).toMatchObject({
      outcome: "unknown",
      retryable: false,
      code: "SIGNUP_RECOVERY_RATE_LIMITED",
      status: 429,
    });
    expect(result.requestId).toBeUndefined();
    expect(fixture.invite).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalledWith("signup_invite_recovery", expect.anything());
  });
  it("missing recovery SQL returns a safe unavailable state and cannot bypass the registry", async () => {
    fixture.rpc.mockImplementation(async (name: string) =>
      name === "signup_invite_recovery"
        ? { data: null, error: { message: poison, code: "PGRST202" } }
        : { data: { allowed: true }, error: null },
    );
    const result = await submitSignupInterest({
      data: {
        ...createSignupAttempt("cross-workflow@example.test", "QA Cross Workflow"),
        mode: "submit",
      },
    });
    expect(result).toMatchObject({ outcome: "unknown", retryable: false, status: 503 });
    expect(JSON.stringify(result)).not.toContain(poison);
    expect(fixture.invite).not.toHaveBeenCalled();
  });
});
