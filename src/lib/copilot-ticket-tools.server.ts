/**
 * Copilot ticket tools — server-only.
 *
 * Adds fully audited support-ticket capabilities to Copilot Chat:
 *   - create_support_ticket
 *   - list_support_tickets
 *   - get_support_ticket (incl. SLA status)
 *   - add_ticket_comment
 *   - escalate_support_ticket
 *   - check_ticket_sla_status
 *
 * All reads run through the caller's Supabase client, so RLS + tenant
 * isolation are enforced automatically. Writes additionally validate scope
 * (tenant vs platform) and append a structured audit_log entry.
 *
 * Ticket-body (customer text) is encrypted at rest via crypto.server, matching
 * the pattern used in `src/lib/tickets.functions.ts`.
 */
import { z } from "zod";
import { tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TICKET_CATEGORIES } from "@/lib/tickets.functions";

export type CopilotTicketCtx = {
  supabase: SupabaseClient;
  userId: string;
  scope: "platform" | "tenant" | "workspace";
  tenantId: string | null;
  isPlatformAdmin: boolean;
  threadId: string;
};

const priorityEnum = z.enum(["low", "normal", "high", "urgent"]);
const categoryEnum = z.enum(TICKET_CATEGORIES);
const statusEnum = z.enum(["open", "in_progress", "waiting_customer", "resolved", "closed"]);

async function writeAudit(
  ctx: CopilotTicketCtx,
  action: string,
  resourceId: string,
  tenantId: string | null,
  extra: Record<string, unknown>,
) {
  try {
    await ctx.supabase.from("audit_log").insert({
      actor_user_id: ctx.userId,
      tenant_id: tenantId,
      scope: tenantId ? "tenant" : "platform",
      action,
      resource_type: "support_ticket",
      resource_id: resourceId,
      context: { ...extra, surface: "copilot", thread_id: ctx.threadId },
    } as any);
  } catch {
    /* audit best-effort; ticket op already succeeded */
  }
}

function slaState(row: any): {
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_status: "met" | "pending" | "breached" | "n/a";
  resolution_status: "met" | "pending" | "breached" | "n/a";
  minutes_to_resolution_due: number | null;
} {
  const sla = row.sla_policies ?? row.sla ?? null;
  if (!sla) {
    return {
      first_response_due_at: null,
      resolution_due_at: null,
      first_response_status: "n/a",
      resolution_status: "n/a",
      minutes_to_resolution_due: null,
    };
  }
  const created = new Date(row.created_at).getTime();
  const frDue = new Date(created + sla.first_response_mins * 60_000);
  const rDue = new Date(created + sla.resolution_mins * 60_000);
  const now = Date.now();
  const frStatus: "met" | "pending" | "breached" = row.first_response_at
    ? "met"
    : now > frDue.getTime()
    ? "breached"
    : "pending";
  const rStatus: "met" | "pending" | "breached" =
    row.resolved_at || row.closed_at
      ? "met"
      : now > rDue.getTime()
      ? "breached"
      : "pending";
  return {
    first_response_due_at: frDue.toISOString(),
    resolution_due_at: rDue.toISOString(),
    first_response_status: frStatus,
    resolution_status: rStatus,
    minutes_to_resolution_due: Math.round((rDue.getTime() - now) / 60_000),
  };
}

