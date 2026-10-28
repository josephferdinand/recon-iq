// Regression test for the copilot call path tenant_id=null contract.
//
// Mirrors src/lib/copilot.functions.ts → sendMessage handler (~L108-145):
//   1. fetch copilot_threads row → may have tenant_id=null
//   2. call redactAndAudit(content, { supabase, tenantId: thread.tenant_id, ... })
//
// Contract: when copilot_threads.tenant_id is null, the audit row MUST land
// in security_events as event_type 'pii.redaction.unattributed', and MUST
// NOT touch ai_usage_events. A regression here would silently emit
// tenant-less rows into the usage ledger and break compliance attribution.
//
// We replay the exact handler block instead of invoking the serverFn so
// the test runs without the TanStack runtime / Supabase auth middleware,
// but the redactAndAudit call site signature is byte-identical to the
// production code path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redactAndAudit, PII_POLICY_VERSION } from "@/lib/pii-redact";

type Inserted = { table: string; row: Record<string, unknown> };

function makeSupabase(thread: { id: string; scope: string; tenant_id: string | null; user_id: string }) {
  const inserted: Inserted[] = [];
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "copilot_threads") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: thread, error: null }),
            }),
          }),
        };
      }
      return {
        insert: vi.fn(async (row: Record<string, unknown>) => {
          inserted.push({ table, row });
          return { error: null };
        }),
      };
    }),
  };
  return { supabase, inserted };
}

// Replays the redaction segment of sendMessage. Keep in sync with
// src/lib/copilot.functions.ts when that handler changes.
async function simulateCopilotSendMessage(opts: {
  supabase: any;
  userId: string;
  threadId: string;
  content: string;
}) {
  const { data: threadRow, error: tErr } = await opts.supabase
    .from("copilot_threads")
    .select("id, scope, tenant_id, user_id")
    .eq("id", opts.threadId)
    .single();
  if (tErr || !threadRow) throw new Error("Thread not found");
  const thread = threadRow as {
    id: string;
    scope: "platform" | "tenant" | "workspace";
    tenant_id: string | null;
    user_id: string;
  };
  if (thread.user_id !== opts.userId) throw new Error("Forbidden");

  return await redactAndAudit(opts.content, {
    supabase: opts.supabase,
    tenantId: thread.tenant_id,
    callerId: opts.userId,
    destination: "copilot",
  });
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { errSpy.mockRestore(); });

describe("copilot sendMessage — tenant_id=null regression", () => {
  const USER = "00000000-0000-0000-0000-000000000077";

  it("writes to security_events (pii.redaction.unattributed), NOT ai_usage_events", async () => {
    const { supabase, inserted } = makeSupabase({
      id: "11111111-1111-1111-1111-111111111111",
      scope: "platform",
      tenant_id: null,
      user_id: USER,
    });

    const safe = await simulateCopilotSendMessage({
      supabase,
      userId: USER,
      threadId: "11111111-1111-1111-1111-111111111111",
      content: "please contact alice@example.com about ssn 123-45-6789",
    });

    expect(safe).toContain("[REDACTED_EMAIL]");
    expect(safe).toContain("[REDACTED_SSN]");

    const aiRows = inserted.filter((r) => r.table === "ai_usage_events");
    const secRows = inserted.filter((r) => r.table === "security_events");

    expect(aiRows).toHaveLength(0);
    expect(secRows).toHaveLength(1);

    const row = secRows[0].row as any;
    expect(row.tenant_id).toBeNull();
    expect(row.user_id).toBe(USER);
    expect(row.event_type).toBe("pii.redaction.unattributed");
    expect(row.severity).toBe("warning");
    expect(row.context.reason).toBe("missing_tenant_id");
    expect(row.context.destination).toBe("copilot");
    expect(row.context.policy_version).toBe(PII_POLICY_VERSION);
    expect(row.context.counts.email).toBe(1);
    expect(row.context.counts.ssn_us).toBe(1);
    expect(row.context.redacted).toBe(true);
  });

  it("with a real tenant_id, writes ai_usage_events and NOT the unattributed security_events row", async () => {
    const TENANT = "22222222-2222-2222-2222-222222222222";
    const { supabase, inserted } = makeSupabase({
      id: "33333333-3333-3333-3333-333333333333",
      scope: "tenant",
      tenant_id: TENANT,
      user_id: USER,
    });

    await simulateCopilotSendMessage({
      supabase,
      userId: USER,
      threadId: "33333333-3333-3333-3333-333333333333",
      content: "ping bob@example.com",
    });

    const aiRows = inserted.filter((r) => r.table === "ai_usage_events");
    const unattributed = inserted.filter(
      (r) => r.table === "security_events" && (r.row as any).event_type === "pii.redaction.unattributed",
    );

    expect(aiRows).toHaveLength(1);
    expect(unattributed).toHaveLength(0);

    const meta = (aiRows[0].row as any).meta;
    expect(meta.event_type).toBe("pii.redaction");
    expect(meta.destination).toBe("copilot");
    expect(meta.policy_version).toBe(PII_POLICY_VERSION);
    expect((aiRows[0].row as any).tenant_id).toBe(TENANT);
  });
});
