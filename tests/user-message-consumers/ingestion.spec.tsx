// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { api } = vi.hoisted(() => ({
  api: { parseStatementFile: vi.fn(), listParserRuns: vi.fn() },
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/parsers.functions", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { NativeParserPanel } from "@/components/native-parser-panel";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.listParserRuns.mockResolvedValue([]);
  render(<QueryClientProvider client={client}><NativeParserPanel tenantId="11111111-1111-4111-8111-111111111111" /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace ingestion messages", () => {
  it("shows field-specific required validation and preserves the form without calling the parser", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Parse file" }));

    expect(await screen.findByText("Statement content is required.")).toBeTruthy();
    expect((screen.getByLabelText("Or paste raw content") as HTMLTextAreaElement).value).toBe("");
    expect(api.parseStatementFile).not.toHaveBeenCalled();
  });

  it("shows a positive parse result for the retained sample workflow", async () => {
    api.parseStatementFile.mockResolvedValue({ deduped: false, messages_out: 1, kind: "MT940" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Load Demo Bank sample" }));
    fireEvent.click(screen.getByRole("button", { name: "Parse file" }));

    await waitFor(() => expect(api.parseStatementFile).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps an uncertain parse non-retryable and offers the existing history readback", async () => {
    api.parseStatementFile.mockRejectedValue({
      code: "WRITE_OUTCOME_UNKNOWN",
      status: 503,
      message: "select secret_value from private_table",
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Load Demo Bank sample" }));
    fireEvent.click(screen.getByRole("button", { name: "Parse file" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Check the existing request and its status before retrying");
    expect(alert.textContent).not.toContain("secret_value");
    fireEvent.click(screen.getByRole("button", { name: "Refresh parse history" }));
    await waitFor(() => expect(api.listParserRuns).toHaveBeenCalledTimes(2));
    expect(api.parseStatementFile).toHaveBeenCalledTimes(1);
  });
});
