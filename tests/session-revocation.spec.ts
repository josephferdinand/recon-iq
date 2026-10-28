import { describe, expect, it, vi } from "vitest";
import { revokeOtherAuthSessions } from "../src/lib/session-revocation";

describe("revokeOtherAuthSessions", () => {
  it("revokes only other sessions with the caller's access token", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    await revokeOtherAuthSessions({ signOut }, "dummy-access-token");
    expect(signOut).toHaveBeenCalledExactlyOnceWith("dummy-access-token", "others");
  });

  it("does not report success when Auth rejects revocation", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: new Error("Auth unavailable") });
    await expect(revokeOtherAuthSessions({ signOut }, "dummy-access-token"))
      .rejects.toThrow("Could not sign out other devices");
  });
});
