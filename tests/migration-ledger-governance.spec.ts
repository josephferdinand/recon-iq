import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildMigrationManifest,
  compareMigrationVersions,
  parseRemoteMigrationVersions,
  summarizeVersions,
} from "../scripts/verify-migration-ledger.mjs";
import { extractSupabaseProjectRefs } from "../scripts/verify-supabase-link-state.mjs";

function migrationFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "fvi-migrations-"));
  const migrations = join(root, "migrations");
  mkdirSync(migrations);
  for (const [filename, contents] of Object.entries(files)) {
    writeFileSync(join(migrations, filename), contents);
  }
  return { migrations, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("Supabase migration ledger governance", () => {
  it("builds the current repository manifest deterministically", async () => {
    const manifest = await buildMigrationManifest(
      fileURLToPath(new URL("../supabase/migrations", import.meta.url)),
    );

    const second = await buildMigrationManifest(
      fileURLToPath(new URL("../supabase/migrations", import.meta.url)),
    );
    expect(manifest.entries.length).toBeGreaterThanOrEqual(327);
    expect(second.entries).toEqual(manifest.entries);
    expect(second.fingerprint).toBe(manifest.fingerprint);
    expect(manifest.entries[0].version).toMatch(/^\d{14}$/u);
    expect(manifest.entries.at(-1)?.version).toMatch(/^\d{14}$/u);
    expect(manifest.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  }, 60_000);

  it("rejects duplicate timestamp versions", async () => {
    const fixture = migrationFixture({
      "20260101000000_first.sql": "select 1;",
      "20260101000000_second.sql": "select 2;",
    });
    try {
      await expect(buildMigrationManifest(fixture.migrations)).rejects.toThrow(
        "Duplicate migration version",
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects invalid ledger output instead of silently ignoring it", () => {
    expect(() => parseRemoteMigrationVersions("20260101000000\n(1 row)\n")).toThrow(
      "Invalid remote migration version output",
    );
  });

  it("reports both missing and unexpected remote versions", () => {
    expect(
      compareMigrationVersions(
        ["20260101000000", "20260102000000"],
        ["20260101000000", "20260103000000"],
      ),
    ).toEqual({
      missingRemotely: ["20260102000000"],
      remoteOnly: ["20260103000000"],
    });
  });

  it("bounds version-list evidence output", () => {
    expect(summarizeVersions(["1", "2", "3"], 2)).toEqual({
      value: "1,2",
      omitted: 1,
    });
  });

  it("extracts project identities without exposing pooler credentials", () => {
    expect(
      extractSupabaseProjectRefs(
        "postgresql://postgres.abcdefghijklmnopqrst@host.pooler.supabase.com:5432/db",
      ),
    ).toEqual(["abcdefghijklmnopqrst"]);
    expect(
      extractSupabaseProjectRefs("postgresql://db.qrstabcdefghijklmnop.supabase.co/db"),
    ).toEqual(["qrstabcdefghijklmnop"]);
  });
});
