// Multi-format ingest: routes XLSX / JSON / CSV into the same ParsedCsv shape.
import * as XLSX from "xlsx";
import { parseCsv, type ParsedCsv } from "./csv-parse";

const MAX_FILE_BYTES = 10_000_000;

function assertFileSize(file: File) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_FILE_BYTES.toLocaleString()}-byte upload limit. Split the file and upload it in smaller parts.`);
  }
}

export async function getExcelSheetNames(file: File): Promise<string[]> {
  if (!/\.xlsx?$/i.test(file.name)) return [];
  assertFileSize(file);
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", bookSheets: true });
  return wb.SheetNames;
}

export async function parseAnyFile(file: File, sheetName?: string): Promise<ParsedCsv> {
  assertFileSize(file);
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_FILE_BYTES.toLocaleString()}-byte upload limit. Split the file and upload it in smaller parts.`);
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const wb = XLSX.read(buf, { type: "array" });
    if (wb.SheetNames.length > 1 && !sheetName) {
      throw new Error("Choose an Excel sheet before importing this workbook.");
    }
    const selected = sheetName ?? wb.SheetNames[0];
    if (!selected || !wb.SheetNames.includes(selected)) {
      throw new Error("The selected Excel sheet was not found in this workbook.");
    }
    const ws = wb.Sheets[selected];
    const csv = XLSX.utils.sheet_to_csv(ws);
    return parseCsv(csv);
  }

  if (name.endsWith(".json")) {
    const text = new TextDecoder().decode(buf);
    const obj = JSON.parse(text);
    const arr = Array.isArray(obj) ? obj : (Array.isArray(obj.data) ? obj.data : [obj]);
    if (arr.length === 0) return { columns: [], rows: [], row_count: 0, sample_rows: [] };
    const headers = Array.from(new Set(arr.flatMap((r: any) => Object.keys(r ?? {})))) as string[];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(","), ...arr.map((r: any) => headers.map((h: string) => escape(r?.[h])).join(","))].join("\n");
    return parseCsv(csv);
  }

  // default CSV
  const text = new TextDecoder().decode(buf);
  return parseCsv(text);
}
