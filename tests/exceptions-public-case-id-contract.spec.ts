import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260924235200_exception_public_case_ids.sql";

describe("exception public identity and read-scope migration contract", () => {
  it("generates independent immutable public IDs with tenant uniqueness and backfill", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("WHERE public_case_id IS NULL");
    expect(migration).toContain("'FVI-EXC-' || upper(replace(gen_random_uuid()::text, '-', ''))");
    expect(migration).toContain("recon_exceptions_tenant_public_case_id_uidx");
    expect(migration).toContain("exception case identifier is immutable");
    expect(migration).toContain("exception case identifier is system managed");
    expect(migration).toContain("NEW.public_case_id IS DISTINCT FROM OLD.public_case_id");
    expect(migration).not.toMatch(/public_case_id\s*=\s*'FVI-EXC-'[^;]*\b(id|exception_row\.id)::text/i);
  });

  it("keeps the SQL regression focused on ID generation, uniqueness, backfill and immutability", async () => {
    const test = await readFile("tests/sql/exceptions-public-case-id-regression.sql", "utf8");
    for (const assertion of [
      "public case IDs missing, duplicate, or malformed",
      "public case ID reused an internal exception UUID",
      "public case ID mutation unexpectedly succeeded",
    ]) expect(test).toContain(assertion);
    expect(test).toContain("public_case_id");
    expect(test).not.toContain("exception_case_visible");
    expect(test).not.toContain("multi_bu");
  });
});
