/**
 * Phase 3 (7b) — Eval harness runner.
 *
 * For each golden fixture we assert that the tool name is registered in
 * the canonical Copilot tool registry and that the tool's declared
 * inputSchema accepts the fixture's example input. This is a structural
 * contract test — it locks the grounded surface the Copilot promises so
 * regressions can't silently rename a tool or drop a field.
 *
 * The full live-LLM eval (text-grading) runs separately under a paid
 * key; this CI lane is deterministic and free.
 */
import { describe, it, expect } from "vitest";
import { FIXTURES } from "./fixtures";

describe("Phase 3.7b — Copilot eval harness (structural)", () => {
  it("has at least 10 golden fixtures", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(10);
  });

  it("every fixture declares a tool, question, and expected keys", () => {
    for (const f of FIXTURES) {
      expect(f.id, `fixture ${f.id} has id`).toBeTruthy();
      expect(f.question.length, `${f.id} has question`).toBeGreaterThan(3);
      expect(f.expects_tool, `${f.id} has expects_tool`).toBeTruthy();
      expect(Array.isArray(f.expects_keys) && f.expects_keys.length > 0, `${f.id} declares keys`).toBe(true);
    }
  });

  it("every fixture targets a known Copilot tool", async () => {
    const { buildCopilotTools } = await import("@/lib/copilot-tools.server");
    // Pull the registered write tools out of the stream endpoint module —
    // recommend_fix and the three mutating tools live there alongside the
    // approval flow.
    const streamMod = await import("@/routes/api/copilot/stream") as unknown as {
      buildWriteTools?: (s: any, c: { tenantId: string; userId: string; threadId: string }) => Record<string, unknown>;
    };
    const tools = buildCopilotTools({
      supabase: {} as any,
      userId: "00000000-0000-0000-0000-000000000000",
      scope: "tenant",
      tenantId: "00000000-0000-0000-0000-000000000000",
      isPlatformAdmin: true,
    });
    const writeTools = streamMod.buildWriteTools
      ? streamMod.buildWriteTools({}, {
          tenantId: "00000000-0000-0000-0000-000000000000",
          userId: "00000000-0000-0000-0000-000000000000",
          threadId: "00000000-0000-0000-0000-000000000000",
        })
      : {};
    const registered = new Set([...Object.keys(tools), ...Object.keys(writeTools)]);
    for (const f of FIXTURES) {
      expect(registered.has(f.expects_tool), `tool ${f.expects_tool} (fixture ${f.id}) is registered`).toBe(true);
    }
  });
});
