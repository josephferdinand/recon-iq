import { z } from "zod";

export const WATCHER_TYPES = [
  "freshness",
  "raw_data",
  "row_count_delta",
  "schema_change",
  "dq_failure",
  "no_upload",
  "late_file",
  "duplicate_file",
  "filename_pattern",
  "control_total",
  "checksum_integrity",
] as const;

export type WatcherType = (typeof WATCHER_TYPES)[number];
export type WatcherState = "ok" | "alert" | "insufficient_data";

const common = z.object({
  reminder_hours: z.number().min(1).max(720).default(24),
  quarantine_on_alert: z.boolean().default(false),
});
const age = common.extend({ max_age_hours: z.number().positive().max(8760).default(24) });
const rawData = common
  .extend({
    min_rows: z.number().int().min(0).optional(),
    max_rows: z.number().int().positive().optional(),
    min_bytes: z.number().int().min(0).optional(),
    max_bytes: z.number().int().positive().optional(),
  })
  .refine(
    (value) =>
      value.min_rows === undefined ||
      value.max_rows === undefined ||
      value.min_rows <= value.max_rows,
    "min_rows must not exceed max_rows",
  )
  .refine(
    (value) =>
      value.min_bytes === undefined ||
      value.max_bytes === undefined ||
      value.min_bytes <= value.max_bytes,
    "min_bytes must not exceed max_bytes",
  );
