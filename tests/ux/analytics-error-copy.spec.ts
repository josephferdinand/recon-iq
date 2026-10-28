import { describe, expect, it } from "vitest";
import { USER_FACING_ERRORS, userFacingErrorKind } from "@/lib/user-facing-errors";

describe("analytics error copy", () => {
  it("uses service guidance for an unavailable service without exposing provider details", () => {
    const error = { status: 503, message: "private database detail" };
    const copy = USER_FACING_ERRORS[userFacingErrorKind(error)];

    expect(userFacingErrorKind(error)).toBe("service");
    expect(copy.title).toBe("Unable To Reach The Service");
    expect(`${copy.message} ${copy.action}`).not.toContain("private database detail");
  });

  it("classifies connection failures separately from permission denial", () => {
    const error = new TypeError("private network detail");
    const copy = USER_FACING_ERRORS[userFacingErrorKind(error)];

    expect(userFacingErrorKind(error)).toBe("network");
    expect(copy.title).toBe("Connection Interrupted");
    expect(`${copy.message} ${copy.action}`).not.toContain("private network detail");
  });

  it("keeps genuine permission denial distinct and actionable", () => {
    const error = { status: 403, message: "internal policy detail" };
    const copy = USER_FACING_ERRORS[userFacingErrorKind(error)];

    expect(userFacingErrorKind(error)).toBe("access");
    expect(copy.title).toBe("You Don't Currently Have Access");
    expect(copy.action).toContain("Contact your administrator");
    expect(`${copy.message} ${copy.action}`).not.toContain("internal policy detail");
  });
});
