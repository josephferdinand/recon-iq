import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("protected Pages build environment selection", () => {
  it.each([
    ["PROD", "scripts/build-fvi-production-from-protected-files.mjs", "runtimeDevRefFiles"],
    ["DEV", "scripts/build-fvi-development-from-protected-files.mjs", "runtimeProdRefFiles"],
  ])(
    "makes %s identity override inherited shell state and rejects the opposite runtime",
    async (_name, file, oppositeCounter) => {
      const source = await readFile(file, "utf8");
      expect(source).toContain("env: { ...process.env, ...selectedEnvironment }");
      expect(source).toContain("SUPABASE_PROJECT_REF:");
      expect(source).toContain("SUPABASE_PROJECT_ID:");
      expect(source).toContain("VITE_SUPABASE_PROJECT_ID:");
      expect(source).toContain("VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey");
      expect(source).toContain(`${oppositeCounter} !== 0`);
      expect(source).toMatch(
        /!(?:path\.basename\(relative\)|base|basename)\.startsWith\("OWNER_SESSION_TEST_PLAN-"\)/u,
      );
      if (_name === "DEV") {
        expect(source).toContain("/^58_reference_data_local_assurance-[A-Za-z0-9_-]+\\.js$/u");
        expect(source).toContain("/^rate-limit-server-threat-model-[A-Za-z0-9_-]+\\.js$/u");
        expect(source).toContain("allowedOppositeReferenceDocs.some((pattern) => pattern.test(basename))");
        expect(source).not.toContain("basename.startsWith(prefix)");
      } else {
        expect(source).toContain("/^FVI_DEV_JWT_FUTURE_INCIDENT_2026-09-23-[A-Za-z0-9_-]+\\.js$/u");
        expect(source).toContain("allowedOppositeReferenceDocs.some((pattern) => pattern.test(base))");
        expect(source).not.toContain('base.includes("RETURN")');
      }
    },
  );
});
