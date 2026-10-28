import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { getExcelSheetNames, parseAnyFile } from "../src/lib/file-parse";

describe("XLSX dependency and ingestion", () => {
  it("uses the patched SheetJS release", () => {
    expect(XLSX.version).toBe("0.20.3");
  });

  it("round-trips a workbook through the reconciliation file parser", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["account", "amount", "settled"],
      ["A-100", 125.5, true],
      ["B-200", -40, false],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
    const workbookBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;

    const file = {
      name: "transactions.xlsx",
      arrayBuffer: async () => workbookBuffer,
    } as File;

    const parsed = await parseAnyFile(file);

    expect(parsed.row_count).toBe(2);
    expect(parsed.columns.map((column) => column.name)).toEqual([
      "account",
      "amount",
      "settled",
    ]);
    expect(parsed.rows).toEqual([
      { account: "A-100", amount: "125.5", settled: "TRUE" },
      { account: "B-200", amount: "-40", settled: "FALSE" },
    ]);
  });

  it("requires an explicit selection for multiple sheets and parses only the chosen sheet", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ledger_id", "amount"], ["L-1", 100],
    ]), "Ledger");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["bank_id", "amount"], ["B-1", 101],
    ]), "Bank statement");
    const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const file = { name: "multi.xlsx", arrayBuffer: async () => data } as File;

    expect(await getExcelSheetNames(file)).toEqual(["Ledger", "Bank statement"]);
    await expect(parseAnyFile(file)).rejects.toThrow("Choose an Excel sheet");
    await expect(parseAnyFile(file, "Missing")).rejects.toThrow("not found");
    const selected = await parseAnyFile(file, "Bank statement");
    expect(selected.columns.map((column) => column.name)).toEqual(["bank_id", "amount"]);
    expect(selected.rows).toEqual([{ bank_id: "B-1", amount: "101" }]);
  });
});
