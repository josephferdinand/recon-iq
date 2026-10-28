// B2 — Audit Anchor R2 PUT
// Verifies the R2 publish helper and the verify cron handler.
import { describe, it, expect, vi } from "vitest";
import { publishAnchorToR2, verifyLatestAnchor } from "@/lib/audit-anchor.functions";

type Event = { event_type: string; severity: string; context: Record<string, unknown> };

function makeAdmin(anchor?: Record<string, unknown> | null) {
  const events: Event[] = [];
  const admin = {
    from(table: string) {
      return {
        insert: async (row: Event) => {
          if (table === "security_events") events.push(row);
          return { error: null };
        },
        select: (_c: string) => ({
          order: (_col: string, _opts: { ascending: boolean }) => ({
            limit: (_n: number) => ({
              maybeSingle: async () => ({ data: anchor ?? null }),
            }),
          }),
        }),
      };
    },
  };
  return { admin, events };
}

function makeBucket(opts: { putThrows?: boolean; getReturns?: { customMetadata?: Record<string, string> } | null } = {}) {
  return {
    put: vi.fn(async () => {
      if (opts.putThrows) throw new Error("R2 unavailable");
      return { key: "k", etag: "e" };
    }),
    get: vi.fn(async () => (opts.getReturns === undefined ? null : opts.getReturns)),
  };
}

const PAYLOAD = { last_audit_id: 42, row_hash_hex: "deadbeef" };
const NOW = new Date("2026-06-28T03:00:00Z");
const KEY = "anchor-2026-06-28.json";

describe("publishAnchorToR2", () => {
  it("successful DB insert + R2 PUT writes r2_published event", async () => {
    const { admin, events } = makeAdmin();
    const bucket = makeBucket();
    const out = await publishAnchorToR2(admin, PAYLOAD, bucket, NOW);
    expect(out.status).toBe("published");
    expect(bucket.put).toHaveBeenCalledWith(
      KEY,
      expect.stringContaining('"row_hash_hex":"deadbeef"'),
      expect.objectContaining({ customMetadata: { rowHash: "deadbeef" } }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("audit.anchor.r2_published");
    expect(events[0].severity).toBe("info");
  });

  it("failed R2 PUT writes critical r2_failed event and does NOT throw", async () => {
    const { admin, events } = makeAdmin();
    const bucket = makeBucket({ putThrows: true });
    const out = await publishAnchorToR2(admin, PAYLOAD, bucket, NOW);
    expect(out.status).toBe("failed");
    expect(out.error).toBe("R2 unavailable");
    expect(events[0]).toMatchObject({
      event_type: "audit.anchor.r2_failed",
      severity: "critical",
    });
  });

  it("missing AUDIT_ANCHORS binding writes r2_binding_missing and does NOT throw", async () => {
    const { admin, events } = makeAdmin();
    const out = await publishAnchorToR2(admin, PAYLOAD, null, NOW);
    expect(out.status).toBe("binding_missing");
    expect(events[0]).toMatchObject({
      event_type: "audit.anchor.r2_binding_missing",
      severity: "critical",
    });
  });
});

describe("verifyLatestAnchor cron", () => {
  const anchor = {
    id: "a1",
    last_audit_id: 42,
    row_hash_hex: "deadbeef",
    external_uri: "r2://fvi-audit-anchors/anchor-2026-06-28.json",
  };

  it("matching hash returns ok=true and writes verify.ok event", async () => {
    const { admin, events } = makeAdmin(anchor);
    const bucket = makeBucket({ getReturns: { customMetadata: { rowHash: "deadbeef" } } });
    const res = await verifyLatestAnchor(admin, bucket);
    expect(res.verified).toBe(true);
    expect(events[0]).toMatchObject({ event_type: "audit.anchor.verify.ok", severity: "info" });
  });

  it("mismatched hash returns ok=false with critical event", async () => {
    const { admin, events } = makeAdmin(anchor);
    const bucket = makeBucket({ getReturns: { customMetadata: { rowHash: "cafef00d" } } });
    const res = await verifyLatestAnchor(admin, bucket);
    expect(res.verified).toBe(false);
    expect(res.reason).toBe("hash_mismatch");
    expect(events[0]).toMatchObject({
      event_type: "audit.anchor.verify.mismatch",
      severity: "critical",
    });
    expect(events[0].context).toMatchObject({ db_hash: "deadbeef", r2_hash: "cafef00d" });
  });

  it("missing R2 object returns ok=false with critical event", async () => {
    const { admin, events } = makeAdmin(anchor);
    const bucket = makeBucket({ getReturns: null });
    const res = await verifyLatestAnchor(admin, bucket);
    expect(res.verified).toBe(false);
    expect(res.reason).toBe("missing_object");
    expect(events[0]).toMatchObject({
      event_type: "audit.anchor.verify.mismatch",
      severity: "critical",
    });
  });
});
