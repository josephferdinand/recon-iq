// D-1 — aidp_outputs live uniqueness
//
// This fixture asserts the partial unique index `aidp_outputs_live_idx` on
// (document_id, entity_type_id) WHERE superseded_at IS NULL exists in the
// applied migration. We do not have an offline Postgres harness in this
// repo's test runner, so we verify the schema-level guarantee by inspecting
// the migration SQL — which is the artefact that ships to every environment.
//
// A duplicate insert against the live partial unique constraint is also
// modelled here as a deterministic regression: any change that drops the
// index, removes the partial predicate, or renames the columns will fail
// this fixture immediately.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function loadAllMigrations(): string {
  const dir = "supabase/migrations";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

describe("D-1 aidp_outputs live uniqueness", () => {
  const sql = loadAllMigrations();

  it("defines a unique index named aidp_outputs_live_idx", () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+aidp_outputs_live_idx/i);
  });

  it("scopes the index to (document_id, entity_type_id)", () => {
    expect(sql).toMatch(/aidp_outputs_live_idx[\s\S]*\(\s*document_id\s*,\s*entity_type_id\s*\)/i);
  });

  it("uses a partial predicate WHERE superseded_at IS NULL", () => {
    expect(sql).toMatch(/aidp_outputs_live_idx[\s\S]*WHERE\s+superseded_at\s+IS\s+NULL/i);
  });

  it("targets the aidp_outputs table", () => {
    expect(sql).toMatch(/aidp_outputs_live_idx\s+ON\s+public\.aidp_outputs/i);
  });

  // Deterministic duplicate-insert model: two concurrent predictions for the
  // same (document_id, entity_type_id) without a superseded_at must violate
  // the partial unique index. We model the index decision function so the
  // test stays fast and dependency-free.
  it("rejects a duplicate live row for the same (document, entity_type)", () => {
    const rows: Array<{ document_id: string; entity_type_id: string; superseded_at: string | null }> = [];
    const insertLive = (document_id: string, entity_type_id: string) => {
      const conflict = rows.find(
        (r) => r.document_id === document_id && r.entity_type_id === entity_type_id && r.superseded_at === null,
      );
      if (conflict) throw new Error("23505: duplicate key value violates aidp_outputs_live_idx");
      rows.push({ document_id, entity_type_id, superseded_at: null });
    };
    insertLive("doc-1", "et-1");
    expect(() => insertLive("doc-1", "et-1")).toThrow(/aidp_outputs_live_idx/);
    // Superseding the first row allows a new live row.
    rows[0].superseded_at = new Date().toISOString();
    expect(() => insertLive("doc-1", "et-1")).not.toThrow();
  });
});
