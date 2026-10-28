import type { StatusSnapshot, StatusComponent } from "@/lib/status.functions";
import { STATUS_SOURCE_FUNCTIONS } from "@/lib/status-service-catalog";

const names = [
  ["auth","Authentication & SSO","Identity"], ["api","Core API","Application"],
  ["workspace","Workspace UI","Application"], ["recon","Reconciliation Engine","Application"],
  ["aidp","Adaptive Document Processing","Application"], ["connectors","Ingestion Connectors","Data"],
  ["reporting","Reporting DB","Data"], ["email","Email Delivery","Platform"],
];
/** Prototype data only; never imported by the public route or server functions. */
export function statusPrototypeSnapshot(synthetic = false): StatusSnapshot {
  const cells = [
    { cell_key: "production-current", environment_key: "production", display_name: "Production", region_code: null, region_label: null, enabled: true },
    { cell_key: "development-current", environment_key: "development", display_name: "Development", region_code: null, region_label: null, enabled: true },
  ];
  const components: StatusComponent[] = names.map(([key,name,group_name],display_order) => ({ id: `source-catalog-${key}`, key, name,
    group_name, display_order, description: null, state: "operational", state_evidence: "catalog_declaration_only", updated_at: "2026-10-03T00:00:00Z" }));
  const health = cells.flatMap((cell) => STATUS_SOURCE_FUNCTIONS.map((fn) => ({ cell_key: cell.cell_key, component_key: fn.component,
    function_key: fn.key, function_label: fn.label, availability: "unverified" as const, probe_kind: null, expected_interval_seconds: null,
    checked_at: null, outcome: null, latency_ms: null })));
  const snapshot: StatusSnapshot = { schema_version: 2, overall: "unknown", data_status: "complete", components, cells, health, history: [], incidents: [],
    generated_at: new Date().toISOString(), history_provenance: "persisted_probe_intervals_only", legacy_history_used: false, truncated: false, notifications_ready: false };
  if (synthetic) {
    snapshot.incidents = [1,2,3].map((version) => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", version, kind: "incident", severity: "major",
      status: version === 1 ? "investigating" : version === 2 ? "monitoring" : "resolved", title: "Synthetic example: delayed source processing",
      summary: version === 1 ? "Synthetic test record: a source-processing delay was reported." : version === 2 ? "Synthetic test update: processing resumed and observations are under review." : "Synthetic corrected example: recovery time was reconciled against the retained fixture evidence.",
      impact: "Synthetic impact statement; no production customer or real incident is represented.",
      cell_keys: ["production-current"], component_keys: ["connectors"], function_keys: ["data.ingestion"],
      started_at: "2026-10-01T09:00:00Z", detected_at: "2026-10-01T09:04:00Z", resolved_at: version === 3 ? "2026-10-01T09:25:00Z" : null,
      planned_end_at: null,
      occurred_at: `2026-10-01T09:${version === 1 ? "04" : version === 2 ? "20" : "25"}:00Z`,
      entered_at: `2026-10-03T08:0${version}:00Z`, published_at: `2026-10-03T08:1${version}:00Z`, display_timezone: "UTC",
      correction_reason: version === 3 ? "Synthetic correction preserves both earlier published updates." : null,
      root_cause: null, remediation: version === 3 ? "Synthetic fixture verified recovery; no production change was made." : null }));
  }
  return snapshot;
}
