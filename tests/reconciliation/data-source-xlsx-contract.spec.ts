import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Excel data-source upload contract", () => {
  it("renders the governed file control for xlsx sources", () => {
    const source = readFileSync("src/components/data-sources-tab.tsx", "utf8");
    expect(source).toContain('sourceType === "csv" || sourceType === "xlsx" || sourceType === "json"');
    expect(source).toContain('selectedRow.source_type) ? (');
    expect(source).toContain('accept=".csv,text/csv,application/json,.json,.xlsx,.xls');
    expect(source).toContain('getExcelSheetNames(file)');
    expect(source).toContain('if (sheets.length > 1)');
    expect(source).toContain('Choose a sheet…');
    expect(source).toContain('disabled={!pendingExcel.selected || uploadingId === selectedRow.id}');
    expect(source).toContain('handleFile(selectedRow.id, pendingExcel.file, pendingExcel.selected)');
    expect(source).toContain('filename: uploadName');
  });
});
