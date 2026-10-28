import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PLATFORM_SERVER_MODULES = [
  "platform-ai.functions.ts",
  "platform-consoles.functions.ts",
  "platform-gap-batch2.functions.ts",
  "platform-gap.functions.ts",
  "platform-gaps.functions.ts",
  "platform-groups.functions.ts",
  "platform-role-requests.functions.ts",
  "platform-secret-status.functions.ts",
  "platform.functions.ts",
] as const;

describe("Platform administration guard consolidation", () => {
  it.each(PLATFORM_SERVER_MODULES)("routes %s through the governed guard", (file) => {
    const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");

    expect(source).toContain('from "@/lib/rbac-guards.server"');
    expect(source).toContain("requirePlatformAdmin(");
    expect(source).not.toContain('.rpc("is_platform_admin"');
    expect(source).not.toContain('.rpc("has_platform_role"');
  });

  it("guards the Platform AI settings read before querying configuration", () => {
    const source = readFileSync(
      new URL("../src/lib/platform-ai.functions.ts", import.meta.url),
      "utf8",
    );
    const handler = source.slice(
      source.indexOf("export const getPlatformAiSettings"),
      source.indexOf("const PlatSchema"),
    );

    expect(handler.indexOf("await assertPlatformAdmin(context)")).toBeGreaterThan(-1);
    expect(handler.indexOf("await assertPlatformAdmin(context)")).toBeLessThan(
      handler.indexOf('.from("platform_ai_settings")'),
    );
  });
});
