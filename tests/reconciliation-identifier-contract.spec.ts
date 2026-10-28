import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260914110000_add_reconciliation_identifiers.sql",
  "utf8",
);

describe("reconciliation business identifiers", () => {
  it("uses a tenant and department scoped transaction lock for collision safety", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain(
      "NEW.tenant_id::text || ':' || department_code || ':' || process_code",
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS recon_definitions_tenant_recon_code_uidx",
    );
  });

  it("enforces the approved format and immutability", () => {
    expect(migration).toContain("^FVI-[A-Z0-9]{2,12}-(1WAY|2WAY|3WAY)-[0-9]{6,}$");
    expect(migration).toContain("reconciliation identifier is immutable");
    expect(migration).toContain("reconciliation tenant is immutable");
  });

  it("keeps identifiers visible and portable across governed packages", () => {
    const list = readFileSync("src/lib/recons.functions.ts", "utf8");
    const ui = readFileSync("src/components/recon-studio-index.tsx", "utf8");
    const pack = readFileSync("src/lib/environment-package.server.ts", "utf8");
    const incoming = readFileSync("scripts/execute-fvi-incoming-environment-package.mjs", "utf8");
    expect(list).toContain("id, recon_code, name");
    expect(ui).toContain("public_id: row.recon_code");
    expect(ui).toContain("publicIdFallback={row.recon_code}");
    expect(pack).toContain("id,recon_code,name");
    expect(incoming).toContain("id,tenant_id,recon_code,name");
  });
});
