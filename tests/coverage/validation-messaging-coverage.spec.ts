import { describe, expect, it } from "vitest";
import { mapAuthError } from "@/lib/auth-audit";
import { classifySignupInviteError } from "@/lib/signup-registration";
import { safeErrorPayload } from "@/lib/user-facing-errors";
import { formatUserMessage, mapKnownFailure } from "@/lib/user-message";

const diagnosticFixture = "QA_DATABASE_DIAGNOSTIC_SENTINEL_NOT_A_SECRET";

describe("application validation and message coverage fixtures", () => {
  it("maps recognized auth failures to actionable copy without exposing the provider text", () => {
    const mapped = mapAuthError({ message: "Invalid login credentials" });
    expect(mapped.code).toBe("invalid_credentials");
    expect(mapped.title).toMatch(/email or password/i);
    expect(mapped.hint).toMatch(/double-check/i);
    expect(JSON.stringify(mapped)).not.toContain("Invalid login credentials");
  });

  it("recognizes duplicate admission only from the typed Auth response, not error prose", () => {
    expect(classifySignupInviteError({ status: 422, code: "email_exists" })).toBe("existing");
    expect(classifySignupInviteError({ status: 422, code: "user_already_exists" })).toBe("existing");
    expect(classifySignupInviteError({ status: 422, message: "user already registered" })).toBe("unknown");
    expect(classifySignupInviteError(new TypeError("Failed to fetch"))).toBe("unknown");
  });

  it.fails("VMG-AUTH-ENUM-001: public sign-in copy does not reveal whether an email has an account", () => {
    const mapped = mapAuthError({ message: "User not found" });
    expect(mapped.title).not.toMatch(/no account|account.*exist/iu);
  });

  it.fails("VMG-AUTH-RAW-001: unknown auth exceptions never become user-visible copy", () => {
    const mapped = mapAuthError({ message: diagnosticFixture });
    expect(mapped.title).not.toBe(diagnosticFixture);
  });

  it("maps public error statuses to safe, actionable response payloads", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const payload = safeErrorPayload("FVI-ABCDEF012345", status);
      expect(payload.message.length).toBeGreaterThan(10);
      expect(payload.action.length).toBeGreaterThan(8);
      expect(JSON.stringify(payload)).not.toContain(diagnosticFixture);
      expect(JSON.stringify(payload)).not.toMatch(/stack|select .* from|postgres|password=/iu);
    }
  });

  it("keeps machine status/code while making an uncertain write non-retryable", () => {
    expect(mapKnownFailure("WRITE_OUTCOME_UNKNOWN", 500)).toEqual({ category: "unknown_write_outcome" });
    const result = formatUserMessage({
      category: "unknown_write_outcome",
      action: "submit this admission request",
      retryable: true,
      code: "WRITE_OUTCOME_UNKNOWN",
      status: 500,
      requestId: "req_20261003_fixture",
      availableActions: [{ id: "check_request", label: "Check request status" }],
    });
    expect(result.retryable).toBe(false);
    expect(result.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(result.status).toBe(500);
    expect(result.requestId).toBe("req_20261003_fixture");
    expect(result.nextActions).toEqual([{ id: "check_request", label: "Check request status" }]);
    expect(result.humanMessage).toContain("Check the existing request");
    expect(result.humanMessage).toContain("do not submit it again");
  });
});
