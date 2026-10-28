// C2 — Backup verify cron smoke tests.
//
// Stubs the R2 binding + supabaseAdmin so the handler logic is covered
// without a live Cloudflare or Supabase environment.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";

type R2Object = { text(): Promise<string> } | null;
type R2Stub = {
  store: Map<string, string>;
  get: (k: string) => Promise<R2Object>;
  put: (k: string, v: string) => Promise<void>;
};

function makeR2(): R2Stub {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => (store.has(k) ? { text: async () => store.get(k)! } : null),
    put: async (k, v) => {
      store.set(k, String(v));
    },
  };
}

const DDL = "create table public.tenants (id uuid primary key);";
const SHA = createHash("sha256").update(DDL).digest("hex");

let inserted: Array<{ event_type: string; severity: string }> = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async () => ({ data: DDL, error: null }),
    from: () => ({
      insert: async (rows: any) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        inserted.push(...arr);
        return { error: null };
      },
    }),
  },
}));

let r2: R2Stub = makeR2();
vi.mock("@/lib/r2-bindings.server", () => ({
  getR2Binding: () => r2,
}));

describe("backup-verify", () => {
  beforeEach(() => {
    inserted = [];
    r2 = makeR2();
  });

  it("happy path: uploads dump + sha and writes verified event", async () => {
    const { runBackupVerify } = await import("@/routes/api/public/cron/backup-verify");
    const out = await runBackupVerify();
    expect(out.outcome).toBe("uploaded");
    expect(out.sha256).toBe(SHA);
    expect(r2.store.size).toBe(2); // .sql + .sha256
    expect(inserted.some((e) => e.event_type === "backup.schema_verified")).toBe(true);
  });

  it("matching hash on second run: no-op verified", async () => {
    const { runBackupVerify } = await import("@/routes/api/public/cron/backup-verify");
    const date = new Date().toISOString().slice(0, 10);
    r2.store.set(`schema-${date}.sha256`, SHA);
    const out = await runBackupVerify();
    expect(out.outcome).toBe("verified");
    expect(inserted.some((e) => e.event_type === "backup.schema_verified")).toBe(true);
  });

  it("mismatched hash: writes critical security_events row", async () => {
    const { runBackupVerify } = await import("@/routes/api/public/cron/backup-verify");
    const date = new Date().toISOString().slice(0, 10);
    r2.store.set(`schema-${date}.sha256`, "deadbeef");
    const out = await runBackupVerify();
    expect(out.outcome).toBe("mismatch");
    const ev = inserted.find((e) => e.event_type === "backup.schema_mismatch");
    expect(ev?.severity).toBe("critical");
  });
});
