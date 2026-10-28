import { describe, expect, it, vi } from "vitest";
import { fromCrossJSON } from "seroval";
import { normalizeCatastrophicSsrResponse } from "@/server";
import { renderErrorPage } from "@/lib/error-page";
import { createErrorReference, safeErrorPayload } from "@/lib/user-facing-errors";

const secret = "postgres password=DO-NOT-SHOW relation private_table";

describe("user-facing catastrophic errors", () => {
  it("uses a non-UUID reference and safe, actionable payload", () => {
    const referenceId = createErrorReference();
    expect(referenceId).toMatch(/^FVI-[A-F0-9]{12}$/);
    expect(safeErrorPayload(referenceId)).toMatchObject({
      title: "Something Didn't Go As Planned",
      reference_id: referenceId,
    });
    expect(renderErrorPage(referenceId)).toContain("Error Reference ID: " + referenceId);
    expect(renderErrorPage(referenceId)).not.toContain(secret);
  });

  it("redacts server-function body and header while preserving a rejected Error envelope", async () => {
    const raw = new Response(JSON.stringify({ message: secret, stack: "secret stack" }), {
      status: 500,
      headers: { "content-type": "application/json", "x-ssr-error": secret, "x-tss-serialized": "true" },
    });
    const safe = await normalizeCatastrophicSsrResponse(raw, new Request("https://app.reconiq.example/_serverFn/test"));
    const body = await safe.text();
    expect(body).not.toContain(secret);
    expect(body).not.toContain("secret stack");
    expect(safe.headers.get("x-ssr-error")).toBeNull();
    expect(safe.headers.get("x-fvi-error-reference")).toMatch(/^FVI-[A-F0-9]{12}$/);
    const decoded = fromCrossJSON(JSON.parse(body), { plugins: [] });
    expect(decoded).toBeInstanceOf(Error);
    expect((decoded as Error).message).toContain("Please try again");
  });

  it("renders a generic HTML error without the raw exception or stack", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = new Response(secret, { status: 500, headers: { "content-type": "text/plain" } });
    try {
      const safe = await normalizeCatastrophicSsrResponse(raw, new Request("https://app.reconiq.example/home"));
      const body = await safe.text();
      expect(safe.status).toBe(500);
      expect(body).toContain("Something Didn't Go As Planned");
      expect(body).toContain("Try again");
      expect(body).not.toContain(secret);
      expect(safe.headers.get("x-ssr-error")).toBeNull();
      expect(safe.headers.get("x-fvi-error-reference")).toMatch(/^FVI-[A-F0-9]{12}$/);
      expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
    } finally {
      logger.mockRestore();
    }
  });
});
