import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("reconciliation wizard Excel sheet selection", () => {
  it("requires a choice for a multi-sheet source and records it with the wizard", () => {
    const source = readFileSync("src/components/new-recon-wizard.tsx", "utf8");
    expect(source).toContain('getExcelSheetNames(file)');
    expect(source).toContain('if (sheets.length > 1)');
    expect(source).toContain('disabled={!pendingExcel.selected}');
    expect(source).toContain('handleFile(i, pending.file, pending.selected)');
    expect(source).toContain('sheet_name: sheetName');
    expect(source).toContain('side_excel_sheet_selected');
    expect(source).toContain('excel_sheets: sides.filter');
  });
});
