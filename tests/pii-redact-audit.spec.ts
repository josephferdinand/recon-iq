// B3 — PII redaction audit logging
// Verifies redactAndAudit emits structured ai_usage_events rows and that
// redactStrict never throws.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redactAndAudit, redactStrict, PII_POLICY_VERSION } from "@/lib/pii-redact";

type InsertRow = Record<string, unknown>;

function makeSupabase(opts: { throwOnInsert?: boolean } = {}) {
  const rows: { table: string; row: InsertRow }[] = [];
  const supabase = {
    from(table: string) {
      return {
        insert: vi.fn(async (row: InsertRow) => {
          if (opts.throwOnInsert) throw new Error("db down");
          rows.push({ table, row });
          return { error: null };
        }),
      };
    },
  };
  return { supabase, rows };
}

const CTX = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  callerId: "00000000-0000-0000-0000-000000000002",
  destination: "copilot" as const,
};

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { errSpy.mockRestore(); });

describe("redactAndAudit", () => {
  it("with no PII writes one row with empty counts and redacted=false", async () => {
    const { supabase, rows } = makeSupabase();
    const out = await redactAndAudit("hello world, nothing sensitive here", { supabase, ...CTX });
    expect(out).toBe("hello world, nothing sensitive here");
    expect(rows).toHaveLength(1);
    expect(rows[0].table).toBe("ai_usage_events");
    const meta = (rows[0].row as any).meta;
    expect(meta.event_type).toBe("pii.redaction");
    expect(meta.counts).toEqual({});
    expect(meta.redacted).toBe(false);
    expect(meta.destination).toBe("copilot");
    expect(meta.policy_version).toBe(PII_POLICY_VERSION);
    expect(typeof meta.input_hash).toBe("string");
    expect(meta.input_hash).toHaveLength(64);
  });

  it("with email PII writes one row with counts={ email: 1 } and redacted=true", async () => {
    const { supabase, rows } = makeSupabase();
    const out = await redactAndAudit("contact alice@example.com please", { supabase, ...CTX });
    expect(out).toContain("[REDACTED_EMAIL]");
    expect(rows).toHaveLength(1);
    const meta = (rows[0].row as any).meta;
    expect(meta.counts).toEqual({ email: 1 });
    expect(meta.redacted).toBe(true);
  });

  it("with multiple PII types writes one row with the full counts map", async () => {
    const { supabase, rows } = makeSupabase();
    const input = "email alice@example.com, ssn 123-45-6789, ip 10.0.0.1, two emails bob@x.io";
    await redactAndAudit(input, { supabase, ...CTX, destination: "agent" });
    const meta = (rows[0].row as any).meta;
    expect(meta.counts.email).toBe(2);
    expect(meta.counts.ssn_us).toBe(1);
    expect(meta.counts.ipv4).toBe(1);
    expect(meta.destination).toBe("agent");
    expect(meta.redacted).toBe(true);
  });

  it("with audit write failure still returns the redacted text and does not throw", async () => {
    const { supabase } = makeSupabase({ throwOnInsert: true });
    const out = await redactAndAudit("call bob@example.com", { supabase, ...CTX });
    expect(out).toContain("[REDACTED_EMAIL]");
    expect(errSpy).toHaveBeenCalled();
  });

  it("with tenantId=null writes pii.redaction.unattributed security_events row, not ai_usage_events", async () => {
    const { supabase, rows } = makeSupabase();
    const out = await redactAndAudit("contact alice@example.com please", {
      supabase,
      tenantId: null,
      callerId: CTX.callerId,
      destination: "copilot",
    });
    expect(out).toContain("[REDACTED_EMAIL]");
    expect(rows).toHaveLength(1);
    expect(rows[0].table).toBe("security_events");
    expect(rows.find((r) => r.table === "ai_usage_events")).toBeUndefined();
    const row = rows[0].row as any;
    expect(row.tenant_id).toBeNull();
    expect(row.event_type).toBe("pii.redaction.unattributed");
    expect(row.severity).toBe("warning");
    expect(row.context.reason).toBe("missing_tenant_id");
    expect(row.context.counts).toEqual({ email: 1 });
    expect(row.context.redacted).toBe(true);
    expect(row.context.policy_version).toBe(PII_POLICY_VERSION);
    expect(row.context.destination).toBe("copilot");
  });
});

describe("redactStrict", () => {
  it("with PII returns hadRedactions=true", () => {
    const r = redactStrict("ping alice@example.com");
    expect(r.hadRedactions).toBe(true);
    expect(r.redacted).toBe(true);
    expect(r.counts.email).toBe(1);
    expect(r.text).toContain("[REDACTED_EMAIL]");
  });

  it("with non-string input returns the failure sentinel and does not throw", () => {
    // Simulates a regex/runtime failure — non-string input is the cleanest
    // way to reach the failure branch deterministically.
    const r = redactStrict(undefined as unknown as string);
    expect(r.text).toBe("[REDACTION_FAILED]");
    expect(r.hadRedactions).toBe(false);
    expect(r.redacted).toBe(false);
    expect(r.counts).toEqual({});
  });
});
