export interface WorkspaceDashboardRun {
  status: string;
  total_rows: number | null;
  stats: unknown;
}

export interface RecordCounts {
  matchedRecords: number;
  totalRows: number;
}

export function recordCounts(run: WorkspaceDashboardRun): RecordCounts | null {
  const stats = run.stats && typeof run.stats === "object" ? run.stats as Record<string, unknown> : null;
  const matchedRecords = stats?.matched_records;
  const totalRows = run.total_rows ?? stats?.total_rows;
  if (typeof matchedRecords !== "number" || !Number.isFinite(matchedRecords) || matchedRecords < 0 ||
      typeof totalRows !== "number" || !Number.isFinite(totalRows) || totalRows <= 0 || matchedRecords > totalRows) {
    return null;
  }
  return { matchedRecords, totalRows };
}

export function summarizeRecordMatchRate(runs: WorkspaceDashboardRun[]) {
  const completed = runs.filter((run) => run.status === "completed");
  const counts = completed.map(recordCounts);
  const complete = completed.length > 0 && counts.every((value) => value !== null);
  const matchedRecords = counts.reduce((sum, value) => sum + (value?.matchedRecords ?? 0), 0);
  const totalRows = counts.reduce((sum, value) => sum + (value?.totalRows ?? 0), 0);
  return {
    matchedRecords,
    totalRows,
    complete,
    rate: complete && totalRows > 0 ? +(100 * matchedRecords / totalRows).toFixed(1) : null,
  };
}

export function utcDashboardWindow(asOf: Date, days: number) {
  const firstDay = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate() - days + 1));
  const previousStart = new Date(firstDay.getTime() - days * 86_400_000);
  const dayKeys = Array.from({ length: days }, (_, index) =>
    new Date(firstDay.getTime() + index * 86_400_000).toISOString().slice(0, 10));
  return { since: firstDay.toISOString(), previousSince: previousStart.toISOString(), dayKeys, asOf: asOf.toISOString() };
}

export function summarizeExceptionActivity(
  createdRows: Array<{ created_at: string }>,
  resolvedRows: Array<{ created_at: string; resolved_at: string | null }>,
  dayKeys: string[],
) {
  const days = new Map(dayKeys.map((date) => [date, { date, opened: 0, resolved: 0 }]));
  for (const row of createdRows) {
    const day = days.get(row.created_at.slice(0, 10));
    if (day) day.opened += 1;
  }
  const durations: number[] = [];
  for (const row of resolvedRows) {
    if (!row.resolved_at) continue;
    const day = days.get(row.resolved_at.slice(0, 10));
    if (day) day.resolved += 1;
    const duration = new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime();
    if (Number.isFinite(duration) && duration >= 0) durations.push(duration);
  }
  return {
    flow: dayKeys.map((date) => days.get(date)!),
    mttrHours: durations.length
      ? +(durations.reduce((sum, value) => sum + value, 0) / durations.length / 3_600_000).toFixed(1)
      : null,
  };
}
