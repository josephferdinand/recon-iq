import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFailedLogin } from "../../src/lib/failed-login-capture.server";
import { canonicalFailedLoginOrigin, failedLoginOutcome, publicLoginError, failedLoginOutcomes } from "../../src/lib/failed-login-notifications";
import { renderFailedLoginEmail } from "../../src/lib/email-templates/failed-login";
import { processFailedLoginQueueMessage, sendFailedLoginEmail } from "../../src/lib/failed-login-email.server";
import { createFailedLoginProvider, failedLoginProxyReady, verifiedLoginRequest } from "../../src/lib/failed-login-auth.server";
import type { ZeptoSendRequest } from "../../src/lib/email-templates/zeptomail";

const id = "10000000-0000-4000-8000-000000000001";
const lease = "20000000-0000-4000-8000-000000000001";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function captureDeps(error: { code?: string; status?: number } | null = { code: "invalid_credentials", status: 400 }) {
  return { begin: vi.fn(async () => ({ acquired: true, outcome: "pending" })), authenticate: vi.fn(async () => ({ value: error ? null : { marker: "provider-session" }, error })), finish: vi.fn(async (_: string) => {}), diagnostic: vi.fn() };
}

describe("trusted failed-login capture", () => {
  it("records a real mismatch once and returns no session or account directory fields", async () => {
    const deps = captureDeps(); const result = await captureFailedLogin(id, "password", deps);
    expect(result).toMatchObject({ ok: false, error: publicLoginError("invalid_credentials") });
    expect(result).toHaveProperty("error.requestId", expect.any(String));
    expect(deps.authenticate).toHaveBeenCalledTimes(1); expect(deps.finish).toHaveBeenCalledWith("invalid_credentials");
  });
  it("records success without any failure alert outcome", async () => {
    const deps = captureDeps(null); expect((await captureFailedLogin(id, "password", deps)).ok).toBe(true);
    expect(deps.finish).toHaveBeenCalledWith("success");
  });
  it.each(["user_not_found", "email_not_confirmed", "user_banned"])("does not expose provider account state %s", async code => {
    const deps = captureDeps({ code, status: 400 });
    expect(await captureFailedLogin(id, "password", deps)).toMatchObject({ ok: false, error: publicLoginError("invalid_credentials") });
  });
  it.each(["pending", "success", "invalid_credentials"])("does not replay provider authentication on duplicate %s", async outcome => {
    const deps = captureDeps(); deps.begin.mockResolvedValue({ acquired: false, outcome });
    expect((await captureFailedLogin(id, "password", deps)).ok).toBe(false);
    expect(deps.authenticate).not.toHaveBeenCalled(); expect(deps.finish).not.toHaveBeenCalled();
  });
  it("retries only notification recording, preserving the original failure", async () => {
    const deps = captureDeps(); deps.finish.mockRejectedValueOnce(Error("withheld"));
    const result = await captureFailedLogin(id, "password", deps);
    expect(result.ok).toBe(false); expect(deps.authenticate).toHaveBeenCalledTimes(1); expect(deps.finish).toHaveBeenCalledTimes(2);
  });
  it("reports an operator correlation if recording stays unavailable without changing the failed login", async () => {
    const deps = captureDeps(); deps.finish.mockRejectedValue(Error("withheld"));
    const result = await captureFailedLogin(id, "password", deps);
    expect(result).toMatchObject({ ok: false, error: publicLoginError("invalid_credentials") });
    expect(deps.diagnostic).toHaveBeenCalledWith("notification_record_unavailable", id, expect.any(String));
  });
  it("never calls the provider if durable reservation is unavailable", async () => {
    const deps = captureDeps(); deps.begin.mockRejectedValue(Error("withheld"));
    expect((await captureFailedLogin(id, "password", deps)).ok).toBe(false); expect(deps.authenticate).not.toHaveBeenCalled();
  });
  it("persists a server support reference separate from the browser attempt ID", async () => {
    const requestId = "40000000-0000-4000-8000-000000000001";
    const deps = captureDeps();
    deps.begin.mockImplementation(async (...args: unknown[]) => ({ acquired: true, outcome: "pending", requestId: args[0] as string }));
    const result = await captureFailedLogin(id, "password", deps);
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("Expected rejected credentials");
    expect(result.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.error.requestId).not.toBe(id);
    expect(deps.begin.mock.calls[0]).toEqual([result.error.requestId]);
    const replay = captureDeps();
    replay.begin.mockResolvedValue({ acquired: false, outcome: "invalid_credentials", requestId } as any);
    const duplicate = await captureFailedLogin(id, "password", replay);
    expect(duplicate).toHaveProperty("error.requestId", requestId);
    expect(replay.authenticate).not.toHaveBeenCalled();
  });
  it("does not expose credential-shaped recorder correlation as a support reference", async () => {
    const deps = captureDeps(); deps.begin.mockResolvedValue({ acquired: true, outcome: "pending", requestId: "fixture.part.signature" } as any);
    const result = await captureFailedLogin(id, "password", deps);
    expect(JSON.stringify(result)).not.toContain("fixture.part.signature");
  });
  it("classifies a provider transport exception as unknown/unavailable", async () => {
    const deps = captureDeps(); deps.authenticate.mockRejectedValue(Error("withheld"));
    await captureFailedLogin(id, "password", deps); expect(deps.finish).toHaveBeenCalledWith("provider_unavailable");
  });
  it.each([
    [{ code: "invalid_credentials", status: 400 }, "password", "invalid_credentials"],
    [{ code: "mfa_verification_failed", status: 422 }, "mfa", "mfa_invalid"],
    [{ code: "mfa_challenge_expired", status: 422 }, "mfa", "mfa_expired"],
    [{ code: "user_banned", status: 403 }, "password", "account_locked"],
    [{ status: 429 }, "password", "rate_limited"],
    [{ status: 503 }, "password", "provider_unavailable"],
    [{ code: "email_not_confirmed", status: 400 }, "password", "verification_failed"],
  ] as const)("uses code/status only: %j", (error, stage, expected) => expect(failedLoginOutcome(error, stage)).toBe(expected));
});

