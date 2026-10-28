import { describe, it, expect } from "vitest";
import { buildCopilotTicketTools } from "@/lib/copilot-ticket-tools.server";

/**
 * Access-boundary contract tests for Copilot ticket tools.
 * We validate the tool implementations directly (no live DB) by feeding a
 * stubbed Supabase client and asserting cross-tenant/scope refusals and
 * that every mutation writes an audit row with `surface: "copilot"`.
 */

function makeSupabaseStub() {
  const audit: any[] = [];
  const inserted: any[] = [];
  const updated: any[] = [];
  const chain = (tableName: string) => {
    const state: any = { table: tableName, filters: {}, _select: null };
    const api: any = {
      select: (_: string) => api,
      eq: (_c: string, _v: any) => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: "00000000-0000-0000-0000-000000000000", ref: "FVI-STUB" }, error: null }),
      insert: async (row: any) => {
        if (tableName === "audit_log") audit.push(row);
        else inserted.push({ table: tableName, row });
        return { data: { id: "row" }, error: null };
      },
      update: async (patch: any) => {
        updated.push({ table: tableName, patch });
        return { data: null, error: null };
      },
    };
    return api;
  };
  const supa: any = { from: (t: string) => chain(t) };
  return { supa, audit, inserted, updated };
}

describe("copilot ticket tools — access boundaries", () => {
  it("refuses cross-tenant create for non-platform users", async () => {
    const { supa } = makeSupabaseStub();
    const tools = buildCopilotTicketTools({
      supabase: supa,
      userId: "u1",
      scope: "tenant",
      tenantId: "11111111-1111-1111-1111-111111111111",
      isPlatformAdmin: false,
      threadId: "22222222-2222-2222-2222-222222222222",
    });
    const res: any = await (tools.create_support_ticket as any).execute({
      subject: "Cross-tenant attempt",
      body: "should be blocked",
      category: "general_question",
      priority: "normal",
      scope: "tenant",
      tenant_id: "99999999-9999-9999-9999-999999999999",
      include_conversation: false,
    });
    expect(res.error).toBe("cross_tenant_forbidden");
  });

  it("refuses platform-scope create for non-platform admin", async () => {
    const { supa } = makeSupabaseStub();
    const tools = buildCopilotTicketTools({
      supabase: supa,
      userId: "u1",
      scope: "tenant",
      tenantId: "11111111-1111-1111-1111-111111111111",
      isPlatformAdmin: false,
      threadId: "22222222-2222-2222-2222-222222222222",
    });
    const res: any = await (tools.create_support_ticket as any).execute({
      subject: "Platform ticket",
      body: "should be blocked",
      category: "general_question",
      priority: "normal",
      scope: "platform",
      include_conversation: false,
    });
    expect(res.error).toBe("platform_admin_required");
  });

  it("escalate tool writes an audit row tagged surface=copilot", async () => {
    const { supa, audit, inserted, updated } = makeSupabaseStub();
    // Provide a maybeSingle result for the update returning a row.
    supa.from = (t: string) => {
      const api: any = {
        select: () => api,
        eq: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: async () => ({
          data: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", ref: "FVI-ABC", tenant_id: "t1" },
          error: null,
        }),
        insert: async (row: any) => {
          if (t === "audit_log") audit.push(row);
          else inserted.push({ table: t, row });
          return { data: null, error: null };
        },
        update: (patch: any) => {
          updated.push({ table: t, patch });
          return api;
        },
      };
      return api;
    };
    const tools = buildCopilotTicketTools({
      supabase: supa,
      userId: "u1",
      scope: "tenant",
      tenantId: "t1",
      isPlatformAdmin: false,
      threadId: "thread-1",
    });
    const res: any = await (tools.escalate_support_ticket as any).execute({
      ticket_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      reason: "Customer waiting > 24h",
    });
    expect(res.status).toBe("escalated");
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe("ticket.escalate");
    expect(audit[0].context.surface).toBe("copilot");
    expect(audit[0].context.thread_id).toBe("thread-1");
  });
});
