import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFailedLogin } from "@/lib/failed-login-capture.server";
import { failedLoginOutcome, publicLoginError } from "@/lib/failed-login-notifications";
import { renderFailedLoginEmail } from "@/lib/email-templates/failed-login";
import {
  processFailedLoginQueueMessage,
  sendFailedLoginEmail,
} from "@/lib/failed-login-email.server";
import { mapAuthError } from "@/lib/auth-audit";

const attempts = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
] as const;
const poison = "QA_ONLY_SQL_STACK_password=never-real_OTP=919191_JWT=never-real";
const syntheticJwt = "YOUR_SUPABASE_KEY";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("20261003 new failed-login DTO/email/transport message checks", () => {
  it("XWF-LOGIN-ISOLATION: concurrent actual DTO-to-template flows isolate correlation/time and discard injected private fields", async () => {
    const flows = [
      {
        id: attempts[0],
        stage: "password" as const,
        code: "unexpected_failure",
        status: 503,
        at: "2026-10-03T17:00:01Z",
      },
      {
        id: attempts[1],
        stage: "mfa" as const,
        code: "mfa_challenge_expired",
        status: 422,
        at: "2026-10-03T17:00:02Z",
      },
    ];
    const notices = await Promise.all(
      flows.map(async (flow) => {
        const error = {
          code: flow.code,
          status: flow.status,
          message: poison,
          stack: poison,
          password: poison,
          otp: poison,
          access_token: syntheticJwt,
        };
        const result = await captureFailedLogin(flow.id, flow.stage, {
          begin: async () => ({ acquired: true, outcome: "pending" }),
          authenticate: async () => ({ value: null, error }),
          finish: async () => undefined,
          diagnostic: () => {
            throw new Error("Unexpected fixture recording failure");
          },
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected a source failure DTO");
        expect(result.error.status).toBe(flow.status === 503 ? 503 : 400);
        expect(JSON.stringify(result)).not.toMatch(/QA_ONLY_SQL_STACK|eyJhbGci|password=|OTP=/);
        const notice = await renderFailedLoginEmail({
          attemptId: flow.id,
          occurredAt: flow.at,
          outcome: failedLoginOutcome(error, flow.stage),
          origin: "https://app.reconiq.example",
          ...{ password: poison, otp: poison, jwt: syntheticJwt, providerBody: poison },
        });
        expect(JSON.stringify(notice)).not.toMatch(/QA_ONLY_SQL_STACK|eyJhbGci|password=|OTP=/);
        expect(notice.text).toContain(flow.id);
        expect(notice.text).toContain(new Date(flow.at).toISOString());
        expect(notice.text).not.toContain(attempts.find((id) => id !== flow.id)!);
        return notice;
      }),
    );
    expect(notices[0].text).toContain("credential result is unknown");
    expect(notices[0].text).not.toContain("authenticator challenge had expired");
    expect(notices[1].text).toContain("authenticator challenge had expired");
    expect(notices[1].text).not.toContain("credential result is unknown");
  });

  it("XWF-LOGIN-CORR: failure DTO provides a public reference associated with the recorded attempt", async () => {
    const result = await captureFailedLogin(attempts[0], "password", {
      begin: async () => ({ acquired: true, outcome: "pending" }),
      authenticate: async () => ({
        value: null,
        error: { code: "invalid_credentials", status: 400 },
      }),
      finish: async () => undefined,
      diagnostic: () => undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_credentials", status: 400 },
    });
    // The browser-supplied attempt UUID must not be invented/echoed as a trusted
    // public support reference by this test. The source must provide one.
    expect(result).toHaveProperty("error.requestId");
  });

  it("XWF-LOGIN-LIMIT: actual DTO-to-signin mapper does not invent an unprovided lockout threshold", () => {
    const dto = publicLoginError("invalid_credentials");
    const visible = mapAuthError(dto);
    expect(visible.code).toBe(dto.code);
    expect(visible.hint).not.toMatch(/after\s+\d+\s+failed attempts/i);
  });

  it("XWF-MAIL-UNKNOWN: actual render/send/settle flow keeps a lost send uncertain without leaking provider payload or replaying it", async () => {
    vi.stubEnv("FAILED_LOGIN_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("SUPABASE_URL", "https://YOUR_PROJECT_REF.supabase.co");
    const rpc = vi.fn(async (name: string) =>
      name === "failed_login_claim"
        ? {
            data: {
              send: true,
              to: "qa-not-sent@example.test",
              lease_id: attempts[1],
              occurred_at: "2026-10-03T17:00:00Z",
              outcome: "invalid_credentials",
            },
            error: null,
          }
        : { data: true, error: null },
    );
    const transport = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      throw new Error(poison);
    });
    const result = await processFailedLoginQueueMessage(
      { rpc },
      {
        msg_id: 912,
        message: {
          template: "auth.failed_login.verified",
          attempt_id: attempts[0],
          password: poison,
          otp: poison,
          access_token: syntheticJwt,
          to: "forged@example.test",
        },
      },
      "qa-test-key-never-real",
      (req) => sendFailedLoginEmail(req, "qa-test-key-never-real", transport),
    );
    expect(result).toEqual({ sent: 0, failed: 1, state: "uncertain" });
    expect(transport).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.to).toEqual([{ email_address: { address: "qa-not-sent@example.test" } }]);
    expect(body.htmlbody).toContain(attempts[0]);
    expect(JSON.stringify(body)).not.toMatch(/QA_ONLY_SQL_STACK|eyJhbGci|forged@example/);
    expect(rpc.mock.calls[1]).toEqual([
      "failed_login_settle",
      expect.objectContaining({
        _id: attempts[0],
        _state: "uncertain",
        _diagnostic_code: "provider_timeout",
        _provider_message_id: null,
      }),
    ]);
    expect(JSON.stringify({ result, calls: rpc.mock.calls })).not.toContain(poison);
  });

  it("XWF-MAIL-CORR: credential-shaped provider receipt is not promoted to an audit correlation", async () => {
    const notice = await renderFailedLoginEmail({
      attemptId: attempts[0],
      occurredAt: "2026-10-03T17:00:00Z",
      outcome: "invalid_credentials",
      origin: "https://app.reconiq.example",
    });
    const result = await sendFailedLoginEmail(
      {
        to: [{ email: "qa-not-sent@example.test" }],
        from: { email: "noreply@reconiq.example" },
        subject: notice.subject,
        htmlBody: notice.html,
        textBody: notice.text,
        clientReference: `fvi-failed-login-${attempts[0]}`,
      },
      "qa-test-key-never-real",
      async () => Response.json({ messageId: syntheticJwt }),
    );
    expect(result).toEqual({ state: "uncertain", code: "provider_response_unknown" });
    expect(JSON.stringify(result)).not.toContain(syntheticJwt);
  });
});
