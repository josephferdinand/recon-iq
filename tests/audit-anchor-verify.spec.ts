import { describe, it, expect, vi } from "vitest";
import { verifyLatestAnchor } from "@/lib/audit-anchor.functions";

type Inserted = { table: string; row: any };

function mkAdmin(anchor: unknown) {
  const inserts: Inserted[] = [];
  const admin = {
    from(table: string) {
      return {
        select: (_c: string) => ({
          order: (_col: string, _o: { ascending: boolean }) => ({
            limit: (_n: number) => ({
              maybeSingle: async () => ({ data: anchor }),
            }),
          }),
        }),
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: null };
        },
      };
    },
  };
  return { admin, inserts };
}

describe("R-1 verifyLatestAnchor", () => {
  it("returns verified:true and logs info on hash match", async () => {
    const { admin, inserts } = mkAdmin({
      id: "a1",
      last_audit_id: 100,
      row_hash_hex: "abc123",
      external_uri: "r2://fvi-audit-anchors/anchor-2026-06-30.json",
    });
    const bucket = {
      get: vi.fn(async (key: string) => {
        expect(key).toBe("anchor-2026-06-30.json");
        return { customMetadata: { rowHash: "abc123" } };
      }),
    };
    const r = await verifyLatestAnchor(admin, bucket);
    expect(r.verified).toBe(true);
    expect(typeof r.lastVerifiedAt).toBe("string");
    expect(new Date(r.lastVerifiedAt).toString()).not.toBe("Invalid Date");
    const sev = inserts.find((i) => i.table === "security_events");
    expect(sev?.row.severity).toBe("info");
    expect(sev?.row.event_type).toBe("audit.anchor.verify.ok");
  });

  it("returns verified:false and logs critical on hash mismatch", async () => {
    const { admin, inserts } = mkAdmin({
      id: "a2",
      last_audit_id: 200,
      row_hash_hex: "expected-hash",
      external_uri: "r2://fvi-audit-anchors/anchor-x.json",
    });
    const bucket = {
      get: async () => ({ customMetadata: { rowHash: "tampered-hash" } }),
    };
    const r = await verifyLatestAnchor(admin, bucket);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("hash_mismatch");
    const sev = inserts.find((i) => i.table === "security_events");
    expect(sev?.row.severity).toBe("critical");
    expect(sev?.row.event_type).toBe("audit.anchor.verify.mismatch");
    expect(sev?.row.context.db_hash).toBe("expected-hash");
    expect(sev?.row.context.r2_hash).toBe("tampered-hash");
  });

  it("returns verified:false when R2 binding is missing", async () => {
    const { admin, inserts } = mkAdmin({
      id: "a3",
      last_audit_id: 300,
      row_hash_hex: "h",
      external_uri: "r2://fvi-audit-anchors/anchor-y.json",
    });
    const r = await verifyLatestAnchor(admin, null);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("binding_missing");
    const sev = inserts.find((i) => i.table === "security_events");
    expect(sev?.row.severity).toBe("critical");
    expect(sev?.row.context.reason).toBe("binding_missing");
  });
});
