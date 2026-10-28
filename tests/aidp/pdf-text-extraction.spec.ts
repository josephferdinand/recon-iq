import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { extractDigitalPdfText } from "../../workers/aidp-document-service/src/pdf";

describe("AIDP digital PDF extraction", () => {
  it("extracts all pages and retained financial control totals", async () => {
    const file = await readFile(
      new URL("../../tests/fixtures/fvi-assurance-multipage-bank-statement.pdf", import.meta.url),
    );
    const result = await extractDigitalPdfText(new Uint8Array(file));
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("[Page 1]");
    expect(result.text).toContain("[Page 2]");
    expect(result.text).toContain("FVI-VALIDATION-001");
    expect(result.text).toContain("132,425.00");
    expect(result.text).toContain("Transaction count");
  });
});
