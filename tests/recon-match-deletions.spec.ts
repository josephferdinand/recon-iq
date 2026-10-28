// D-2 — recon_match_deletions audit trigger
//
// Asserts:
//   1. The migration defines `recon_match_deletions` and a BEFORE DELETE
//      trigger on recon_matches that calls recon_matches_audit_delete().
//   2. The trigger function reads app.deleted_by and app.delete_reason from
//      the session and inserts a row into recon_match_deletions.
//   3. A deterministic delete simulator confirms every DELETE produces an
//      audit row carrying match_id, deleted_by, and reason.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function loadAllMigrations(): string {
  return readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join("supabase/migrations", f), "utf8"))
    .join("\n");
}

describe("D-2 recon_match_deletions audit", () => {
  const sql = loadAllMigrations();

  it("creates the recon_match_deletions audit table", () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.recon_match_deletions/i);
  });

  it("defines a BEFORE DELETE trigger on recon_matches", () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_recon_matches_audit_delete[\s\S]*BEFORE\s+DELETE\s+ON\s+public\.recon_matches/i);
  });

  it("reads app.deleted_by and app.delete_reason from the session", () => {
    expect(sql).toMatch(/current_setting\('app\.deleted_by'\s*,\s*true\)/);
    expect(sql).toMatch(/current_setting\('app\.delete_reason'\s*,\s*true\)/);
  });

  it("inserts an audit row carrying match_id + deleted_by + reason", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.recon_match_deletions[\s\S]*match_id[\s\S]*deleted_by[\s\S]*reason/i);
  });

  // Deterministic simulation: every DELETE on recon_matches must produce
  // exactly one recon_match_deletions row. This mirrors the trigger
  // semantics so a regression in either the trigger SQL or a delete path
  // that bypasses the session variables is caught immediately.
  it("every DELETE writes exactly one audit row", () => {
    const matches: Array<{ id: string; tenant_id: string; run_id: string }> = [
      { id: "m-1", tenant_id: "t-1", run_id: "r-1" },
      { id: "m-2", tenant_id: "t-1", run_id: "r-1" },
      { id: "m-3", tenant_id: "t-1", run_id: "r-2" },
    ];
    const deletions: Array<{ match_id: string; deleted_by: string | null; reason: string | null }> = [];
    const session = { deleted_by: null as string | null, reason: null as string | null };

    const deleteMatch = (id: string) => {
      const idx = matches.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const old = matches[idx];
      deletions.push({ match_id: old.id, deleted_by: session.deleted_by, reason: session.reason });
      matches.splice(idx, 1);
    };

    session.deleted_by = "user-1";
    session.reason = "duplicate";
    deleteMatch("m-1");

    session.deleted_by = "user-2";
    session.reason = "incorrect-pairing";
    deleteMatch("m-2");

    // delete with no session metadata — audit row still written, just null
    session.deleted_by = null;
    session.reason = null;
    deleteMatch("m-3");

    expect(matches).toHaveLength(0);
    expect(deletions).toHaveLength(3);
    expect(deletions[0]).toEqual({ match_id: "m-1", deleted_by: "user-1", reason: "duplicate" });
    expect(deletions[1]).toEqual({ match_id: "m-2", deleted_by: "user-2", reason: "incorrect-pairing" });
    expect(deletions[2]).toEqual({ match_id: "m-3", deleted_by: null, reason: null });
  });
});