describe("recipient-safe branded notification", () => {
  it.each(failedLoginOutcomes)("renders truthful %s and real recovery links without credentials", async outcome => {
    const notice = await renderFailedLoginEmail({ attemptId: id, occurredAt: "2026-10-03T16:00:00Z", outcome, origin: "https://app.reconiq.example" });
    expect(notice.html).toContain("fv-monogram.svg");
    expect(notice.html).toContain("https://app.reconiq.example/auth?reset=true");
    expect(notice.text).toContain("2026-10-03T16:00:00.000Z");
    expect(notice.text).not.toMatch(/OTP|JWT|access_token|refresh_token|reset_token|password mismatch/i);
    if (outcome === "provider_unavailable") expect(notice.text).toContain("credential result is unknown");
  });
  it("uses DEV recovery links for DEV", async () => {
    const notice = await renderFailedLoginEmail({ attemptId: id, occurredAt: "2026-10-03T16:00:00Z", outcome: "invalid_credentials", origin: "https://dev.app.reconiq.example" });
    expect(notice.text).toContain("https://dev.app.reconiq.example/auth?reset=true");
  });
  it.each(["https://evil.test", "http://app.reconiq.example", "https://app.reconiq.example@evil.test", "https://app.reconiq.example/auth", "https://app.reconiq.example?next=evil", "https://app.reconiq.example:444"])("rejects untrusted origin %s", origin => expect(() => canonicalFailedLoginOrigin(origin)).toThrow());
});

