import { describe, expect, it, vi } from "vitest";

import { extractPdfTextWithService } from "../../src/lib/aidp-document-service.server";

describe("AIDP document service binding", () => {
  it("sends bounded PDF bytes through the binding and validates the response", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://aidp-document-service/v1/pdf/text");
      expect(request.headers.get("content-type")).toBe("application/pdf");
      expect((await request.arrayBuffer()).byteLength).toBe(4);
      return Response.json({ pageCount: 2, text: "[Page 1]\nA\n\n[Page 2]\nB" });
    });
    await expect(
      extractPdfTextWithService(new Uint8Array([1, 2, 3, 4]), { fetch }),
    ).resolves.toEqual({
      pageCount: 2,
      text: "[Page 1]\nA\n\n[Page 2]\nB",
      extractionMode: "digital",
      conversionTokens: 0,
    });
  });

  it("fails closed for missing bindings, OCR responses, and malformed output", async () => {
    await expect(extractPdfTextWithService(new Uint8Array([1]), null)).rejects.toThrow(
      "binding unavailable",
    );
    await expect(
      extractPdfTextWithService(new Uint8Array([1]), {
        fetch: async () => Response.json({ error: "ocr_required" }, { status: 422 }),
      }),
    ).rejects.toThrow("OCR is required");
    await expect(
      extractPdfTextWithService(new Uint8Array([1]), {
        fetch: async () => Response.json({ pageCount: 0, text: "" }),
      }),
    ).rejects.toThrow("invalid page count");
  });
});
