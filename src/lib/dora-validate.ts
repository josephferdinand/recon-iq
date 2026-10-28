// Pure validation + mapping helpers for DORA / EMIR exporters.
// Used by both the UI (DoraValidationPanel) and the dora-validate.spec test.

export type DoraRegisterRow = {
  id: string;
  provider_name: string | null;
  service_description: string | null;
  criticality: "critical" | "important" | "non_critical" | null;
  country: string | null;
  contract_start: string | null;
  contract_end: string | null;
  status: string | null;
  data_processed: string | null;
  subcontractors_json: unknown;
};

export type DoraIssue = {
  level: "error" | "warning";
  field: string;
  message: string;
  row_id?: string;
};

export type DoraValidationResult = {
  total: number;
  errors: number;
  warnings: number;
  readiness: number; // 0-100
  audit_ready: boolean;
  issues: DoraIssue[];
};

const REQUIRED: Array<keyof DoraRegisterRow> = [
  "provider_name",
  "service_description",
  "criticality",
  "country",
  "contract_start",
];

export function validateDoraRegister(rows: DoraRegisterRow[]): DoraValidationResult {
  const issues: DoraIssue[] = [];
  const today = new Date();
  for (const r of rows) {
    for (const f of REQUIRED) {
      if (!r[f]) issues.push({ level: "error", field: f as string, row_id: r.id, message: `Missing ${String(f)} for provider "${r.provider_name ?? "(unnamed)"}"` });
    }
    if (r.criticality === "critical" && (!r.subcontractors_json || (Array.isArray(r.subcontractors_json) && r.subcontractors_json.length === 0))) {
      issues.push({ level: "warning", field: "subcontractors_json", row_id: r.id, message: `Critical provider "${r.provider_name}" has no documented subcontractors (DORA Art. 28(2))` });
    }
    if (r.contract_end) {
      const end = new Date(r.contract_end);
      if (!Number.isNaN(end.getTime()) && end < today) {
        issues.push({ level: "error", field: "contract_end", row_id: r.id, message: `Contract for "${r.provider_name}" expired on ${r.contract_end}` });
      } else if (!Number.isNaN(end.getTime()) && (end.getTime() - today.getTime()) < 1000 * 60 * 60 * 24 * 90) {
        issues.push({ level: "warning", field: "contract_end", row_id: r.id, message: `Contract for "${r.provider_name}" expires within 90 days (${r.contract_end})` });
      }
    }
    if (r.country && r.country.length !== 2) {
      issues.push({ level: "warning", field: "country", row_id: r.id, message: `Country for "${r.provider_name}" should be a 2-letter ISO-3166 code (got "${r.country}")` });
    }
  }
  const total = rows.length;
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  const denominator = Math.max(total * REQUIRED.length, 1);
  const readiness = Math.max(0, Math.round(100 - (errors / denominator) * 100 - (warnings / (denominator * 2)) * 100));
  return { total, errors, warnings, readiness, audit_ready: errors === 0 && total > 0, issues };
}

// EMIR Refit field mapping — minimal but real subset of the 89-field ESMA dictionary
// used to demonstrate mapping controls. Extend in regulatory.functions.ts when wiring
// the full pack.
export type EmirFieldMapping = { esma_field: string; source_path: string; required: boolean; example: string };

export const EMIR_DEFAULT_MAPPING: EmirFieldMapping[] = [
  { esma_field: "1.1 Reporting Counterparty ID",    source_path: "tenant.lei",                  required: true,  example: "5493001RKR55V4X61F71" },
  { esma_field: "1.2 Other Counterparty ID",        source_path: "trade.counterparty_lei",      required: true,  example: "529900T8BM49AURSDO55" },
  { esma_field: "1.3 Counterparty Side",            source_path: "trade.side",                  required: true,  example: "BUYR" },
  { esma_field: "2.1 UTI",                          source_path: "trade.uti",                    required: true,  example: "DEMO1234567890" },
  { esma_field: "2.5 Asset Class",                  source_path: "trade.asset_class",            required: true,  example: "IRD" },
  { esma_field: "2.30 Notional Amount",             source_path: "trade.notional",               required: true,  example: "1000000.00" },
  { esma_field: "2.31 Notional Currency",           source_path: "trade.notional_ccy",           required: true,  example: "USD" },
  { esma_field: "2.36 Execution Timestamp",         source_path: "trade.exec_ts",                required: true,  example: "2026-06-28T09:30:00Z" },
  { esma_field: "3.1 Clearing Obligation",          source_path: "trade.clearing_obligation",    required: true,  example: "Y" },
  { esma_field: "3.2 Cleared",                      source_path: "trade.cleared",                required: true,  example: "Y" },
];

export function validateEmirMapping(mapping: EmirFieldMapping[]): DoraValidationResult {
  const issues: DoraIssue[] = [];
  for (const m of mapping) {
    if (m.required && !m.source_path) {
      issues.push({ level: "error", field: m.esma_field, message: `Required EMIR field "${m.esma_field}" is not mapped` });
    } else if (m.required && !/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/i.test(m.source_path)) {
      issues.push({ level: "warning", field: m.esma_field, message: `Mapping "${m.source_path}" for "${m.esma_field}" doesn't look like a dotted source path` });
    }
  }
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  const readiness = Math.max(0, Math.round(100 - (errors / mapping.length) * 100 - (warnings / (mapping.length * 2)) * 100));
  return { total: mapping.length, errors, warnings, readiness, audit_ready: errors === 0, issues };
}
