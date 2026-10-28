// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { submitInterest, requestAdmission, getUser, onAuthStateChange } = vi.hoisted(() => ({
  submitInterest: vi.fn(),
  requestAdmission: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({
    to,
    search,
    children,
    className,
  }: {
    to: string;
    search?: { reset?: boolean };
    children: React.ReactNode;
    className?: string;
  }) => {
    const query = search?.reset ? "?reset=true" : "";
    return (
      <a href={`${to}${query}`} className={className}>
        {children}
      </a>
    );
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/signup-admission.functions", () => ({
  requestSignupAdmission: requestAdmission,
  submitSignupInterest: submitInterest,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser, onAuthStateChange } },
}));

import { Route } from "@/routes/request-invite";

const Page = Route.component as React.ComponentType;
const existingAccountMessage =
  "An account already exists with this email address. Please sign in using your existing account or use the Forgot Password option to reset your password.";

function renderPage() {
  return render(<Page />);
}

function fillSignup(email = "person@example.com") {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Example Person" } });
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: email } });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  sessionStorage.clear();
  submitInterest.mockResolvedValue({ accepted: true, outcome: "accepted" });
  requestAdmission.mockResolvedValue({ accepted: true });
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});

describe("current invite-based registration recovery", () => {
  it("normalizes email and keeps the verified-email admission gate for a new account", async () => {
    renderPage();
    fillSignup("  Person@Example.com  ");
    fireEvent.click(screen.getByRole("button", { name: "Verify email and request access" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "Your verification request was accepted.",
    );
    expect(submitInterest).toHaveBeenCalledTimes(1);
    expect(submitInterest).toHaveBeenCalledWith({
      data: expect.objectContaining({
        full_name: "Example Person",
        email: "person@example.com",
        mode: "submit",
        attemptId: expect.any(String),
        recoveryToken: expect.any(String),
      }),
    });
    expect(requestAdmission).not.toHaveBeenCalled();
  });

  it("shows the exact existing-account copy and working recovery actions without discarding the form", async () => {
    submitInterest.mockResolvedValueOnce({ accepted: true, outcome: "existing" });
    renderPage();
    fillSignup("person@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Verify email and request access" }));

    expect(await screen.findByText(existingAccountMessage)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign In" }).getAttribute("href")).toBe("/auth");
    expect(screen.getByRole("link", { name: "Forgot Password" }).getAttribute("href")).toBe(
      "/auth?reset=true",
    );
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Example Person");
    const email = screen.getByLabelText("Work email") as HTMLInputElement;
    expect(email.value).toBe("person@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Use Another Email Address" }));
    expect(document.activeElement).toBe(email);
    fireEvent.change(email, { target: { value: "alternate@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify email and request access" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(submitInterest).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        full_name: "Example Person",
        email: "alternate@example.com",
        mode: "submit",
      }),
    });
  });

  it("blocks repeat submits while the provider request is unresolved", async () => {
    let resolveRequest!: (value: { accepted: true; outcome: "accepted" }) => void;
    submitInterest.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    renderPage();
    fillSignup();
    const form = screen.getByLabelText("Work email").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submitInterest).toHaveBeenCalledTimes(1);

    resolveRequest({ accepted: true, outcome: "accepted" });
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("preserves form values and checks the same request after an unknown network outcome", async () => {
    submitInterest.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    submitInterest.mockResolvedValueOnce({ accepted: true, outcome: "existing" });
    renderPage();
    fillSignup();
    fireEvent.click(screen.getByRole("button", { name: "Verify email and request access" }));

    expect(
      await screen.findByText(
        "We couldn’t confirm whether the verification request completed. Check the existing request and your inbox; do not submit another invitation while its outcome is unresolved.",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Example Person");
    expect((screen.getByLabelText("Work email") as HTMLInputElement).value).toBe(
      "person@example.com",
    );
    expect(submitInterest).toHaveBeenCalledTimes(1);
    const original = submitInterest.mock.calls[0][0].data;
    fireEvent.click(screen.getByRole("button", { name: "Check request status" }));
    expect(await screen.findByText(existingAccountMessage)).toBeTruthy();
    expect(submitInterest).toHaveBeenCalledTimes(2);
    expect(submitInterest.mock.calls[1][0].data).toEqual({ ...original, mode: "check" });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("retries verified admission with the existing idempotent request after a session failure", async () => {
    getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-10-03T00:00:00Z" } },
      error: null,
    });
    requestAdmission.mockRejectedValueOnce(new Error("session expired"));
    renderPage();

    expect(await screen.findByRole("button", { name: "Retry access request" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Repeating this request will not create a second admission request.",
    );
    expect(screen.getByRole("alert").textContent).not.toContain("session expired");
    expect(screen.getByRole("link", { name: "Sign In" })).toBeTruthy();

    requestAdmission.mockResolvedValueOnce({ accepted: true });
    fireEvent.click(screen.getByRole("button", { name: "Retry access request" }));
    expect(await screen.findByText(/tenant administrator will review your request/)).toBeTruthy();
    expect(requestAdmission).toHaveBeenCalledTimes(2);
  });

  it("reload restores original fields and proof, checks status only, and rejects false retry advice for unknown outcomes", async () => {
    const unknown = {
      accepted: false,
      outcome: "unknown",
      retryable: true,
      code: "WRITE_OUTCOME_UNKNOWN",
      status: 503,
      requestId: "FVI-ABCDEF123456",
    };
    submitInterest.mockResolvedValue(unknown);
    renderPage();
    fillSignup();
    fireEvent.click(screen.getByRole("button", { name: "Verify email and request access" }));
    await screen.findByRole("button", { name: "Check request status" });
    const original = submitInterest.mock.calls[0][0].data;
    cleanup();
    renderPage();
    await waitFor(() => expect(submitInterest).toHaveBeenCalledTimes(2));
    expect(submitInterest.mock.calls[1][0].data).toEqual({ ...original, mode: "check" });
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Example Person");
    expect((screen.getByLabelText("Work email") as HTMLInputElement).value).toBe(
      "person@example.com",
    );
    expect((screen.getByLabelText("Work email") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Continue original request" })).toBeNull();
    expect(document.body.textContent).not.toContain(original.recoveryToken);
    fireEvent.submit(screen.getByLabelText("Work email").closest("form")!);
    expect(submitInterest).toHaveBeenCalledTimes(2);
  });

  it("continues only the original identity after a server-confirmed pre-invitation stop", async () => {
    submitInterest.mockResolvedValueOnce({
      accepted: false,
      outcome: "not_sent",
      retryable: true,
      code: "SIGNUP_RATE_LIMITED",
      status: 429,
      requestId: "FVI-ABCDEF123456",
    });
    renderPage();
    fillSignup();
    fireEvent.click(screen.getByRole("button", { name: "Verify email and request access" }));
    const resume = await screen.findByRole("button", { name: "Continue original request" });
    const original = submitInterest.mock.calls[0][0].data;
    fireEvent.click(resume);
    await screen.findByRole("status");
    expect(submitInterest.mock.calls[1][0].data).toEqual(original);
    expect(submitInterest).toHaveBeenCalledTimes(2);
  });

  it("corrupt persisted recovery cannot silently start a replacement invitation", async () => {
    sessionStorage.setItem("fvi-signup-recovery-v1", "not valid JSON QA_PRIVATE_SENTINEL");
    renderPage();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Verify email and request access",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    expect(submitInterest).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("QA_PRIVATE_SENTINEL");
    expect(screen.getByRole("link", { name: "Forgot Password" })).toBeTruthy();
  });

  it("unavailable browser storage prevents submitting an unrecoverable invitation", async () => {
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("QA_PRIVATE_STORAGE");
    });
    try {
      renderPage();
      await waitFor(() =>
        expect(
          (
            screen.getByRole("button", {
              name: "Verify email and request access",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true),
      );
      expect(submitInterest).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("QA_PRIVATE_STORAGE");
    } finally {
      storage.mockRestore();
    }
  });
});
