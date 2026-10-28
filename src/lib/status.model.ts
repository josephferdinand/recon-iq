import { z } from "zod";

export const statusState = z.enum(["operational", "degraded_performance", "partial_outage", "major_outage", "maintenance", "unknown", "stale", "not_available"]);
export type StatusState = z.infer<typeof statusState>;
export const statusCellSchema = z.object({
  cell_key: z.string(), environment_key: z.string(), display_name: z.string(),
  region_code: z.string().nullable(), region_label: z.string().nullable(), enabled: z.boolean(),
});
export const statusHealthSchema = z.object({
  cell_key: z.string(), component_key: z.string(), function_key: z.string(), function_label: z.string(),
  availability: z.enum(["deployed", "source_only", "disabled", "unverified"]),
  probe_kind: z.enum(["functional", "availability"]).nullable(),
  expected_interval_seconds: z.number().positive().nullable(),
  checked_at: z.string().nullable(), outcome: z.enum(["healthy", "degraded", "outage", "unknown"]).nullable(),
  latency_ms: z.number().nonnegative().nullable(),
});
export const statusDaySchema = z.object({
  cell_key: z.string(), function_key: z.string(), day: z.string(), sample_count: z.number().nonnegative(),
  healthy_count: z.number().nonnegative(), observed_seconds: z.number().nonnegative(),
  healthy_seconds: z.number().nonnegative(), uptime_pct: z.number().min(0).max(100).nullable(),
});
export const publicIncidentSchema = z.object({
  id: z.string(), version: z.number().int(), entered_at: z.string(), published_at: z.string(),
  kind: z.enum(["incident", "maintenance"]), title: z.string(), summary: z.string(), impact: z.string().nullable(),
  severity: z.enum(["minor", "major", "critical"]),
  status: z.enum(["investigating", "identified", "monitoring", "resolved", "scheduled", "in_progress", "completed"]),
  cell_keys: z.array(z.string()), component_keys: z.array(z.string()), function_keys: z.array(z.string()),
  started_at: z.string(), detected_at: z.string().nullable(), resolved_at: z.string().nullable(),
  planned_end_at: z.string().nullable().default(null),
  occurred_at: z.string(), display_timezone: z.string(), correction_reason: z.string().nullable(),
  root_cause: z.string().nullable(), remediation: z.string().nullable(),
});
export type StatusCell = z.infer<typeof statusCellSchema>;
export type StatusHealth = z.infer<typeof statusHealthSchema>;
export type StatusDay = z.infer<typeof statusDaySchema>;
export type PublicStatusIncident = z.infer<typeof publicIncidentSchema>;

export function measuredState(row: StatusHealth, now = Date.now()): StatusState {
  if (row.availability === "disabled" || row.availability === "source_only") return "not_available";
  if (row.availability !== "deployed" || row.probe_kind !== "functional" || !row.checked_at || !row.expected_interval_seconds) return "unknown";
  const stamp = Date.parse(row.checked_at);
  if (!Number.isFinite(stamp) || stamp > now || now - stamp > row.expected_interval_seconds * 2000) return "stale";
  return row.outcome === "healthy" ? "operational" : row.outcome === "outage" ? "major_outage" : row.outcome === "degraded" ? "degraded_performance" : "unknown";
}

export function overallState(states: readonly StatusState[], complete = true): StatusState {
  if (states.includes("major_outage")) return "major_outage";
  if (states.includes("partial_outage")) return "partial_outage";
  if (states.includes("degraded_performance")) return "degraded_performance";
  const relevant = states.filter((state) => state !== "not_available");
  if (!complete || relevant.length === 0 || relevant.includes("unknown")) return "unknown";
  if (relevant.includes("stale")) return "stale";
  if (relevant.includes("maintenance")) return "maintenance";
  return "operational";
}

export function historyMeasurement(days: readonly StatusDay[]) {
  const observed = days.reduce((sum, day) => sum + day.observed_seconds, 0);
  const healthy = days.reduce((sum, day) => sum + day.healthy_seconds, 0);
  return { uptime_pct: observed > 0 ? healthy / observed * 100 : null,
    observed_seconds: observed, sampled_days: new Set(days.map((day) => day.day)).size,
    sample_count: days.reduce((sum, day) => sum + day.sample_count, 0) };
}

