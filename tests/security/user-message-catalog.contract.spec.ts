import { describe, expect, it } from "vitest";
import { formatUserMessage, mapKnownFailure, type UserMessageCategory } from "@/lib/user-message";

const unsafeDiagnostic = "SQL password=PRIVATE provider_token=DO-NOT-SHOW stack trace";

describe("shared user-message contract", () => {
  it.each<[UserMessageCategory, string]>([
    ["input", "Correct the highlighted fields"],
    ["business", "business rule"],
    ["auth", "current access"],
    ["session", "Sign in again"],
    ["mfa", "identity verification"],
    ["network", "Check your connection"],
    ["timeout", "Check the request status"],
    ["dependency", "service needed for approve this access request"],
    ["system", "request reference"],
    ["unknown_write_outcome", "before retrying"],
  ])("formats %s with professional context and a next step", (category, expected) => {
    const result = formatUserMessage({ category, action: "approve this access request" });
    expect(result.title).not.toMatch(/^(Error|Unknown Error|Request Failed)$/i);
    expect(result.humanMessage).toContain(expected);
    expect(result.humanMessage).not.toContain(unsafeDiagnostic);
    expect(result.retryable).toBe(false);
  });

  it("uses only caller-verified field limits and allowed values", () => {
    const result = formatUserMessage({
      category: "input",
      action: "create this reconciliation",
      fields: [
        { field: "Email address", issue: "required" },
        { field: "Name", issue: "too_long", limit: 64 },
        { field: "Currency", issue: "unsupported_value", allowedValues: ["USD", "EUR"] },
        { field: "Attachment", issue: "too_large" },
      ],
    });
    expect(result.fieldErrors).toEqual({
      "Email address": "Email address is required.",
      Name: "Name must be 64 characters or fewer.",
      Currency: "Select a supported currency: USD, EUR.",
      Attachment: "Reduce attachment.",
    });
    expect(JSON.stringify(result)).not.toContain("SQL");
  });

  it("adds known business reasons without inferring them from exception text", () => {
    const known = formatUserMessage({
      category: "business",
      action: "publish this report",
      reason: "invalid_transition",
    });
    const unknown = formatUserMessage({
      category: "business",
      action: "publish this report",
      reason: undefined,
    });
    expect(known.humanMessage).toContain("not in a state that allows this action");
    expect(unknown.humanMessage).not.toContain("not in a state");
    expect(unknown.humanMessage).toContain("business rule");
  });

  it.each([
    ["VALIDATION_ERROR", 400, "input", undefined],
    ["DUPLICATE_REQUEST", 409, "business", "duplicate"],
    ["ACCESS_DENIED", 403, "auth", undefined],
    ["SESSION_EXPIRED", 401, "session", undefined],
    ["MFA_REQUIRED", 403, "mfa", undefined],
    ["NETWORK_ERROR", undefined, "network", undefined],
    ["EDGE_TIMEOUT", 504, "timeout", undefined],
    ["PGRST002", 503, "dependency", undefined],
    ["WRITE_OUTCOME_UNKNOWN", 500, "unknown_write_outcome", undefined],
    ["INTERNAL_ERROR", 500, "system", undefined],
  ] as const)(
    "maps known failure %s without changing its machine metadata",
    (code, status, category, reason) => {
      expect(mapKnownFailure(code, status)).toEqual({ category, ...(reason ? { reason } : {}) });
      expect(
        formatUserMessage({ category, action: "complete this review", code, status }).code,
      ).toBe(code);
    },
  );

  it("maps unknown codes by status only and defaults unknown status to system", () => {
    expect(mapKnownFailure("PRIVATE_PROVIDER_DETAIL", 403)).toEqual({ category: "auth" });
    expect(mapKnownFailure("PRIVATE_PROVIDER_DETAIL", 418)).toEqual({ category: "system" });
  });

  it("preserves safe machine code, HTTP status, trusted request ID, and real caller actions", () => {
    const result = formatUserMessage({
      category: "auth",
      action: "edit this workspace",
      code: "ACCESS_DENIED",
      status: 403,
      requestId: "req_8f21",
      availableActions: [
        { id: "request_access", label: "Request access" },
        { id: "contact_admin", label: "Contact your administrator" },
      ],
    });
    expect(result).toMatchObject({
      code: "ACCESS_DENIED",
      status: 403,
      requestId: "req_8f21",
      nextActions: [
        { id: "request_access", label: "Request access" },
        { id: "contact_admin", label: "Contact your administrator" },
      ],
    });
  });

  it("does not expose malformed machine metadata or caller text that resembles diagnostics", () => {
    const result = formatUserMessage({
      category: "system",
      action: unsafeDiagnostic,
      code: "SQL password=secret",
      status: 700,
      requestId: "private UUID with spaces",
      availableActions: [{ id: "retry", label: `${unsafeDiagnostic}\n` }],
    });
    expect(result.code).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.requestId).toBeUndefined();
    expect(result.humanMessage).not.toContain(unsafeDiagnostic);
    expect(JSON.stringify(result)).not.toContain("password=secret");
    expect(result.nextActions[0]?.label).toBe("View request status");
  });

  it("keeps unknown write outcomes non-retryable and directs users to the existing request", () => {
    const result = formatUserMessage({
      category: "unknown_write_outcome",
      action: "submit this membership request",
      retryable: true,
      requestId: "req_8f21",
      availableActions: [{ id: "check_request", label: "Check request status" }],
    });
    expect(result.retryable).toBe(false);
    expect(result.humanMessage).toContain("Check the existing request");
    expect(result.humanMessage).toContain("do not submit it again");
    expect(result.nextActions).toEqual([{ id: "check_request", label: "Check request status" }]);
  });

  it("does not claim retry safety unless the caller explicitly confirms it", () => {
    expect(formatUserMessage({ category: "network", action: "load this report" }).retryable).toBe(
      false,
    );
    expect(
      formatUserMessage({ category: "network", action: "load this report", retryable: true })
        .retryable,
    ).toBe(true);
  });
});
