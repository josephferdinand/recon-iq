// Lightweight client-side CSV parser + type inference for the data source onboarding flow.
// Handles quoted fields, escaped quotes, CRLF, and trailing newlines.

export type InferredType = "string" | "number" | "date" | "boolean" | "null";

export interface InferredColumn {
  name: string;
  inferred_type: InferredType;
  nullable: boolean;
  sample: string;
}

export interface ParsedCsv {
  columns: InferredColumn[];
  rows: Record<string, string>[];
  row_count: number;
  sample_rows: Record<string, string>[];
}

export const MAX_CSV_TEXT_LENGTH = 10_000_000;

export function parseCsv(text: string, maxRows = 50000): ParsedCsv {
  if (text.length > MAX_CSV_TEXT_LENGTH) {
    throw new Error(`CSV input exceeds the ${MAX_CSV_TEXT_LENGTH.toLocaleString()}-character limit. Split the file and upload it in smaller parts.`);
  }
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(field);
      records.push(row);
      field = "";
      row = [];
      if (c === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      if (records.length > maxRows + 1) break;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  // Drop trailing empty row
  while (records.length && records[records.length - 1].every((v) => v === "")) records.pop();

  if (records.length === 0) {
    return { columns: [], rows: [], row_count: 0, sample_rows: [] };
  }

  const header = records[0].map((h, idx) => (h.trim() || `column_${idx + 1}`));
  // De-duplicate headers
  const seen = new Map<string, number>();
  const headers = header.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h}_${n}`;
  });

  const dataRows = records.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? "";
    });
    return obj;
  });

  const columns: InferredColumn[] = headers.map((h) => {
    let hasNumber = true;
    let hasDate = true;
    let hasBoolean = true;
    let nullable = false;
    let sample = "";
    let nonNull = 0;
    for (const r of dataRows) {
      const v = (r[h] ?? "").trim();
      if (v === "") {
        nullable = true;
        continue;
      }
      nonNull++;
      if (!sample) sample = v.length > 80 ? v.slice(0, 80) + "…" : v;
      if (hasNumber && !isNumberLike(v)) hasNumber = false;
      if (hasDate && !isDateLike(v)) hasDate = false;
      if (hasBoolean && !isBoolLike(v)) hasBoolean = false;
      if (!hasNumber && !hasDate && !hasBoolean) break;
    }
    let inferred: InferredType = "string";
    if (nonNull === 0) inferred = "null";
    else if (hasBoolean) inferred = "boolean";
    else if (hasNumber) inferred = "number";
    else if (hasDate) inferred = "date";
    return { name: h, inferred_type: inferred, nullable, sample };
  });

  return {
    columns,
    rows: dataRows,
    row_count: dataRows.length,
    sample_rows: dataRows.slice(0, 10),
  };
}

function isNumberLike(v: string) {
  if (!/^-?[\d,]*\.?\d+$/.test(v.replace(/\s/g, ""))) return false;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n);
}
export function isDateLike(v: string) {
  // Date.parse is intentionally not used as a shape detector: JavaScript
  // accepts identifier-like values such as FUND-GLOBAL-01 as dates.
  const explicitDate =
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u.test(v)
    || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/u.test(v);
  return explicitDate && Number.isFinite(Date.parse(v));
}
function isBoolLike(v: string) {
  return /^(true|false|yes|no|y|n|1|0)$/i.test(v);
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