export const INCIDENT_PHASES = ["investigating", "identified", "monitoring", "resolved", "scheduled", "in_progress", "completed"] as const;
export const incidentDraftSchema = z.object({
  kind: z.enum(["incident", "maintenance"]), severity: z.enum(["minor", "major", "critical"]),
  status: z.enum(INCIDENT_PHASES), title: z.string().trim().min(4).max(160),
  summary: z.string().trim().min(8).max(2000), impact: z.string().trim().max(1200).nullable(),
  cell_keys: z.array(z.string().regex(/^[a-z0-9_-]{1,64}$/)).min(1).max(50),
  component_keys: z.array(z.string().regex(/^[a-z0-9_-]{1,64}$/)).min(1).max(40),
  function_keys: z.array(z.string().regex(/^[a-z0-9_.-]{1,100}$/)).max(100),
  started_at: z.string().datetime({ offset: true }), detected_at: z.string().datetime({ offset: true }).nullable(),
  resolved_at: z.string().datetime({ offset: true }).nullable(), occurred_at: z.string().datetime({ offset: true }),
  planned_end_at: z.string().datetime({ offset: true }).nullable().default(null),
  display_timezone: z.string().max(64).refine((zone) => { try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; } }, "Choose a valid time zone."),
  correction_reason: z.string().trim().min(8).max(800).nullable(),
  root_cause: z.string().trim().max(2000).nullable(), remediation: z.string().trim().max(2000).nullable(),
  evidence_ref: z.string().trim().min(8).max(500), public_safe: z.literal(true),
}).superRefine((draft, ctx) => {
  const publicCopy = [draft.title, draft.summary, draft.impact, draft.root_cause, draft.remediation, draft.correction_reason].filter(Boolean).join("\n");
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:bearer\s+|api[_ -]?key\s*[:=]|sb_secret_|Zoho-enczapikey)|\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b|\bat\s+\w+\s*\([^\n]*:\d+:\d+\)/i.test(publicCopy)) ctx.addIssue({ code: "custom", path: ["summary"], message: "Remove personal identifiers, credentials and raw diagnostics from the public text." });
  const start = Date.parse(draft.started_at), detected = draft.detected_at ? Date.parse(draft.detected_at) : null;
  const resolved = draft.resolved_at ? Date.parse(draft.resolved_at) : null;
  if (draft.status !== "scheduled" && start > Date.now()) ctx.addIssue({ code: "custom", path: ["started_at"], message: "An actual incident/maintenance start cannot be in the future." });
  if (detected !== null && detected > Date.now()) ctx.addIssue({ code: "custom", path: ["detected_at"], message: "Actual detection cannot be in the future." });
  if (detected !== null && detected < start) ctx.addIssue({ code: "custom", path: ["detected_at"], message: "Detection cannot precede the incident start." });
  if (resolved !== null && (resolved < start || resolved > Date.now())) ctx.addIssue({ code: "custom", path: ["resolved_at"], message: "Resolution must follow the start and cannot be in the future." });
  if (Date.parse(draft.occurred_at) > Date.now()) ctx.addIssue({ code: "custom", path: ["occurred_at"], message: "An announcement/update event cannot be in the future." });
  if (draft.planned_end_at && (draft.kind !== "maintenance" || Date.parse(draft.planned_end_at) < start)) ctx.addIssue({ code: "custom", path: ["planned_end_at"], message: "The planned maintenance end must follow its planned start." });
  if (["resolved", "completed"].includes(draft.status) && !draft.resolved_at) ctx.addIssue({ code: "custom", path: ["resolved_at"], message: "Enter the actual resolution time." });
  if (draft.kind === "incident" && ["scheduled", "in_progress", "completed"].includes(draft.status) || draft.kind === "maintenance" && ["investigating", "identified", "monitoring", "resolved"].includes(draft.status)) ctx.addIssue({ code: "custom", path: ["status"], message: "Choose a phase that matches the record type." });
});
