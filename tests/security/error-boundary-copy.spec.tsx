// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/error-reporting", () => ({ reportPlatformError: vi.fn() }));

import { ErrorBoundary } from "@/components/error-boundary";
import { reportPlatformError } from "@/lib/error-reporting";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Broken() {
  throw new Error("postgres relation private_table password=DO-NOT-SHOW");
}

describe("shared error boundary copy", () => {
  it("hides the raw exception and logs it with a safe user reference", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary label="internal-module"><Broken /></ErrorBoundary>);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something Didn't Go As Planned");
    expect(alert.textContent).toContain("Please try again");
    expect(alert.textContent).toMatch(/Error Reference ID: FVI-[A-F0-9]{12}/);
    expect(alert.textContent).not.toContain("private_table");
    expect(alert.textContent).not.toContain("internal-module");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(reportPlatformError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ boundary: "internal-module", referenceId: expect.stringMatching(/^FVI-[A-F0-9]{12}$/) }),
    );
  });
});
