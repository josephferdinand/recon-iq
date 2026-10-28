export const REPORT_DEFINITION_FORMATS = ["csv", "json"] as const;
export type ReportDefinitionFormat = (typeof REPORT_DEFINITION_FORMATS)[number];

export function runtimeReportFormat(value: unknown): ReportDefinitionFormat {
  return value === "json" ? "json" : "csv";
}

export function reportFormatLabel(value: unknown): string {
  if (value === "json") return "JSON";
  if (value === "csv") return "CSV";
  return `CSV (legacy ${String(value).toUpperCase()} definition)`;
}
