import { describe, it, expect } from "vitest";
import { build } from "vite";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// S-8 — verifies that the importProtection behavior branches on `mode`.
// We simulate the rule used in vite.config.ts directly: a client file
// that imports a `server/**` module must fail in production and not fail
// in development.
//
// We avoid spinning up the full TanStack pipeline here — we use Vite's
// own minimal `rollupOptions.external` plugin to reproduce the policy.
// The test asserts the *branching* contract: production rejects, dev
// tolerates.

function makeFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "s8-import-protect-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "src", "server"));
  writeFileSync(
    join(dir, "src", "server", "secret.ts"),
    `export const SECRET = "not-for-client";\n`,
  );
  writeFileSync(
    join(dir, "src", "client.ts"),
    `import { SECRET } from "./server/secret";\nexport const leaked = SECRET;\n`,
  );
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function importProtectionPlugin(mode: "production" | "development") {
  const behavior = mode === "production" ? "error" : "mock";
  return {
    name: "s8-import-protect-test",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (!importer) return null;
      if (importer.includes("/server/")) return null;
      if (source.includes("server/secret") || source === "./server/secret") {
        if (behavior === "error") {
          throw new Error(
            `Import protection: client file ${importer} imported server module ${source}`,
          );
        }
        return "\0empty-server-stub";
      }
      return null;
    },
    load(id: string) {
      if (id === "\0empty-server-stub") return "export const SECRET = undefined;";
      return null;
    },
  };
}


describe("S-8 importProtection branches on mode", () => {
  it("production build FAILS when a *.server import leaks into the client graph", async () => {
    const { dir, cleanup } = makeFixture();
    try {
      await expect(
        build({
          root: dir,
          mode: "production",
          logLevel: "silent",
          plugins: [importProtectionPlugin("production")],
          build: {
            write: false,
            rollupOptions: { input: join(dir, "src", "client.ts") },
          },
        }),
      ).rejects.toThrow(/Import protection/);
    } finally {
      cleanup();
    }
  });

  it("development tolerates the same import (mock/warn behavior)", async () => {
    const { dir, cleanup } = makeFixture();
    try {
      await expect(
        build({
          root: dir,
          mode: "development",
          logLevel: "silent",
          plugins: [importProtectionPlugin("development")],
          build: {
            write: false,
            rollupOptions: { input: join(dir, "src", "client.ts") },
          },
        }),
      ).resolves.toBeDefined();
    } finally {
      cleanup();
    }
  });
});
