// C5 — Stripe webhook idempotency unit tests.
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

describe("stripe webhook idempotency", () => {
  function handler({ insert, processed }: { insert: any; processed: any }) {
    return async (event: any) => {
      const payload_hash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
      const res = await insert({ event_id: event.id, event_type: event.type, livemode: !!event.livemode, payload: event, payload_hash });
      if (res?.error?.code === "23505") return { duplicate: true };
      if (res?.error) throw res.error;
      await processed(event.id);
      return { duplicate: false };
    };
  }

  it("fresh event proceeds and writes payload_hash", async () => {
    const inserts: any[] = []; const processed: string[] = [];
    const h = handler({
      insert: async (row: any) => { inserts.push(row); return { error: null }; },
      processed: async (id: string) => { processed.push(id); },
    });
    const r = await h({ id: "evt_1", type: "x", livemode: false });
    expect(r.duplicate).toBe(false);
    expect(inserts[0].payload_hash).toHaveLength(64);
    expect(processed).toEqual(["evt_1"]);
  });

  it("replayed event short-circuits with duplicate=true (no side effects)", async () => {
    const processed: string[] = [];
    const h = handler({
      insert: async () => ({ error: { code: "23505", message: "dup" } }),
      processed: async (id: string) => { processed.push(id); },
    });
    const r = await h({ id: "evt_2", type: "x" });
    expect(r.duplicate).toBe(true);
    expect(processed).toEqual([]);
  });

  it("malformed event (insert throws non-unique error) propagates", async () => {
    const h = handler({
      insert: async () => ({ error: { code: "22P02", message: "bad" } }),
      processed: async () => {},
    });
    await expect(h({ id: "evt_3" })).rejects.toMatchObject({ code: "22P02" });
  });
});
