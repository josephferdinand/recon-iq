import { describe, expect, it, vi } from "vitest";

vi.mock("nitro", () => ({ defineErrorHandler: (handler: unknown) => handler }));

import handler from "@/lib/error-handler";

describe("global Nitro error handler", () => {
  it("returns an actionable response without technical details", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const raw = Object.assign(new Error("postgres password=DO-NOT-SHOW"), {
        statusCode: 503,
        cause: { secret: "DO-NOT-SHOW" },
      });
      const response = (handler as (error: unknown, event: unknown) => Response)(raw, { path: "/home?token=PRIVATE" });
      const body = await response.text();
      expect(response.status).toBe(503);
      expect(response.headers.get("x-fvi-error-reference")).toMatch(/^FVI-[A-F0-9]{12}$/);
      expect(body).toContain("Unable To Reach The Service");
      expect(body).toContain("Please try again shortly");
      expect(body).not.toContain("postgres");
      expect(body).not.toContain("DO-NOT-SHOW");
      expect(body).not.toContain("PRIVATE");
      expect(body).not.toContain("stack");
      expect(logger).toHaveBeenCalledWith("[NITRO_ERROR]", expect.objectContaining({ path: "/home" }));
      expect(JSON.stringify(logger.mock.calls)).not.toContain("DO-NOT-SHOW");
      expect(JSON.stringify(logger.mock.calls)).not.toContain("PRIVATE");
    } finally {
      logger.mockRestore();
    }
  });
});
