import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watcher transition migration", () => {
  it("records immutable tenant-scoped evaluations with deduplicated alert/recovery notification", async () => {
    const sql = await readFile(
      "supabase/migrations/20260906061500_harden_data_watchers.sql",
      "utf8",
    );
    for (const type of [
      "raw_data",
      "late_file",
      "duplicate_file",
      "filename_pattern",
      "control_total",
      "checksum_integrity",
    ])
      expect(sql).toContain(`'${type}'`);
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("watcher.recovered");
    expect(sql).toContain("last_alerted_at + make_interval");
    expect(sql).toContain("data_watcher_events_member_read");
    expect(sql).toContain("data_watchers_validate_tenant");
    expect(sql).toContain("Watcher source must belong to the same tenant");
    expect(sql).not.toContain(
      "watcher_id uuid NOT NULL REFERENCES public.data_watchers(id) ON DELETE CASCADE",
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_data_watcher_evaluation[\s\S]*authenticated/iu,
    );
    expect(sql).toContain("'watcher.evaluated'");
    expect(sql).toContain("Watcher quarantine:");
    expect(sql).toContain("'source_quarantined', quarantined");
  });
});
