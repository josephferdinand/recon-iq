// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PasswordInput } from "../src/components/password-input";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("PasswordInput", () => {
  it("provides an accessible input name from the reveal label when no explicit label is passed", () => {
    render(<PasswordInput revealLabel="API key" defaultValue="dummy-test-only" />);
    expect(screen.getByLabelText("API key").getAttribute("type")).toBe("password");
  });

  it("is masked by default and toggles visibility without submitting the form", () => {
    let submits = 0;
    render(
      <form onSubmit={(event) => { event.preventDefault(); submits += 1; }}>
        <PasswordInput aria-label="Current password" revealLabel="current password" defaultValue="dummy-test-only" />
      </form>,
    );

    const input = screen.getByLabelText("Current password");
    const show = screen.getByRole("button", { name: "Show current password" });
    expect(input.getAttribute("type")).toBe("password");
    fireEvent.click(show);
    expect(input.getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "Hide current password" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide current password" }));
    expect(input.getAttribute("type")).toBe("password");
    expect(submits).toBe(0);
  });

  it("re-masks a revealed value after the short visibility window", () => {
    vi.useFakeTimers();
    render(<PasswordInput revealLabel="password" defaultValue="dummy-test-only" />);
    const input = screen.getByLabelText("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.getAttribute("type")).toBe("text");
    act(() => vi.advanceTimersByTime(3_000));
    expect(input.getAttribute("type")).toBe("password");
  });

  it("cannot reveal a disabled secret field", () => {
    render(<PasswordInput revealLabel="API key" disabled defaultValue="dummy-test-only" />);
    expect((screen.getByRole("button", { name: "Show API key" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("API key").getAttribute("type")).toBe("password");
  });
});
