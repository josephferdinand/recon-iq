import { describe, it, expect, vi } from "vitest";
import { maybeNotifyKeyRotationDue, KEY_ROTATION_MAX_AGE_MS } from "@/lib/model-factory.server";

function mkSupabase() {
  const inserts: Array<{ table: string; row: any }> = [];
  const supabase = {
    from(table: string) {
      return {
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: null };
        },
      };
    },
  };
  return { supabase: supabase as any, inserts };
}

describe("S-7 BYOK key rotation reminder", () => {
  it("emits llm.key_rotation_due when key is older than 90 days", async () => {
    const { supabase, inserts } = mkSupabase();
    const now = new Date("2026-06-30T00:00:00Z");
    const rotated = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const r = await maybeNotifyKeyRotationDue(
      supabase,
      { id: "p1", tenant_id: "t1", provider: "muse", key_rotated_at: rotated },
      now,
    );
    expect(r.notified).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("security_events");
    expect(inserts[0].row.event_type).toBe("llm.key_rotation_due");
    expect(inserts[0].row.severity).toBe("info");
    expect(inserts[0].row.tenant_id).toBe("t1");
    expect(inserts[0].row.context.age_days).toBeGreaterThanOrEqual(90);
  });

  it("does NOT notify when key is younger than 90 days", async () => {
    const { supabase, inserts } = mkSupabase();
    const now = new Date("2026-06-30T00:00:00Z");
    const rotated = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const r = await maybeNotifyKeyRotationDue(
      supabase,
      { id: "p1", tenant_id: "t1", provider: "muse", key_rotated_at: rotated },
      now,
    );
    expect(r.notified).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("skips when key_rotated_at is null", async () => {
    const { supabase, inserts } = mkSupabase();
    const r = await maybeNotifyKeyRotationDue(supabase, {
      provider: "muse",
      key_rotated_at: null,
    });
    expect(r.notified).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("swallows DB write errors (best-effort, must not block Copilot)", async () => {
    const supabase = {
      from: () => ({
        insert: async () => {
          throw new Error("db down");
        },
      }),
    } as any;
    const now = new Date("2026-06-30T00:00:00Z");
    const rotated = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const r = await maybeNotifyKeyRotationDue(
      supabase,
      { provider: "muse", key_rotated_at: rotated },
      now,
    );
    expect(r.notified).toBe(true);
  });

  it("constant is 90 days exactly", () => {
    expect(KEY_ROTATION_MAX_AGE_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});
