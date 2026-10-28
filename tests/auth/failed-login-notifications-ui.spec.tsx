// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ password: vi.fn(), policy: vi.fn(), landing: vi.fn(), navigate: vi.fn(), user: vi.fn(), legacySignIn: vi.fn(), setSession: vi.fn(), reset: vi.fn(), signOut: vi.fn(), assurance: vi.fn(), rate: vi.fn(), report: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options, useNavigate: () => mocks.navigate, useSearch: () => ({}), Link: ({ to, children }: any) => <a href={to}>{children}</a> }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/failed-login-notifications.functions", () => ({ passwordSignInWithNotifications: mocks.password, evaluateLoginPolicyWithNotifications: mocks.policy }));
vi.mock("@/lib/auth-landing.functions", () => ({ postLoginLanding: mocks.landing }));
vi.mock("@/lib/security/auth-rate-limit.functions", () => ({ checkAuthRateLimit: mocks.rate }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: mocks.user, signInWithPassword: mocks.legacySignIn, setSession: mocks.setSession, resetPasswordForEmail: mocks.reset, signOut: mocks.signOut, mfa: { getAuthenticatorAssuranceLevel: mocks.assurance } } } }));
vi.mock("@/lib/auth-audit", async importOriginal => ({ ...await importOriginal<any>(), reportAuthEvent: mocks.report }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
import { Route } from "@/routes/auth";
const Page = Route.component as React.ComponentType;
function submit() {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "owned@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-invalid" } });
  fireEvent.submit(screen.getByLabelText("Email address").closest("form")!);
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  mocks.password.mockResolvedValue({ mode: "captured", ok: false, error: { message: "Invalid login credentials", status: 400 } });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.landing.mockResolvedValue({ path: "/home", tenant_id: null });
  mocks.policy.mockResolvedValue({ action: "allow", matched: null });
  mocks.setSession.mockResolvedValue({ data: { user: { id: "owned", email: "owned@example.test" } }, error: null });
  mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe("current sign-in failure notification UI boundary", () => {
  it("calls trusted sign-in once per distinct submit, retains safe browser telemetry", async () => {
    render(<Page />); submit(); await screen.findByRole("alert");
    expect(mocks.password).toHaveBeenCalledTimes(1); expect(mocks.legacySignIn).not.toHaveBeenCalled(); expect(mocks.setSession).not.toHaveBeenCalled();
    const first = mocks.password.mock.calls[0][0].data.attemptId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.report).toHaveBeenCalledWith("auth.failed_login", { context: { code: "invalid_credentials" } });
    submit(); await waitFor(() => expect(mocks.password).toHaveBeenCalledTimes(2));
    expect(mocks.password.mock.calls[1][0].data.attemptId).not.toBe(first);
  });
  it("password reset outage never calls the trusted sign-in/notification path", async () => {
    mocks.reset.mockResolvedValue({ error: { message: "Service unavailable", status: 503 } });
    render(<Page />); fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "owned@example.test" } });
    fireEvent.submit(screen.getByLabelText("Email address").closest("form")!); await screen.findByRole("alert");
    expect(mocks.password).not.toHaveBeenCalled(); expect(mocks.policy).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalledWith("auth.failed_login", expect.anything());
    expect(mocks.rate).toHaveBeenCalledWith({ data: { label: "reset" } });
  });
  it("retains legacy authentication and rate control while activation is disabled", async () => {
    mocks.password.mockResolvedValue({ mode: "legacy" }); mocks.legacySignIn.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials", status: 400 } });
    render(<Page />); submit(); await screen.findByRole("alert");
    expect(mocks.rate).toHaveBeenCalledWith({ data: { label: "signin" } }); expect(mocks.legacySignIn).toHaveBeenCalledTimes(1); expect(mocks.setSession).not.toHaveBeenCalled();
  });
  it("adopts only provider-issued tokens and keeps current MFA step-up", async () => {
    mocks.password.mockResolvedValue({ mode: "captured", ok: true, value: { access_token: "fixture-provider-access", refresh_token: "fixture-provider-refresh" } });
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    render(<Page />); submit(); await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/mfa-challenge", search: { redirect: "/home" }, replace: true }));
    expect(mocks.setSession).toHaveBeenCalledWith({ access_token: "fixture-provider-access", refresh_token: "fixture-provider-refresh" });
    expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalledWith("auth.failed_login", expect.anything());
  });
  it("uses the server policy outcome before signing out and never lands on a block", async () => {
    mocks.password.mockResolvedValue({ mode: "captured", ok: true, value: { access_token: "fixture-provider-access", refresh_token: "fixture-provider-refresh" } });
    mocks.policy.mockResolvedValue({ action: "block", matched: { name: "Current rule", id: "fixture-rule" } });
    render(<Page />); submit(); expect((await screen.findByRole("alert")).textContent).toContain("Access blocked by policy");
    expect(mocks.policy).toHaveBeenCalledWith({ data: { attemptId: expect.any(String), tenantId: null } });
    expect(mocks.signOut).toHaveBeenCalledTimes(1); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("transport failure cannot fall back to an uncaptured credential retry", async () => {
    mocks.password.mockRejectedValue(Error("withheld")); render(<Page />); submit(); await screen.findByRole("alert");
    expect(mocks.setSession).not.toHaveBeenCalled(); expect(mocks.legacySignIn).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