const mail = { to: [{ email: "owned@example.test" }], from: { email: "noreply@reconiq.example" }, subject: "Security notice", htmlBody: "test", textBody: "test", clientReference: `fvi-failed-login-${id}` };
describe("ZeptoMail acceptance and uncertainty", () => {
  it("recognizes the official array receipt as provider accepted, not delivered", async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: [{ code: "EM_104" }], request_id: "req-123" }));
    expect(await sendFailedLoginEmail(mail, "test-key", transport)).toEqual({ state: "provider_accepted", messageId: "request:req-123" });
    const body = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(body.to).toHaveLength(1); expect(body.cc).toBeUndefined(); expect(body.track_opens).toBeUndefined();
  });
  it.each([400, 401, 429])( "retries a definite HTTP%d rejection", async status => {
    expect((await sendFailedLoginEmail(mail, "test-key", async () => Response.json({}, { status }))).state).toBe("retry");
  });
  it("checks provider errors in 2xx responses", async () => expect((await sendFailedLoginEmail(mail, "test-key", async () => Response.json({ error: { code: "rejected" } }))).state).toBe("retry"));
  it.each([500, 503])("holds HTTP%d as uncertain", async status => expect((await sendFailedLoginEmail(mail, "test-key", async () => Response.json({}, { status }))).state).toBe("uncertain"));
  it("never treats malformed acceptance as sent", async () => expect((await sendFailedLoginEmail(mail, "test-key", async () => Response.json({}))).state).toBe("uncertain"));
  it.each(["YOUR_SUPABASE_KEY", "sb_secret_fixture", "sbp_fixture"])("does not promote a credential-shaped receipt to correlation", async receipt => {
    expect(await sendFailedLoginEmail(mail, "test-key", async () => Response.json({ messageId: receipt }))).toEqual({ state: "uncertain", code: "provider_response_unknown" });
    expect(await sendFailedLoginEmail(mail, "test-key", async () => Response.json({ data: [{ code: "EM_104" }], request_id: receipt }))).toEqual({ state: "uncertain", code: "provider_response_unknown" });
  });
  it("holds lost response/timeout without automatically replaying the send", async () => {
    const transport = vi.fn(async () => { throw Error("withheld"); });
    expect(await sendFailedLoginEmail(mail, "test-key", transport)).toEqual({ state: "uncertain", code: "provider_timeout" }); expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("queue notification branch", () => {
  it("takes destination from the claimed authority even if payload supplies a different one", async () => {
    vi.stubEnv("SUPABASE_URL", "https://YOUR_PROJECT_REF.supabase.co");
    const rpc = vi.fn(async (name: string) => ({ error: null, data: name === "failed_login_claim" ? { send: true, to: "owned@example.test", lease_id: lease, occurred_at: "2026-10-03T16:00:00Z", outcome: "invalid_credentials" } : true }));
    const sender = vi.fn(async (_request: ZeptoSendRequest, _token: string) => ({ state: "provider_accepted" as const, messageId: "receipt-1" }));
    const result = await processFailedLoginQueueMessage({ rpc }, { msg_id: 12, message: { template: "auth.failed_login.verified", attempt_id: id, to: "attacker@example.test" } }, "test-key", sender);
    expect(sender.mock.calls[0][0].to).toEqual([{ email: "owned@example.test" }]); expect(result?.state).toBe("provider_accepted");
    expect(rpc.mock.calls[1][0]).toBe("failed_login_settle");
  });
  it.each(["sending", "uncertain", "provider_accepted", "delivered", "recipient_changed", "unattributed"])("does not resend %s", async state => {
    const rpc = vi.fn(async () => ({ error: null, data: { send: false, state } })); const sender = vi.fn();
    await processFailedLoginQueueMessage({ rpc }, { msg_id: 12, message: { template: "auth.failed_login.verified", attempt_id: id } }, "test-key", sender);
    expect(sender).not.toHaveBeenCalled();
  });
  it("leaves ordinary and signup messages to the existing branches", async () => {
    const rpc = vi.fn(); expect(await processFailedLoginQueueMessage({ rpc }, { msg_id: 12, message: { template: "signup" } }, "test-key")).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it("retries a lost receipt only, without a second provider send", async () => {
    vi.stubEnv("SUPABASE_URL", "https://YOUR_PROJECT_REF.supabase.co");
    let count = 0;
    const rpc = vi.fn(async (name: string) => name === "failed_login_claim" ? { error: null, data: { send: true, to: "owned@example.test", lease_id: lease, occurred_at: "2026-10-03T16:00:00Z", outcome: "invalid_credentials" } } : { error: ++count === 1 ? {} : null, data: true });
    const sender = vi.fn(async (_request: ZeptoSendRequest, _token: string) => ({ state: "provider_accepted" as const, messageId: "receipt-1" }));
    expect((await processFailedLoginQueueMessage({ rpc }, { msg_id: 12, message: { template: "auth.failed_login.verified", attempt_id: id } }, "test-key", sender))?.sent).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1); expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("request-local auth proxy prerequisites", () => {
  it("refuses activation with legacy keys or unverified forwarding", () => {
    vi.stubEnv("FAILED_LOGIN_NOTIFICATIONS_ENABLED", "true"); vi.stubEnv("SUPABASE_URL", "https://YOUR_PROJECT_REF.supabase.co"); vi.stubEnv("SUPABASE_AUTH_SECRET_KEY", "legacy-test");
    expect(failedLoginProxyReady()).toBe(false);
    vi.stubEnv("SUPABASE_AUTH_SECRET_KEY", "sb_secret_fixture"); expect(failedLoginProxyReady()).toBe(false);
    vi.stubEnv("SUPABASE_AUTH_IP_FORWARDING_VERIFIED", "true"); expect(failedLoginProxyReady()).toBe(true);
  });
  it("accepts only canonical origin and edge IP", () => {
    vi.stubEnv("SUPABASE_URL", "https://YOUR_PROJECT_REF.supabase.co");
    expect(verifiedLoginRequest(new Request("https://app.reconiq.example/test", { headers: { origin: "https://app.reconiq.example", "cf-connecting-ip": "192.0.2.1" } }))).toBe("192.0.2.1");
    expect(() => verifiedLoginRequest(new Request("https://app.reconiq.example/test", { headers: { origin: "https://evil.test", "x-forwarded-for": "192.0.2.1" } }))).toThrow();
  });
  it("isolates credentials to one provider request and preserves forwarded rate-control IP", async () => {
    vi.stubEnv("SUPABASE_URL", "https://YOUR_PROJECT_REF.supabase.co"); vi.stubEnv("SUPABASE_AUTH_SECRET_KEY", "sb_secret_fixture"); vi.stubEnv("SUPABASE_AUTH_IP_FORWARDING_VERIFIED", "true");
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ code: "invalid_credentials", msg: "Invalid login credentials" }, { status: 400, headers: { "x-supabase-api-version": "2024-01-01" } })); vi.stubGlobal("fetch", transport);
    const one = createFailedLoginProvider("192.0.2.1"); const two = createFailedLoginProvider("192.0.2.2");
    expect(one).not.toBe(two);
    const result = await one.auth.signInWithPassword({ email: "owned@example.test", password: "test-invalid" });
    expect(result.error?.code).toBe("invalid_credentials");
    expect(transport).toHaveBeenCalledTimes(1);
    const headers = new Headers(transport.mock.calls[0][1]!.headers);
    expect(headers.get("Sb-Forwarded-For")).toBe("192.0.2.1"); expect(headers.get("Authorization")).toBeNull();
  });
  it("the installed SDK preserves the verified user bearer on both MFA requests", async () => {
    vi.stubEnv("SUPABASE_URL", "https://YOUR_PROJECT_REF.supabase.co"); vi.stubEnv("SUPABASE_AUTH_SECRET_KEY", "sb_secret_fixture"); vi.stubEnv("SUPABASE_AUTH_IP_FORWARDING_VERIFIED", "true");
    const transport = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input).endsWith("/challenge")
      ? Response.json({ id: lease, type: "totp", expires_at: "2026-10-03T16:00:00Z" })
      : Response.json({ access_token: "fixture-elevated", refresh_token: "fixture-refresh", expires_in: 3600, token_type: "bearer", user: { id } }));
    vi.stubGlobal("fetch", transport);
    const provider = createFailedLoginProvider("192.0.2.1", "Bearer fixture-current-session");
    const result = await provider.auth.mfa.challengeAndVerify({ factorId: lease, code: "123456" });
    expect(result.error).toBeNull(); expect(result.data?.access_token).toBe("fixture-elevated");
    expect(transport).toHaveBeenCalledTimes(2);
    for (const call of transport.mock.calls) {
      expect(new Headers(call[1]?.headers).get("Authorization")).toBe("Bearer fixture-current-session");
      expect(new Headers(call[1]?.headers).get("Sb-Forwarded-For")).toBe("192.0.2.1");
    }
  });
});
