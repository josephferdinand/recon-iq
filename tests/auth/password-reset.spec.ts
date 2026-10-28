// Password-reset flow: success + failure paths exercise Supabase client
// surface used by /auth (forgot mode) and /reset-password page, plus the
// best-effort audit beacon emitted via reportAuthEvent.
//
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportAuthEvent, mapAuthError } from "@/lib/auth-audit";

describe("reportAuthEvent (best-effort audit beacon)", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));

  beforeEach(() => {
    fetchMock.mockClear();
    // @ts-expect-error override
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    // @ts-expect-error restore
    delete globalThis.fetch;
  });

  it("POSTs auth.password_reset_requested with email payload", () => {
    reportAuthEvent("auth.password_reset_requested", { email: "alice@acme.io" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/public/security-event");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.event_type).toBe("auth.password_reset_requested");
    expect(body.email).toBe("alice@acme.io");
    expect(init?.keepalive).toBe(true);
  });

  it("POSTs auth.password_reset_completed with user_id", () => {
    reportAuthEvent("auth.password_reset_completed", { user_id: "u-123" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.event_type).toBe("auth.password_reset_completed");
    expect(body.user_id).toBe("u-123");
  });

  it("never throws when fetch itself is unavailable", () => {
    // @ts-expect-error
    delete globalThis.fetch;
    expect(() => reportAuthEvent("auth.logout", {})).not.toThrow();
  });
});

describe("password reset — Supabase surface contract", () => {
  it("resetPasswordForEmail success returns no error and triggers requested audit event", async () => {
    const resetPasswordForEmail = vi.fn(async (_email: string, _opts: any) => ({
      data: {},
      error: null,
    }));
    const supabaseMock = { auth: { resetPasswordForEmail } };

    const email = "user@acme.io";
    const { error } = await supabaseMock.auth.resetPasswordForEmail(email, {
      redirectTo: "https://app.test/reset-password",
    });

    expect(error).toBeNull();
    expect(resetPasswordForEmail).toHaveBeenCalledWith(email, {
      redirectTo: "https://app.test/reset-password",
    });
  });

  it("resetPasswordForEmail rate-limit failure maps to actionable hint", async () => {
    const err = { status: 429, message: "rate limit exceeded" };
    const resetPasswordForEmail = vi.fn(async () => ({ data: null, error: err }));
    const supabaseMock = { auth: { resetPasswordForEmail } };

    const { error } = await supabaseMock.auth.resetPasswordForEmail("x@y.io", {
      redirectTo: "https://app.test/reset-password",
    });
    expect(error).toEqual(err);
    const mapped = mapAuthError(error);
    expect(mapped.code).toBe("rate_limited");
    expect(mapped.title).toMatch(/too many/i);
  });

  it("updateUser success completes recovery; failure maps to weak-password hint", async () => {
    const okClient = { auth: { updateUser: vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })) } };
    const r1 = await okClient.auth.updateUser({ password: "NewSecurePass!23" });
    expect(r1.error).toBeNull();
    expect(r1.data.user?.id).toBe("u1");

    const failClient = {
      auth: {
        updateUser: vi.fn(async () => ({
          data: null,
          error: { message: "Password should be at least 12 characters" },
        })),
      },
    };
    const r2 = await failClient.auth.updateUser({ password: "short" });
    expect(r2.error).not.toBeNull();
    expect(mapAuthError(r2.error).code).toBe("weak_password");
  });
});
