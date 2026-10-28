import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { extractOcrPages } from "../../workers/aidp-document-service/src/ocr";
import {
  extractDigitalPdfText,
  PdfOcrRequiredError,
} from "../../workers/aidp-document-service/src/pdf";

describe("AIDP scanned PDF OCR", () => {
  it("combines digital and exact OCR pages", async () => {
    const run = vi.fn(async () => ({
      answer: "Account FVI-VALIDATION-001 closing balance USD 132,425.00",
    }));
    await expect(
      extractOcrPages({ run }, new Map([[2, "data:image/png;base64,dGVzdA=="]]), [
        "Digitally extracted page",
        "",
      ]),
    ).resolves.toContain("[Page 2]\nAccount FVI-VALIDATION-001");
    expect(run).toHaveBeenCalledWith(
      "@cf/moondream/moondream3.1-9B-A2B",
      expect.objectContaining({ task: "query", reasoning: false, temperature: 0 }),
    );
  });

  it("fails closed on empty conversion output", async () => {
    await expect(
      extractOcrPages(
        { run: async () => ({ answer: "" }) },
        new Map([[1, "data:image/png;base64,dGVzdA=="]]),
        [""],
      ),
    ).rejects.toThrow("ocr_conversion_failed");
  });

  it("carries page text on the digital-parser OCR signal", () => {
    expect(new PdfOcrRequiredError(3, ["", "digital", ""])).toMatchObject({
      pageCount: 3,
      pageTexts: ["", "digital", ""],
    });
  });

  it("detects the retained two-page fixture as image-only", async () => {
    const bytes = new Uint8Array(
      await readFile("tests/fixtures/fvi-assurance-scanned-bank-statement.pdf"),
    );
    await expect(extractDigitalPdfText(bytes)).rejects.toMatchObject({
      pageCount: 2,
      pageTexts: ["", ""],
    });
  });

  it("detects the retained mixed fixture and preserves its digital page", async () => {
    const bytes = new Uint8Array(
      await readFile("tests/fixtures/fvi-assurance-mixed-bank-statement.pdf"),
    );
    await expect(extractDigitalPdfText(bytes)).rejects.toMatchObject({
      pageCount: 2,
      pageTexts: [expect.stringContaining("FVI-VALIDATION-001"), ""],
    });
  });

  it("accepts the Workers AI result envelope", async () => {
    const run = vi.fn(async () => ({ result: { answer: "Exact nested OCR response" }, usage: {} }));
    await expect(
      extractOcrPages({ run }, new Map([[1, "data:image/png;base64,dGVzdA=="]]), [""]),
    ).resolves.toContain("Exact nested OCR response");
  });
});
