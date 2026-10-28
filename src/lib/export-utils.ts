/**
 * Client-side export helpers for CSV / JSON / XLSX / print-to-PDF.
 *
 * Two APIs live here for historical reasons:
 *   1. Column-based:  exportCsv(filename, cols, rows), exportPdf(...)
 *      Uses ExportColumn<T> with an optional value() extractor. Preferred
 *      when rows have nested / derived fields.
 *   2. Row-based:     exportCSV(rows, filename), exportJSON, exportXLSX
 *      Auto-infers columns from the first row's keys. Convenient for flat
 *      analytics rows.
 *
 * PDF is rendered by opening a print window; users pick "Save as PDF" from
 * the browser print dialog. No heavy PDF dep is shipped.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Column-based API (ExportColumn)
// ─────────────────────────────────────────────────────────────────────────────

export type ExportColumn<T> = {
  key: string;
  header: string;
  value?: (row: T) => any;
};

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function extract<T>(col: ExportColumn<T>, row: T): any {
  if (col.value) return col.value(row);
  return (row as any)[col.key];
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Column-based CSV export. */
export function exportCsv<T>(
  filename: string,
  cols: ExportColumn<T>[],
  rows: T[],
) {
  const header = cols.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((r) =>
    cols.map((c) => csvEscape(extract(c, r))).join(","),
  );
  const csv = [header, ...lines].join("\n");
  triggerDownload(
    filename.endsWith(".csv") ? filename : `${filename}.csv`,
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
}

/** Column-based PDF export via browser print. */
export function exportPdf<T>(
  filename: string,
  title: string,
  subtitle: string | undefined,
  cols: ExportColumn<T>[],
  rows: T[],
) {
  const escapeHtml = (v: any) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const th = cols.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const tr = rows
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => `<td>${escapeHtml(extract(c, r))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const body = `
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<div class="meta">${escapeHtml(subtitle)}</div>` : ""}
    <div class="meta">Generated ${new Date().toLocaleString()} · ${rows.length} rows · Filename: ${escapeHtml(filename)}</div>
    <table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  openPrintWindow(title, body);
}

/**
 * Column-based real XLSX export (SheetJS). Uses dynamic import so the ~500KB
 * SheetJS library is only pulled in when the user actually clicks the button.
 */
export async function exportXlsxCols<T>(
  filename: string,
  sheetName: string,
  cols: ExportColumn<T>[],
  rows: T[],
) {
  const XLSX = await import("xlsx");
  const header = cols.map((c) => c.header);
  const body = rows.map((r) => cols.map((c) => extract(c, r) ?? ""));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws["!cols"] = header.map((h) => ({ wch: Math.max(12, Math.min(48, h.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  triggerDownload(
    filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`,
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
}

function openPrintWindow(title: string, bodyHtml: string) {
  const w = window.open("", "_blank", "width=1024,height=768");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;padding:24px;line-height:1.4}
      h1{font-size:20px;margin:0 0 4px}
      .meta{color:#666;font-size:12px;margin-bottom:8px}
      table{border-collapse:collapse;width:100%;font-size:11px;margin-top:12px}
      th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
      th{background:#f4f4f5}
      tr:nth-child(even) td{background:#fafafa}
      .badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;background:#eef;border:1px solid #ccd}
      .sev-critical{background:#fee;border-color:#f99;color:#900}
      .sev-warning{background:#fef7e0;border-color:#e6c86b;color:#7a5b00}
      .sev-info{background:#eef7ee;border-color:#9c9;color:#175}
      @media print { body{padding:12px} }
    </style></head><body>${bodyHtml}
    <script>window.addEventListener('load',()=>setTimeout(()=>{window.print();},250));</script>
    </body></html>`);
  w.document.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Row-based API (rows: Record<string, any>[])
// ─────────────────────────────────────────────────────────────────────────────

export function exportCSV(rows: Array<Record<string, any>>, filename: string) {
  if (!rows.length) {
    triggerDownload(filename, new Blob([""], { type: "text/csv" }));
    return;
  }
  const keys = Object.keys(rows[0]);
  const header = keys.map(csvEscape).join(",");
  const lines = rows.map((r) => keys.map((k) => csvEscape(r[k])).join(","));
  const csv = [header, ...lines].join("\n");
  triggerDownload(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

export function exportJSON(rows: any, filename: string) {
  triggerDownload(
    filename,
    new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
  );
}

/**
 * Excel-compatible export. We emit UTF-8 CSV with a BOM so Excel opens it
 * cleanly; no xlsx runtime dependency needed. The .xlsx extension is a
 * courtesy for users who filter by extension — Excel handles the CSV bytes.
 */
export function exportXLSX(
  rows: Array<Record<string, any>>,
  filename: string,
) {
  if (!rows.length) {
    triggerDownload(filename, new Blob(["\uFEFF"], { type: "text/csv" }));
    return;
  }
  const keys = Object.keys(rows[0]);
  const header = keys.map(csvEscape).join(",");
  const lines = rows.map((r) => keys.map((k) => csvEscape(r[k])).join(","));
  const csv = "\uFEFF" + [header, ...lines].join("\n");
  triggerDownload(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level helpers used by newer pages (audit / security scan exports)
// ─────────────────────────────────────────────────────────────────────────────

export function toCsv<T extends Record<string, any>>(
  rows: T[],
  columns: {
    key: keyof T;
    header: string;
    format?: (v: any, row: T) => string;
  }[],
): string {
  const header = columns.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((r) =>
    columns
      .map((c) => csvEscape(c.format ? c.format(r[c.key], r) : r[c.key]))
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  triggerDownload(
    filename.endsWith(".csv") ? filename : `${filename}.csv`,
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
}

export function printAsPdf(title: string, bodyHtml: string) {
  openPrintWindow(title, bodyHtml);
}

export function tableHtml(
  columns: { header: string; render: (r: any) => string }[],
  rows: any[],
): string {
  const th = columns.map((c) => `<th>${c.header}</th>`).join("");
  const tr = rows
    .map(
      (r) =>
        `<tr>${columns.map((c) => `<td>${c.render(r) ?? ""}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}