export function buildCopilotTicketTools(ctx: CopilotTicketCtx) {
  const supa = ctx.supabase;

  return {
    create_support_ticket: tool({
      description:
        "Create a new support ticket for the current tenant (or platform scope if the caller is a platform admin). Captures subject, body, category, priority, and links the conversation. Fully audited.",
      inputSchema: z.object({
        subject: z.string().trim().min(3).max(160),
        body: z.string().trim().min(3).max(8000),
        category: categoryEnum.default("general_question"),
        priority: priorityEnum.default("normal"),
        scope: z.enum(["tenant", "platform"]).optional().describe(
          "Defaults to tenant. Only platform_admin may use 'platform'.",
        ),
        tenant_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Platform admins can target another tenant. Regular members are always constrained to their own tenant.",
          ),
        include_conversation: z.boolean().default(true).describe(
          "Attach a short excerpt of the current Copilot conversation as context.",
        ),
      }),
      execute: async (input) => {
        const scope = input.scope ?? (ctx.scope === "platform" ? "platform" : "tenant");
        if (scope === "platform" && !ctx.isPlatformAdmin) {
          return { error: "platform_admin_required" };
        }
        // Tenant users can only create for their own tenant.
        let targetTenant: string | null = null;
        if (scope === "tenant") {
          if (input.tenant_id && input.tenant_id !== ctx.tenantId && !ctx.isPlatformAdmin) {
            return { error: "cross_tenant_forbidden" };
          }
          targetTenant = input.tenant_id ?? ctx.tenantId;
          if (!targetTenant) return { error: "tenant_required" };
        }

        // Optionally capture last few messages of the copilot thread.
        let contextBlock = "";
        if (input.include_conversation) {
          const { data: msgs } = await supa
            .from("copilot_messages")
            .select("role, content, created_at")
            .eq("thread_id", ctx.threadId)
            .order("created_at", { ascending: false })
            .limit(6);
          if (msgs && msgs.length) {
            contextBlock =
              "\n\n---\nCopilot conversation context:\n" +
              [...msgs]
                .reverse()
                .map((m: any) => `[${m.role}] ${String(m.content ?? "").slice(0, 400)}`)
                .join("\n");
          }
        }
        const fullBody = input.body + contextBlock;

        // Look up SLA policy for this priority.
        let sla_policy_id: string | null = null;
        if (targetTenant) {
          const { data: sla } = await supa
            .from("sla_policies")
            .select("id")
            .eq("tenant_id", targetTenant)
            .eq("priority", input.priority)
            .maybeSingle();
          sla_policy_id = (sla as any)?.id ?? null;
        }

        const { encryptField } = await import("./crypto.server");
        const encryptedBody = await encryptField(fullBody);

        const { data: row, error } = await supa
          .from("support_tickets")
          .insert({
            tenant_id: targetTenant,
            scope,
            subject: input.subject,
            body: encryptedBody,
            priority: input.priority,
            category: input.category,
            queue: scope === "platform" ? "platform" : "tenant",
            created_by: ctx.userId,
            sla_policy_id,
            attachments: [],
          } as any)
          .select("id, ref, priority, status, category, scope, tenant_id, created_at")
          .single();
        if (error) return { error: error.message };

        await writeAudit(ctx, "ticket.create", row.id, targetTenant, {
          ref: row.ref,
          priority: input.priority,
          category: input.category,
          scope,
          via: "copilot",
        });

        return {
          status: "created",
          ticket: {
            id: row.id,
            ref: row.ref,
            subject: input.subject,
            priority: row.priority,
            status: row.status,
            category: row.category,
            scope: row.scope,
            tenant_id: row.tenant_id,
            created_at: row.created_at,
          },
        };
      },
    }),

    list_support_tickets: tool({
      description:
        "Search / filter the caller's visible support tickets (RLS-scoped). Filters: status, priority (severity), category, assigned team queue, assignee, SLA state, text query on subject/ref, mine-only.",
      inputSchema: z.object({
        status: statusEnum.optional(),
        priority: priorityEnum.optional().describe("Also referred to as severity."),
        category: categoryEnum.optional(),
        queue: z.enum(["tenant", "platform"]).optional().describe("Assigned support team queue."),
        assignee_id: z.string().uuid().optional(),
        sla_state: z.enum(["breached", "due_soon", "on_track", "any"]).default("any").describe(
          "Filter by SLA resolution status. due_soon = <=60 min to due.",
        ),
        query: z.string().trim().min(1).max(120).optional().describe("Text match on subject or ticket ref."),
        mine_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (input) => {
        let q = supa
          .from("support_tickets")
          .select(
            "id, ref, subject, priority, status, category, queue, scope, tenant_id, assignee_id, escalated_at, first_response_at, resolved_at, closed_at, created_at, updated_at, sla_policies:sla_policy_id(first_response_mins, resolution_mins)",
          )
          .order("created_at", { ascending: false })
          .limit(input.limit);
        if (input.status) q = q.eq("status", input.status);
        if (input.priority) q = q.eq("priority", input.priority);
        if (input.category) q = q.eq("category", input.category);
        if (input.queue) q = q.eq("queue", input.queue);
        if (input.assignee_id) q = q.eq("assignee_id", input.assignee_id);
        if (input.mine_only) q = q.eq("created_by", ctx.userId);
        if (input.query) q = q.or(`subject.ilike.%${input.query}%,ref.ilike.%${input.query.toUpperCase()}%`);
        if (ctx.tenantId && !ctx.isPlatformAdmin) q = q.eq("tenant_id", ctx.tenantId);
        const { data, error } = await q;
        if (error) return { error: error.message };
        const enriched = (data ?? []).map((r: any) => ({ ...r, sla: slaState(r) }));
        const filtered = enriched.filter((r: any) => {
          if (input.sla_state === "any") return true;
          if (input.sla_state === "breached") return r.sla.resolution_status === "breached";
          if (input.sla_state === "due_soon")
            return r.sla.resolution_status === "pending" &&
              (r.sla.minutes_to_resolution_due ?? Infinity) <= 60;
          if (input.sla_state === "on_track")
            return r.sla.resolution_status === "pending" &&
              (r.sla.minutes_to_resolution_due ?? 0) > 60;
          return true;
        });
        return { tickets: filtered, count: filtered.length };
      },
    }),

    upcoming_ticket_sla: tool({
      description:
        "Proactive SLA countdown. Returns tickets that are breached, due within a window, or with pending actions (unassigned, no first response). RLS-scoped.",
      inputSchema: z.object({
        window_minutes: z.number().int().min(15).max(1440).default(240).describe("How far ahead to look for due tickets. Default 4h."),
        include_pending_actions: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(15),
      }),
      execute: async (input) => {
        let q = supa
          .from("support_tickets")
          .select(
            "id, ref, subject, priority, status, category, queue, tenant_id, assignee_id, first_response_at, resolved_at, closed_at, created_at, sla_policies:sla_policy_id(first_response_mins, resolution_mins)",
          )
          .not("status", "in", "(resolved,closed)")
          .order("created_at", { ascending: false })
          .limit(200);
        if (ctx.tenantId && !ctx.isPlatformAdmin) q = q.eq("tenant_id", ctx.tenantId);
        const { data, error } = await q;
        if (error) return { error: error.message };
        const now = Date.now();
        const windowMs = input.window_minutes * 60_000;
        const items = (data ?? []).map((r: any) => {
          const sla = slaState(r);
          const pending: string[] = [];
          if (!r.assignee_id) pending.push("unassigned");
          if (!r.first_response_at) pending.push("no_first_response");
          return { ...r, sla, pending_actions: pending };
        });
        const surfaced = items.filter((r: any) => {
          if (r.sla.resolution_status === "breached") return true;
          if (r.sla.resolution_status === "pending" &&
              typeof r.sla.minutes_to_resolution_due === "number" &&
              r.sla.minutes_to_resolution_due * 60_000 <= windowMs) return true;
          if (input.include_pending_actions && r.pending_actions.length > 0) return true;
          return false;
        }).slice(0, input.limit);
        return {
          window_minutes: input.window_minutes,
          count: surfaced.length,
          items: surfaced.map((r: any) => ({
            id: r.id,
            ref: r.ref,
            subject: r.subject,
            priority: r.priority,
            status: r.status,
            queue: r.queue,
            tenant_id: r.tenant_id,
            assignee_id: r.assignee_id,
            sla: r.sla,
            pending_actions: r.pending_actions,
          })),
        };
      },
    }),

    attach_files_to_ticket: tool({
      description:
        "Attach one or more files (provided as base64 data URLs) to an existing ticket. Files are stored in the private ticket-attachments bucket under <tenant_id>/<ticket_id>/ and referenced from the ticket's attachments JSON. RLS enforces tenant access.",
      inputSchema: z.object({
        ticket_id: z.string().uuid(),
        files: z
          .array(
            z.object({
              name: z.string().min(1).max(255),
              content_base64: z.string().min(4).max(15_000_000).describe(
                "Raw base64 (no data: prefix) OR a data:<mime>;base64,... URL.",
              ),
              content_type: z.string().max(120).optional(),
            }),
          )
          .min(1)
          .max(5),
      }),
      execute: async (input) => {
        const { data: t, error: tErr } = await supa
          .from("support_tickets")
          .select("id, ref, tenant_id, attachments")
          .eq("id", input.ticket_id)
          .maybeSingle();
        if (tErr) return { error: tErr.message };
        if (!t) return { error: "not_found_or_forbidden" };
        const tenantId = (t as any).tenant_id;
        if (!tenantId) return { error: "platform_scope_attachments_not_supported" };

        const uploaded: any[] = [];
        for (const f of input.files) {
          let base64 = f.content_base64;
          let mime = f.content_type ?? "application/octet-stream";
          const m = base64.match(/^data:([^;]+);base64,(.+)$/);
          if (m) { mime = m[1]; base64 = m[2]; }
          const buf = Buffer.from(base64, "base64");
          if (buf.length > 10 * 1024 * 1024) {
            return { error: `file_too_large:${f.name}` };
          }
          const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
          const path = `${tenantId}/${input.ticket_id}/${Date.now()}-${safeName}`;
          const { error: upErr } = await supa.storage
            .from("ticket-attachments")
            .upload(path, buf, { contentType: mime, upsert: false });
          if (upErr) return { error: `upload_failed:${upErr.message}` };
          uploaded.push({ name: f.name, path, size: buf.length, type: mime });
        }

        const prev = Array.isArray((t as any).attachments) ? (t as any).attachments : [];
        const next = [...prev, ...uploaded];
        const { error: updErr } = await supa
          .from("support_tickets")
          .update({ attachments: next as any })
          .eq("id", input.ticket_id);
        if (updErr) return { error: updErr.message };

        await writeAudit(ctx, "ticket.attach_files", input.ticket_id, tenantId, {
          ref: (t as any).ref,
          count: uploaded.length,
          names: uploaded.map((u) => u.name),
        });

        return { status: "attached", count: uploaded.length, files: uploaded };
      },
    }),


    get_support_ticket: tool({
      description:
        "Return full details for one ticket (by id or ref) including status, assignee, priority, SLA due dates and status, recent comments, and escalation state. RLS-enforced.",
      inputSchema: z
        .object({
          ticket_id: z.string().uuid().optional(),
          ref: z.string().trim().min(3).max(40).optional(),
        })
        .refine((v) => v.ticket_id || v.ref, { message: "ticket_id or ref required" }),
      execute: async (input) => {
        let q = supa
          .from("support_tickets")
          .select(
            "id, ref, subject, priority, status, category, queue, scope, tenant_id, assignee_id, created_by, escalated_at, escalated_reason, first_response_at, resolved_at, closed_at, created_at, updated_at, sla_policies:sla_policy_id(first_response_mins, resolution_mins, name)",
          )
          .limit(1);
        if (input.ticket_id) q = q.eq("id", input.ticket_id);
        else if (input.ref) q = q.eq("ref", input.ref.toUpperCase());
        const { data, error } = await q.maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: "not_found_or_forbidden" };

        const { data: msgs } = await supa
          .from("ticket_messages")
          .select("id, author_id, body, internal_note, created_at")
          .eq("ticket_id", (data as any).id)
          .order("created_at", { ascending: false })
          .limit(5);

        const { maybeDecryptField } = await import("./crypto.server");
        const recent_comments = await Promise.all(
          ((msgs ?? []) as any[]).reverse().map(async (m) => ({
            id: m.id,
            author_id: m.author_id,
            internal_note: m.internal_note,
            body: (await maybeDecryptField(m.body))?.slice(0, 500),
            created_at: m.created_at,
          })),
        );

        await writeAudit(ctx, "ticket.status_check", (data as any).id, (data as any).tenant_id, {
          ref: (data as any).ref,
        });

        return {
          ticket: {
            id: (data as any).id,
            ref: (data as any).ref,
            subject: (data as any).subject,
            status: (data as any).status,
            priority: (data as any).priority,
            category: (data as any).category,
            queue: (data as any).queue,
            scope: (data as any).scope,
            tenant_id: (data as any).tenant_id,
            assignee_id: (data as any).assignee_id,
            created_by: (data as any).created_by,
            created_at: (data as any).created_at,
            updated_at: (data as any).updated_at,
            first_response_at: (data as any).first_response_at,
            resolved_at: (data as any).resolved_at,
            closed_at: (data as any).closed_at,
            escalated: !!(data as any).escalated_at,
            escalated_at: (data as any).escalated_at,
            escalated_reason: (data as any).escalated_reason,
            sla: slaState(data),
          },
          recent_comments,
        };
      },
    }),

    add_ticket_comment: tool({
      description:
        "Add a follow-up comment to an existing ticket (urgency reminder, extra context, resolution note). RLS enforces the caller can see the ticket. Fully audited.",
      inputSchema: z.object({
        ticket_id: z.string().uuid(),
        body: z.string().trim().min(1).max(8000),
        internal_note: z.boolean().default(false).describe(
          "Internal notes are only visible to platform/tenant staff, not to the requester.",
        ),
      }),
      execute: async (input) => {
        // Confirm caller sees the ticket via RLS.
        const { data: t, error: tErr } = await supa
          .from("support_tickets")
          .select("id, tenant_id, ref, created_by, first_response_at")
          .eq("id", input.ticket_id)
          .maybeSingle();
        if (tErr) return { error: tErr.message };
        if (!t) return { error: "not_found_or_forbidden" };

        const { encryptField } = await import("./crypto.server");
        const encryptedBody = await encryptField(input.body);
        const { error } = await supa.from("ticket_messages").insert({
          ticket_id: input.ticket_id,
          author_id: ctx.userId,
          body: encryptedBody,
          internal_note: input.internal_note,
        });
        if (error) return { error: error.message };

        // First-response bookkeeping.
        if (!(t as any).first_response_at && (t as any).created_by !== ctx.userId) {
          await supa
            .from("support_tickets")
            .update({ first_response_at: new Date().toISOString() })
            .eq("id", input.ticket_id);
        }

        await writeAudit(ctx, "ticket.comment", (t as any).id, (t as any).tenant_id, {
          ref: (t as any).ref,
          internal_note: input.internal_note,
          length: input.body.length,
        });

        return { status: "comment_added", ticket_id: input.ticket_id, ref: (t as any).ref };
      },
    }),

    escalate_support_ticket: tool({
      description:
        "Escalate a ticket to the platform queue with a reason. Sets escalated_at, moves queue → platform, status → in_progress. Fully audited.",
      inputSchema: z.object({
        ticket_id: z.string().uuid(),
        reason: z.string().trim().min(3).max(500),
      }),
      execute: async (input) => {
        const { data: row, error } = await supa
          .from("support_tickets")
          .update({
            queue: "platform",
            escalated_at: new Date().toISOString(),
            escalated_reason: input.reason,
            status: "in_progress",
          })
          .eq("id", input.ticket_id)
          .select("id, ref, tenant_id")
          .maybeSingle();
        if (error) return { error: error.message };
        if (!row) return { error: "not_found_or_forbidden" };
        await writeAudit(ctx, "ticket.escalate", (row as any).id, (row as any).tenant_id, {
          ref: (row as any).ref,
          reason: input.reason,
        });
        return { status: "escalated", ref: (row as any).ref };
      },
    }),

    check_ticket_sla_status: tool({
      description:
        "Return SLA status for a ticket: first-response and resolution due times, met/pending/breached, and minutes remaining. Read-only (no audit noise).",
      inputSchema: z.object({ ticket_id: z.string().uuid() }),
      execute: async (input) => {
        const { data, error } = await supa
          .from("support_tickets")
          .select(
            "id, ref, priority, status, created_at, first_response_at, resolved_at, closed_at, sla_policies:sla_policy_id(first_response_mins, resolution_mins, name)",
          )
          .eq("id", input.ticket_id)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: "not_found_or_forbidden" };
        return {
          ref: (data as any).ref,
          priority: (data as any).priority,
          status: (data as any).status,
          sla: slaState(data),
        };
      },
    }),
  } as const;
}
