import { describe, it, expect } from "vitest";
import { buildCopilotTicketTools } from "@/lib/copilot-ticket-tools.server";

/**
 * Tenant-isolation + audit-attribution contract tests for ticket attachment
 * upload / download flows. We drive `attach_files_to_ticket` with a stubbed
 * Supabase client and assert:
 *
 *  1. Uploads land under `<tenant_id>/<ticket_id>/…` — the storage path the
 *     RLS policy on `storage.objects` uses to enforce tenant scope.
 *  2. Cross-tenant reads are refused (the caller's client returns `null` for
 *     the target ticket, mirroring RLS filtering).
 *  3. Every mutation appends an `audit_log` row with `resource_type =
 *     support_ticket`, `action = ticket.attach_files`, and
 *     `context.surface = "copilot"` for copilot attribution.
 *  4. Platform-scoped tickets refuse attachments (no tenant path prefix).
 */

type Row = { id: string; ref: string; tenant_id: string | null; attachments: any[] };

function makeStub(ownerRow: Row | null) {
  const audit: any[] = [];
  const storageOps: any[] = [];
  const ticketUpdates: any[] = [];
  const supa: any = {
    from(tableName: string) {
      const api: any = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        limit() { return api; },
        async maybeSingle() {
          if (tableName === "support_tickets") return { data: ownerRow, error: null };
          return { data: null, error: null };
        },
        async single() {
          if (tableName === "support_tickets") return { data: ownerRow, error: null };
          return { data: null, error: null };
        },
        async insert(row: any) {
          if (tableName === "audit_log") audit.push(row);
          return { data: null, error: null };
        },
        update(patch: any) {
          if (tableName === "support_tickets") ticketUpdates.push(patch);
          const chained: any = {
            async eq() { return { data: null, error: null }; },
            then(resolve: any) { resolve({ data: null, error: null }); },
          };
          return chained;
        },
      };
      return api;
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, buf: Buffer, opts: any) {
            storageOps.push({ op: "upload", bucket, path, size: (buf as any).length, opts });
            return { data: { path }, error: null };
          },
          async createSignedUrl(path: string, ttl: number) {
            storageOps.push({ op: "sign", bucket, path, ttl });
            return { data: { signedUrl: `https://signed.example/${path}?ttl=${ttl}` }, error: null };
          },
        };
      },
    },
  };
  return { supa, audit, storageOps, ticketUpdates };
}

const FILE = {
  name: "evidence.txt",
  content_base64: Buffer.from("hello").toString("base64"),
  content_type: "text/plain",
};

describe("ticket attachments — tenant scope + audit attribution", () => {
  it("uploads under <tenant_id>/<ticket_id>/ and appends an audit row tagged surface=copilot", async () => {
    const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const ticketA = "11111111-1111-1111-1111-111111111111";
    const { supa, audit, storageOps, ticketUpdates } = makeStub({
      id: ticketA, ref: "FVI-A1", tenant_id: tenantA, attachments: [],
    });
    const tools = buildCopilotTicketTools({
      supabase: supa, userId: "u-a", scope: "tenant", tenantId: tenantA,
      isPlatformAdmin: false, threadId: "thread-a",
    });
    const res: any = await (tools.attach_files_to_ticket as any).execute({
      ticket_id: ticketA, files: [FILE],
    });
    expect(res.status).toBe("attached");
    expect(res.count).toBe(1);
    expect(storageOps[0].bucket).toBe("ticket-attachments");
    expect(storageOps[0].path.startsWith(`${tenantA}/${ticketA}/`)).toBe(true);
    expect(ticketUpdates.length).toBe(1);
    expect(audit.length).toBe(1);
    expect(audit[0].resource_type).toBe("support_ticket");
    expect(audit[0].action).toBe("ticket.attach_files");
    expect(audit[0].context.surface).toBe("copilot");
    expect(audit[0].context.thread_id).toBe("thread-a");
    expect(audit[0].tenant_id).toBe(tenantA);
  });

  it("refuses cross-tenant attach when the caller's RLS view returns no ticket", async () => {
    // Caller belongs to tenantB but references a tenantA ticket → maybeSingle returns null.
    const { supa, audit, storageOps } = makeStub(null);
    const tools = buildCopilotTicketTools({
      supabase: supa, userId: "u-b", scope: "tenant",
      tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      isPlatformAdmin: false, threadId: "thread-b",
    });
    const res: any = await (tools.attach_files_to_ticket as any).execute({
      ticket_id: "11111111-1111-1111-1111-111111111111",
      files: [FILE],
    });
    expect(res.error).toBe("not_found_or_forbidden");
    expect(storageOps.length).toBe(0);
    expect(audit.length).toBe(0);
  });

  it("refuses attachments on platform-scope tickets (no tenant path prefix possible)", async () => {
    const { supa, storageOps, audit } = makeStub({
      id: "22222222-2222-2222-2222-222222222222",
      ref: "FVI-P1", tenant_id: null, attachments: [],
    });
    const tools = buildCopilotTicketTools({
      supabase: supa, userId: "u-plat", scope: "platform", tenantId: null,
      isPlatformAdmin: true, threadId: "thread-p",
    });
    const res: any = await (tools.attach_files_to_ticket as any).execute({
      ticket_id: "22222222-2222-2222-2222-222222222222",
      files: [FILE],
    });
    expect(res.error).toBe("platform_scope_attachments_not_supported");
    expect(storageOps.length).toBe(0);
    expect(audit.length).toBe(0);
  });

  it("rejects files exceeding the 10MB cap without writing to storage or audit", async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 0).toString("base64");
    const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const ticketA = "11111111-1111-1111-1111-111111111111";
    const { supa, storageOps, audit } = makeStub({
      id: ticketA, ref: "FVI-A2", tenant_id: tenantA, attachments: [],
    });
    const tools = buildCopilotTicketTools({
      supabase: supa, userId: "u-a", scope: "tenant", tenantId: tenantA,
      isPlatformAdmin: false, threadId: "thread-a",
    });
    const res: any = await (tools.attach_files_to_ticket as any).execute({
      ticket_id: ticketA,
      files: [{ name: "huge.bin", content_base64: big, content_type: "application/octet-stream" }],
    });
    expect(res.error).toContain("file_too_large");
    expect(storageOps.length).toBe(0);
    expect(audit.length).toBe(0);
  });
});
