import { describe, expect, it, vi } from "vitest";

import {
  cleanRecoveryCallbackUrl,
  establishRecoverySession,
  parseRecoveryCallback,
} from "@/lib/password-recovery-callback";

function authMock() {
  return {
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({
      data: { session: { mode: "pkce" } },
      error: null,
    })),
    setSession: vi.fn(async () => ({ data: { session: { mode: "implicit" } }, error: null })),
  };
}

describe("password recovery callback", () => {
  it("parses and establishes an implicit recovery-token session", async () => {
    const auth = authMock();
    const url =
      "https://dev.app.reconiq.example/reset-password#access_token=access-test&refresh_token=refresh-test&type=recovery";

    expect(parseRecoveryCallback(url)).toMatchObject({ kind: "tokens", isRecovery: true });
    await expect(establishRecoverySession(auth, url)).resolves.toMatchObject({
      session: { mode: "implicit" },
    });
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: "access-test",
      refresh_token: "refresh-test",
    });
  });

  it("exchanges a PKCE code with its optional flow identifier", async () => {
    const auth = authMock();
    const url =
      "https://dev.app.reconiq.example/reset-password?code=code-test&sb_flow_id=flow-test&type=recovery";

    await expect(establishRecoverySession(auth, url)).resolves.toMatchObject({
      session: { mode: "pkce" },
    });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("code-test", {
      flowId: "flow-test",
    });
  });

  it("surfaces provider callback errors instead of waiting forever", async () => {
    const auth = authMock();
    const url =
      "https://dev.app.reconiq.example/reset-password#error=access_denied&error_description=Link%20expired&type=recovery";

    await expect(establishRecoverySession(auth, url)).rejects.toThrow("Link expired");
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("accepts a session already established by automatic URL detection", async () => {
    const auth = authMock();
    auth.getSession.mockResolvedValueOnce({
      data: { session: { mode: "automatic" } },
      error: null,
    });

    await expect(
      establishRecoverySession(auth, "https://dev.app.reconiq.example/reset-password"),
    ).resolves.toMatchObject({ session: { mode: "automatic" } });
  });

  it("removes callback credentials and errors from browser history", () => {
    expect(
      cleanRecoveryCallbackUrl(
        "https://dev.app.reconiq.example/reset-password?code=secret&sb_flow_id=flow&type=recovery#access_token=secret",
      ),
    ).toBe("/reset-password");
  });
});
