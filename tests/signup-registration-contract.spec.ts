import { AuthApiError } from "@supabase/auth-js";
import { describe, expect, it } from "vitest";
import { classifySignupInviteError } from "@/lib/signup-registration";

describe("Supabase Auth invite duplicate contract", () => {
  it("recognizes the SDK's typed 422 email_exists response", () => {
    const error = new AuthApiError(
      "A user with this email address has already been registered",
      422,
      "email_exists",
    );
    expect(classifySignupInviteError(error)).toBe("existing");
  });

  it("recognizes the SDK's typed user_already_exists response", () => {
    expect(
      classifySignupInviteError(
        new AuthApiError("User already exists", 422, "user_already_exists"),
      ),
    ).toBe("existing");
  });

  it("does not infer an existing account from message text, unrelated status, or network failure", () => {
    expect(
      classifySignupInviteError(
        new AuthApiError(
          "A user with this email address has already been registered",
          500,
          "unexpected_failure",
        ),
      ),
    ).toBe("unknown");
    expect(classifySignupInviteError({ status: 422, message: "User already registered" })).toBe(
      "unknown",
    );
    expect(classifySignupInviteError(new TypeError("Failed to fetch"))).toBe("unknown");
    expect(classifySignupInviteError(null)).toBe("unknown");
  });
});
