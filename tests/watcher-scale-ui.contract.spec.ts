import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { formatWatcherCondition } from "../src/components/watchers-tab";

describe("watcher scale list contract", () => {
  it("uses an exact RLS-scoped count and deterministic server paging", async () => {
    const server = await readFile("src/lib/watchers.functions.ts", "utf8");
    expect(server).toContain('.eq("tenant_id", data.tenant_id)');
    expect(server).toContain('{ count: "exact" }');
    expect(server).toContain('.range(data.page * data.page_size');
    expect(server).toContain('.order("id", { ascending: true })');
    expect(server).toContain("data_source_id.in.(${sourceIds.join(\",\")})");
    expect(server).toContain('state: z.enum(["all", "ok", "alert", "unknown", "disabled"])');
    const pagedRead = server.split("// Compatibility for the ingestion hub summary")[0];
    expect(pagedRead).toContain('select("id", { count: "exact" })');
    expect(pagedRead).toContain('if (sourceCount > 500)');
    expect(pagedRead).toContain('Too many sources match. Enter a more specific search');
    expect(pagedRead).toContain('.eq("watcher_id", watcherId)');
    expect(pagedRead).toContain('.limit(1)');
    expect(pagedRead).not.toContain('.limit(1000)');
  });

  it("exposes searchable filters, paging and truthful inspector states", async () => {
    const ui = await readFile("src/components/watchers-tab.tsx", "utf8");
    expect(ui).toContain("Search watchers by name or source");
    expect(ui).toContain("Filter by state");
    expect(ui).toContain("Filter by type");
    expect(ui).toContain("Filter by severity");
    expect(ui).toContain("Filter by source");
    expect(ui).toContain("Page {page + 1} of {pageCount}");
    expect(ui).toContain("No recent check is available. State is unknown until a check runs.");
    expect(ui).toContain("No check has been executed yet.");
    expect(ui).toContain("Watcher disabled; history retained");
    expect(ui).toContain('aria-label={`Select watcher ${w.name}`}');
    expect(ui).toContain('aria-label={`View ${w.name}`}');
    expect(ui).toContain('setSelectedId(w.id); setViewId(w.id);');
    expect(ui).toContain('Dialog open={Boolean(viewId)}');
    expect(ui).not.toContain('aria-label={`Evaluate watcher ${w.name}`}');
    expect(ui).not.toContain('aria-label={`Disable watcher ${w.name}`}');
    expect(ui).toContain("formatWatcherCondition(selected.watch_type, selected.config)");
    expect(ui).not.toContain("JSON.stringify(selected.config)");
    expect(ui).not.toContain("JSON.stringify(selected.last_event.detail)");
    expect(ui).toContain("2xl:grid-cols-7");
  });

  it("routes mutation failures through safe user feedback", async () => {
    const ui = await readFile("src/components/watchers-tab.tsx", "utf8");
    expect(ui).toContain('import { notifyUserError } from "@/lib/user-feedback"');
    expect(ui).toContain('notifyUserError(error, "watcher_save")');
    expect(ui).toContain('notifyUserError(error, "watcher_evaluate")');
    expect(ui).not.toMatch(/toast\.error\(e\.message\)/u);
  });

  it("summarizes configured watcher conditions without exposing raw values", () => {
    expect(formatWatcherCondition("freshness", { max_age_hours: 24 })).toBe("Maximum age: 24 hours.");
    expect(formatWatcherCondition("raw_data", { min_rows: 100, max_bytes: 2048 })).toBe("at least 100 rows; at most 2048 bytes.");
    expect(formatWatcherCondition("row_count_delta", { max_delta_pct: 12.5 })).toBe("Maximum row-count change: 12.5%.");
    expect(formatWatcherCondition("checksum_integrity", { expected_sha256: "a".repeat(64) })).toBe("Checks the incoming SHA-256 against a configured expected checksum.");
    expect(formatWatcherCondition("unknown", { secret: "do not print" })).toBe("Condition details are unavailable for this watcher type.");
  });

  it("requires the selected source to belong to the same tenant before a watcher write", async () => {
    const server = await readFile("src/lib/watchers.functions.ts", "utf8");
    const upsert = server.split("export const upsertWatcher =")[1]?.split("export const disableWatcher =")[0] ?? "";
    expect(upsert).toContain('from("workspace_data_sources")');
    expect(upsert).toContain('.eq("id", data.data_source_id)');
    expect(upsert).toContain('.eq("tenant_id", data.tenant_id)');
    expect(upsert).toContain('if (!source) throw');
  });
});
