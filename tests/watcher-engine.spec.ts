import { describe, expect, it } from "vitest";
import { evaluateWatcherInput, parseWatcherConfig, type WatcherUpload } from "@/lib/watcher-engine";

const now = new Date("2026-09-06T00:00:00.000Z");
function upload(overrides: Partial<WatcherUpload> = {}): WatcherUpload {
  return {
    id: crypto.randomUUID(),
    created_at: "2026-09-05T23:00:00.000Z",
    filename: "nostro_20260905.csv",
    row_count: 10,
    size_bytes: 1024,
    content_sha256: "a".repeat(64),
    columns: ["account", "amount"],
    rows: [
      { account: "A", amount: 40 },
      { account: "B", amount: 60 },
    ],
    ...overrides,
  };
}

describe("watcher engine", () => {
  it("validates bounded type-specific configuration", () => {
    expect(() => parseWatcherConfig("freshness", { max_age_hours: 0 })).toThrow();
    expect(() => parseWatcherConfig("raw_data", { min_rows: 20, max_rows: 10 })).toThrow();
    expect(() => parseWatcherConfig("control_total", { column: "amount" })).toThrow();
    expect(() => parseWatcherConfig("filename_pattern", { pattern: "" })).toThrow();
  });

  it.each(["freshness", "no_upload"] as const)(
    "handles %s boundaries and missing uploads",
    (type) => {
      expect(
        evaluateWatcherInput({ type, config: { max_age_hours: 1 }, uploads: [upload()], now })
          .state,
      ).toBe("ok");
      expect(
        evaluateWatcherInput({ type, config: { max_age_hours: 0.5 }, uploads: [upload()], now })
          .state,
      ).toBe("alert");
      expect(
        evaluateWatcherInput({ type, config: { max_age_hours: 1 }, uploads: [], now }).code,
      ).toBe("upload_missing");
    },
  );

  it("uses a weekday cutoff, grace period and holiday calendar for late files", () => {
    const config = {
      business_days: [1, 2, 3, 4, 5],
      cutoff_hour_utc: 18,
      grace_minutes: 30,
      holiday_dates: [],
    };
    const afterCutoff = new Date("2026-09-07T19:00:00Z");
    expect(
      evaluateWatcherInput({
        type: "late_file",
        config,
        uploads: [upload({ created_at: "2026-09-07T18:45:00Z" })],
        now: afterCutoff,
      }).code,
    ).toBe("file_on_time");
    expect(
      evaluateWatcherInput({
        type: "late_file",
        config,
        uploads: [upload({ created_at: "2026-09-05T18:45:00Z" })],
        now: afterCutoff,
      }).code,
    ).toBe("file_late");
    expect(
      evaluateWatcherInput({
        type: "late_file",
        config: { ...config, holiday_dates: ["2026-09-07"] },
        uploads: [upload({ created_at: "2026-09-04T18:45:00Z" })],
        now: afterCutoff,
      }).code,
    ).toBe("file_on_time");
  });

  it("checks raw row and byte volumes", () => {
    expect(
      evaluateWatcherInput({
        type: "raw_data",
        config: { min_rows: 5, max_rows: 20, min_bytes: 100 },
        uploads: [upload()],
      }).state,
    ).toBe("ok");
    expect(
      evaluateWatcherInput({ type: "raw_data", config: { min_rows: 11 }, uploads: [upload()] })
        .code,
    ).toBe("raw_volume_out_of_range");
  });

  it("calculates row-count deltas with exact threshold semantics", () => {
    const latest = upload({ row_count: 125 });
    const previous = upload({ row_count: 100, created_at: "2026-09-05T22:00:00.000Z" });
    expect(
      evaluateWatcherInput({
        type: "row_count_delta",
        config: { max_delta_pct: 25 },
        uploads: [latest, previous],
      }).state,
    ).toBe("ok");
    expect(
      evaluateWatcherInput({
        type: "row_count_delta",
        config: { max_delta_pct: 24.9 },
        uploads: [latest, previous],
      }).state,
    ).toBe("alert");
    expect(
      evaluateWatcherInput({ type: "row_count_delta", config: {}, uploads: [latest] }).state,
    ).toBe("insufficient_data");
  });

  it("detects removed columns and optionally tolerates additions", () => {
    const previous = upload({
      columns: ["account", "amount"],
      created_at: "2026-09-05T22:00:00.000Z",
    });
    expect(
      evaluateWatcherInput({
        type: "schema_change",
        config: {},
        uploads: [upload({ columns: ["account"] }), previous],
      }).state,
    ).toBe("alert");
    expect(
      evaluateWatcherInput({
        type: "schema_change",
        config: { allow_added_columns: true },
        uploads: [upload({ columns: ["account", "amount", "currency"] }), previous],
      }).state,
    ).toBe("ok");
  });

  it("uses the latest Data Prep run for DQ health", () => {
    const dqRuns = [
      { status: "failed", started_at: "2026-09-05T23:00:00Z" },
      { status: "succeeded", started_at: "2026-09-05T22:00:00Z" },
    ];
    expect(
      evaluateWatcherInput({ type: "dq_failure", config: {}, uploads: [upload()], dqRuns }).code,
    ).toBe("dq_run_failed");
    expect(
      evaluateWatcherInput({ type: "dq_failure", config: {}, uploads: [upload()], dqRuns: [] })
        .state,
    ).toBe("insufficient_data");
  });

  it("detects duplicate content within a bounded lookback", () => {
    const previous = upload({ created_at: "2026-09-05T22:00:00Z" });
    expect(
      evaluateWatcherInput({
        type: "duplicate_file",
        config: { lookback_uploads: 10 },
        uploads: [upload(), previous],
      }).code,
    ).toBe("duplicate_file_detected");
    expect(
      evaluateWatcherInput({
        type: "duplicate_file",
        config: {},
        uploads: [upload({ content_sha256: "b".repeat(64) }), previous],
      }).state,
    ).toBe("ok");
  });

  it("supports bounded glob filename rules without executable regex input", () => {
    expect(
      evaluateWatcherInput({
        type: "filename_pattern",
        config: { pattern: "nostro_????????.csv" },
        uploads: [upload({ row_count: 2 })],
      }).state,
    ).toBe("ok");
    expect(
      evaluateWatcherInput({
        type: "filename_pattern",
        config: { pattern: "custody_*.csv" },
        uploads: [upload()],
      }).state,
    ).toBe("alert");
  });

  it("detects gaps in the final numeric filename sequence", () => {
    const previous = upload({
      filename: "batch_0041.csv",
      created_at: "2026-09-05T22:00:00Z",
    });
    expect(
      evaluateWatcherInput({
        type: "filename_pattern",
        config: { pattern: "batch_*.csv", sequence_increment: 1 },
        uploads: [upload({ filename: "batch_0042.csv" }), previous],
      }).code,
    ).toBe("filename_sequence_valid");
    expect(
      evaluateWatcherInput({
        type: "filename_pattern",
        config: { pattern: "batch_*.csv", sequence_increment: 1 },
        uploads: [upload({ filename: "batch_0044.csv" }), previous],
      }).code,
    ).toBe("filename_sequence_gap");
  });

  it("computes numeric control totals and rejects non-numeric rows", () => {
    expect(
      evaluateWatcherInput({
        type: "control_total",
        config: { column: "amount", expected: 100 },
        uploads: [upload({ row_count: 2 })],
      }).code,
    ).toBe("control_total_balanced");
    expect(
      evaluateWatcherInput({
        type: "control_total",
        config: { column: "amount", expected: 101, tolerance: 0.5 },
        uploads: [upload({ row_count: 2 })],
      }).state,
    ).toBe("alert");
    expect(
      evaluateWatcherInput({
        type: "control_total",
        config: { column: "amount", expected: 100 },
        uploads: [upload({ row_count: 1, rows: [{ amount: "bad" }] })],
      }).code,
    ).toBe("control_total_non_numeric");
    expect(
      evaluateWatcherInput({
        type: "control_total",
        config: { column: "amount", expected: 100 },
        uploads: [upload({ row_count: 3 })],
      }).code,
    ).toBe("control_total_rows_incomplete");
  });

  it("validates required and expected SHA-256 fingerprints", () => {
    expect(
      evaluateWatcherInput({ type: "checksum_integrity", config: {}, uploads: [upload()] }).code,
    ).toBe("checksum_valid");
    expect(
      evaluateWatcherInput({
        type: "checksum_integrity",
        config: {},
        uploads: [upload({ content_sha256: null })],
      }).state,
    ).toBe("alert");
    expect(
      evaluateWatcherInput({
        type: "checksum_integrity",
        config: { expected_sha256: "b".repeat(64) },
        uploads: [upload()],
      }).code,
    ).toBe("checksum_mismatch");
  });

  it("fails closed on invalid persisted configuration", () => {
    expect(
      evaluateWatcherInput({ type: "filename_pattern", config: {}, uploads: [upload()] }),
    ).toMatchObject({ state: "alert", code: "configuration_invalid" });
  });
});