const delta = common.extend({ max_delta_pct: z.number().min(0).max(10000).default(25) });
const schemaChange = common.extend({
  allow_added_columns: z.boolean().default(false),
  expected_columns: z.array(z.string().min(1).max(128)).max(500).optional(),
});
const dqFailure = common.extend({ lookback_runs: z.number().int().min(1).max(100).default(20) });
const lateFile = common.extend({
  business_days: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
  cutoff_hour_utc: z.number().int().min(0).max(23).default(18),
  grace_minutes: z.number().int().min(0).max(1440).default(0),
  holiday_dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u))
    .max(366)
    .default([]),
});
const duplicate = common.extend({ lookback_uploads: z.number().int().min(2).max(100).default(20) });
const filename = common.extend({
  pattern: z.string().min(1).max(200),
  sequence_increment: z.number().int().min(1).max(1_000_000).optional(),
});
const controlTotal = common
  .extend({
    column: z.string().min(1).max(128),
    expected: z.number().finite().optional(),
    tolerance: z.number().min(0).finite().default(0),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .refine(
    (value) => value.expected !== undefined || value.min !== undefined || value.max !== undefined,
    "expected, min or max is required",
  )
  .refine(
    (value) => value.min === undefined || value.max === undefined || value.min <= value.max,
    "min must not exceed max",
  );
const checksum = common.extend({
  require_sha256: z.boolean().default(true),
  expected_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
});

export function parseWatcherConfig(type: WatcherType, value: unknown) {
  const config = value && typeof value === "object" ? value : {};
  switch (type) {
    case "freshness":
    case "no_upload":
      return age.parse(config);
    case "late_file":
      return lateFile.parse(config);
    case "raw_data":
      return rawData.parse(config);
    case "row_count_delta":
      return delta.parse(config);
    case "schema_change":
      return schemaChange.parse(config);
    case "dq_failure":
      return dqFailure.parse(config);
    case "duplicate_file":
      return duplicate.parse(config);
    case "filename_pattern":
      return filename.parse(config);
    case "control_total":
      return controlTotal.parse(config);
    case "checksum_integrity":
      return checksum.parse(config);
  }
}

export type WatcherUpload = {
  id: string;
  created_at: string;
  filename: string;
  row_count: number | null;
  size_bytes: number | null;
  content_sha256: string | null;
  columns: unknown;
  rows: unknown;
};

export type WatcherDqRun = { status: string; started_at: string };
export type WatcherEvaluation = {
  state: WatcherState;
  code: string;
  detail: Record<string, unknown>;
  reminderHours: number;
};

function result(
  state: WatcherState,
  code: string,
  detail: Record<string, unknown>,
  reminderHours: number,
): WatcherEvaluation {
  return { state, code, detail, reminderHours };
}

function columnNames(upload: WatcherUpload) {
  if (Array.isArray(upload.columns)) {
    return upload.columns
      .map((column) =>
        typeof column === "string" ? column : String((column as { name?: unknown })?.name ?? ""),
      )
      .filter(Boolean)
      .sort();
  }
  const first = Array.isArray(upload.rows) ? upload.rows[0] : undefined;
  return first && typeof first === "object" ? Object.keys(first).sort() : [];
}

function globMatches(pattern: string, value: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  const expression = escaped.replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${expression}$`, "iu").test(value);
}

function expectedBusinessCutoff(now: Date, config: z.infer<typeof lateFile>) {
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset),
    );
    const dateKey = date.toISOString().slice(0, 10);
    if (!config.business_days.includes(date.getUTCDay()) || config.holiday_dates.includes(dateKey))
      continue;
    const cutoff = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        config.cutoff_hour_utc,
      ),
    );
    cutoff.setUTCMinutes(cutoff.getUTCMinutes() + config.grace_minutes);
    if (cutoff <= now) return cutoff;
  }
  return null;
}

export function evaluateWatcherInput(args: {
  type: WatcherType;
  config: unknown;
  uploads: WatcherUpload[];
  dqRuns?: WatcherDqRun[];
  now?: Date;
}): WatcherEvaluation {
  let config: ReturnType<typeof parseWatcherConfig>;
  try {
    config = parseWatcherConfig(args.type, args.config);
  } catch {
    return result("alert", "configuration_invalid", {}, 24);
  }
  const reminderHours = config.reminder_hours;
  const uploads = args.uploads
    .slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = uploads[0];
  const previous = uploads[1];
  const now = args.now ?? new Date();

  if (["freshness", "no_upload"].includes(args.type)) {
    const maxAge = (config as z.infer<typeof age>).max_age_hours;
    if (!latest)
      return result("alert", "upload_missing", { threshold_hours: maxAge }, reminderHours);
    const ageHours = Math.max(0, (now.getTime() - Date.parse(latest.created_at)) / 3_600_000);
    return ageHours > maxAge
      ? result(
          "alert",
          "upload_stale",
          { age_hours: Math.round(ageHours * 100) / 100, threshold_hours: maxAge },
          reminderHours,
        )
      : result(
          "ok",
          "within_freshness_window",
          { age_hours: Math.round(ageHours * 100) / 100, threshold_hours: maxAge },
          reminderHours,
        );
  }
  if (args.type === "late_file") {
    const expected = expectedBusinessCutoff(now, config as z.infer<typeof lateFile>);
    if (!expected)
      return result("insufficient_data", "business_cutoff_unavailable", {}, reminderHours);
    if (!latest)
      return result("alert", "file_late", { expected_by: expected.toISOString() }, reminderHours);
    const onTime = Date.parse(latest.created_at) >= expected.getTime();
    return result(
      onTime ? "ok" : "alert",
      onTime ? "file_on_time" : "file_late",
      { expected_by: expected.toISOString(), latest_upload_at: latest.created_at },
      reminderHours,
    );
  }
  if (!latest) return result("insufficient_data", "no_upload_available", {}, reminderHours);

  if (args.type === "raw_data") {
    const cfg = config as z.infer<typeof rawData>;
    const rows = Number(latest.row_count ?? 0);
    const bytes = Number(latest.size_bytes ?? 0);
    const breached =
      (cfg.min_rows !== undefined && rows < cfg.min_rows) ||
      (cfg.max_rows !== undefined && rows > cfg.max_rows) ||
      (cfg.min_bytes !== undefined && bytes < cfg.min_bytes) ||
      (cfg.max_bytes !== undefined && bytes > cfg.max_bytes);
    return result(
      breached ? "alert" : "ok",
      breached ? "raw_volume_out_of_range" : "raw_volume_within_range",
      {
        rows,
        bytes,
        min_rows: cfg.min_rows,
        max_rows: cfg.max_rows,
        min_bytes: cfg.min_bytes,
        max_bytes: cfg.max_bytes,
      },
      reminderHours,
    );
  }
  if (args.type === "row_count_delta") {
    if (!previous) return result("insufficient_data", "previous_upload_missing", {}, reminderHours);
    const priorRows = Number(previous.row_count ?? 0);
    const currentRows = Number(latest.row_count ?? 0);
    const deltaPct = (Math.abs(currentRows - priorRows) / Math.max(Math.abs(priorRows), 1)) * 100;
    const threshold = (config as z.infer<typeof delta>).max_delta_pct;
    return result(
      deltaPct > threshold ? "alert" : "ok",
      deltaPct > threshold ? "row_delta_exceeded" : "row_delta_within_limit",
      {
        current_rows: currentRows,
        previous_rows: priorRows,
        delta_pct: Math.round(deltaPct * 100) / 100,
        threshold_pct: threshold,
      },
      reminderHours,
    );
  }
  if (args.type === "schema_change") {
    const cfg = config as z.infer<typeof schemaChange>;
    const current = columnNames(latest);
    const baseline =
      cfg.expected_columns?.slice().sort() ?? (previous ? columnNames(previous) : null);
    if (!baseline)
      return result(
        "insufficient_data",
        "schema_baseline_missing",
        { current_columns: current.length },
        reminderHours,
      );
    const added = current.filter((name) => !baseline.includes(name));
    const removed = baseline.filter((name) => !current.includes(name));
    const breached = removed.length > 0 || (!cfg.allow_added_columns && added.length > 0);
    return result(
      breached ? "alert" : "ok",
      breached ? "schema_changed" : "schema_compatible",
      { added_columns: added, removed_columns: removed },
      reminderHours,
    );
  }
  if (args.type === "dq_failure") {
    const count = (config as z.infer<typeof dqFailure>).lookback_runs;
    const latestRun = (args.dqRuns ?? [])
      .slice()
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
      .slice(0, count)[0];
    if (!latestRun) return result("insufficient_data", "dq_run_missing", {}, reminderHours);
    return result(
      latestRun.status === "failed" ? "alert" : "ok",
      latestRun.status === "failed" ? "dq_run_failed" : "dq_run_healthy",
      { latest_status: latestRun.status },
      reminderHours,
    );
  }
  if (args.type === "duplicate_file") {
    if (!previous)
      return result("insufficient_data", "comparison_upload_missing", {}, reminderHours);
    const fingerprint = latest.content_sha256;
    if (!fingerprint) return result("alert", "checksum_missing", {}, reminderHours);
    const lookback = (config as z.infer<typeof duplicate>).lookback_uploads;
    const duplicateCount = uploads
      .slice(1, lookback)
      .filter((upload) => upload.content_sha256 === fingerprint).length;
    return result(
      duplicateCount ? "alert" : "ok",
      duplicateCount ? "duplicate_file_detected" : "file_unique",
      { duplicate_count: duplicateCount, lookback_uploads: lookback },
      reminderHours,
    );
  }
  if (args.type === "filename_pattern") {
    const cfg = config as z.infer<typeof filename>;
    const pattern = cfg.pattern;
    const matches = globMatches(pattern, latest.filename);
    if (!matches) return result("alert", "filename_mismatch", { pattern }, reminderHours);
    if (cfg.sequence_increment === undefined)
      return result("ok", "filename_matched", { pattern }, reminderHours);
    if (!previous)
      return result("insufficient_data", "sequence_baseline_missing", { pattern }, reminderHours);
    const currentSequence = latest.filename.match(/\d+(?!.*\d)/u)?.[0];
    const previousSequence = previous.filename.match(/\d+(?!.*\d)/u)?.[0];
    if (!currentSequence || !previousSequence)
      return result("alert", "filename_sequence_missing", { pattern }, reminderHours);
    const expected = Number(previousSequence) + cfg.sequence_increment;
    const actual = Number(currentSequence);
    return result(
      actual === expected ? "ok" : "alert",
      actual === expected ? "filename_sequence_valid" : "filename_sequence_gap",
      { pattern, expected_sequence: expected, actual_sequence: actual },
      reminderHours,
    );
  }
  if (args.type === "control_total") {
    const cfg = config as z.infer<typeof controlTotal>;
    const rows = Array.isArray(latest.rows) ? latest.rows : [];
    if (Number(latest.row_count ?? 0) > rows.length)
      return result(
        "alert",
        "control_total_rows_incomplete",
        { stored_rows: rows.length, reported_rows: Number(latest.row_count ?? 0) },
        reminderHours,
      );
    const values = rows.map((row) =>
      row && typeof row === "object"
        ? Number((row as Record<string, unknown>)[cfg.column])
        : Number.NaN,
    );
    if (!values.length || values.some((value) => !Number.isFinite(value)))
      return result("alert", "control_total_non_numeric", { column: cfg.column }, reminderHours);
    const total = values.reduce((sum, value) => sum + value, 0);
    const outsideExpected =
      cfg.expected !== undefined && Math.abs(total - cfg.expected) > cfg.tolerance;
    const outsideRange =
      (cfg.min !== undefined && total < cfg.min) || (cfg.max !== undefined && total > cfg.max);
    const breached = outsideExpected || outsideRange;
    return result(
      breached ? "alert" : "ok",
      breached ? "control_total_mismatch" : "control_total_balanced",
      {
        column: cfg.column,
        total,
        expected: cfg.expected,
        tolerance: cfg.tolerance,
        min: cfg.min,
        max: cfg.max,
      },
      reminderHours,
    );
  }
  const cfg = config as z.infer<typeof checksum>;
  const fingerprint = latest.content_sha256?.toLowerCase() ?? "";
  const valid = /^[0-9a-f]{64}$/u.test(fingerprint);
  const matches = !cfg.expected_sha256 || fingerprint === cfg.expected_sha256;
  const breached = (cfg.require_sha256 && !valid) || !matches;
  return result(
    breached ? "alert" : "ok",
    breached ? (!valid ? "checksum_missing_or_invalid" : "checksum_mismatch") : "checksum_valid",
    { sha256_present: valid, expected_match: matches },
    reminderHours,
  );
}
