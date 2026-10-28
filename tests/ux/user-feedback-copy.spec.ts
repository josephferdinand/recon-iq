import { beforeEach, describe, expect, it, vi } from "vitest";

const { errorToast, report } = vi.hoisted(() => ({ errorToast: vi.fn(), report: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: errorToast } }));
vi.mock("@/lib/error-reporting", () => ({ reportPlatformError: report }));

import { notifyUserError } from "@/lib/user-feedback";

beforeEach(() => { errorToast.mockReset(); report.mockReset(); });

describe("reviewed toast copy", () => {
  it("replaces database error text with actionable service copy", () => {
    notifyUserError({ code: "PGRST002", message: "SQL PRIVATE-KEY relation vault" }, "vault");
    expect(errorToast).toHaveBeenCalledWith("Unable To Reach The Service", expect.objectContaining({
      description: expect.stringContaining("Please try again shortly"),
    }));
    expect(JSON.stringify(errorToast.mock.calls)).not.toContain("PRIVATE-KEY");
    expect(report).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ surface: "vault", kind: "service" }));
  });

  it("distinguishes a permission refusal without exposing its raw message", () => {
    notifyUserError({ status: 403, message: "policy internal.role.private" }, "AI policy");
    expect(errorToast).toHaveBeenCalledWith("You Don't Currently Have Access", expect.anything());
    expect(JSON.stringify(errorToast.mock.calls)).not.toContain("internal.role.private");
  });
});
