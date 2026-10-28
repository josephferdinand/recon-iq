// S-7 — BYOK key rotation reminder.
// Matches the spec from Batch 3/4 final review: two providers (91d old, 1d old),
// asserts a security_events row is written for the stale key and NOT for the fresh
// one. Uses the real `maybeNotifyKeyRotationDue` exported from model-factory.server,
// aliased here as `checkKeyRotation` for spec parity.
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  // Spec: set APP_DATA_ENC_KEY to a fixed test value before importing the module.
  process.env.APP_DATA_ENC_KEY ??= "00000000000000000000000000000000";
});

import { maybeNotifyKeyRotationDue as checkKeyRotation } from "@/lib/model-factory.server";

function mkSupabase() {
  const inserts: Array<{ table: string; row: any }> = [];
  return {
    inserts,
    supabase: {
      from(table: string) {
        return {
          insert: async (row: unknown) => {
            inserts.push({ table, row });
            return { error: null };
          },
        };
      },
    } as any,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-30T00:00:00Z");

const stale = {
  id: "prov-stale",
  tenant_id: "tenant-A",
  provider: "muse",
  key_rotated_at: new Date(NOW.getTime() - 91 * DAY_MS).toISOString(),
};

const fresh = {
  id: "prov-fresh",
  tenant_id: "tenant-B",
  provider: "muse",
  key_rotated_at: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
};

describe("S-7 key rotation", () => {
  it("writes security_events { event_type: 'llm.key_rotation_due', severity: 'info' } when key is 91 days old", async () => {
    const { supabase, inserts } = mkSupabase();
    const r = await checkKeyRotation(supabase, stale, NOW);

    expect(r.notified).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("security_events");
    expect(inserts[0].row.event_type).toBe("llm.key_rotation_due");
    expect(inserts[0].row.severity).toBe("info");
    expect(inserts[0].row.tenant_id).toBe("tenant-A");
    expect(inserts[0].row.context.provider_id).toBe("prov-stale");
    expect(inserts[0].row.context.age_days).toBeGreaterThanOrEqual(90);
  });

  it("writes NO event when key is 1 day old", async () => {
    const { supabase, inserts } = mkSupabase();
    const r = await checkKeyRotation(supabase, fresh, NOW);

    expect(r.notified).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("two-row scenario: only the 91-day row triggers; the 1-day row stays quiet", async () => {
    const { supabase, inserts } = mkSupabase();
    await checkKeyRotation(supabase, stale, NOW);
    await checkKeyRotation(supabase, fresh, NOW);

    const events = inserts.filter((i) => i.table === "security_events");
    expect(events).toHaveLength(1);
    expect(events[0].row.event_type).toBe("llm.key_rotation_due");
    expect(events[0].row.tenant_id).toBe("tenant-A");
  });
});
