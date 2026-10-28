import { describe, expect, it, vi } from "vitest";

import {
  listMigrationLedgerWithCli,
  parseSupabaseMigrationListOutput,
} from "../scripts/export-supabase-migration-ledger.mjs";

describe("official Supabase CLI migration ledger export", () => {
  it("parses and sorts local and remote migration versions", () => {
    expect(
      parseSupabaseMigrationListOutput(`
        Local          | Remote         | Time (UTC)
        ----------------|----------------|---------------------
        20260802000000 | 20260802000000 | 2026-08-02 00:00:00
        20260801000000 |                | 2026-08-01 00:00:00
      `),
    ).toEqual({
      localVersions: ["20260801000000", "20260802000000"],
      remoteVersions: ["20260802000000"],
    });
  });

  it("rejects malformed or duplicate versions", () => {
    expect(() =>
      parseSupabaseMigrationListOutput("Local | Remote\nbad | 20260801000000"),
    ).toThrow("invalid local migration version");
    expect(() =>
      parseSupabaseMigrationListOutput(
        "Local | Remote\n20260801000000 | 20260801000000\n20260801000000 | 20260801000000",
      ),
    ).toThrow("duplicate migration versions");
  });

  it("refuses a linked project that differs from the expected environment", async () => {
    await expect(
      listMigrationLedgerWithCli({
        projectRef: "YOUR_PROJECT_REF",
        linkedProjectRef: "YOUR_PROJECT_REF",
        accessToken: "secret-token",
        projectRoot: process.cwd(),
        execImpl: vi.fn(),
      }),
    ).rejects.toThrow("linked-project identity");
  });

  it("passes the token only through the child environment", async () => {
    const execImpl = vi.fn(async () => ({
      stdout:
        "Local | Remote | Time (UTC)\n20260801000000 | 20260801000000 | 2026-08-01 00:00:00",
      stderr: "Connecting to remote database...",
    }));

    await expect(
      listMigrationLedgerWithCli({
        projectRef: "YOUR_PROJECT_REF",
        linkedProjectRef: "YOUR_PROJECT_REF",
        accessToken: "secret-token",
        projectRoot: process.cwd(),
        execImpl,
      }),
    ).resolves.toEqual({
      localVersions: ["20260801000000"],
      remoteVersions: ["20260801000000"],
    });

    const [, args, options] = execImpl.mock.calls[0];
    expect(args).not.toContain("secret-token");
    expect(options.env.SUPABASE_ACCESS_TOKEN).toBe("secret-token");
  });

  it("rejects output that does not contain the migration table", () => {
    expect(() => parseSupabaseMigrationListOutput("Connecting to remote database...\n")).toThrow(
      "header was not found",
    );
  });
});
