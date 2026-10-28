// Phase 7 — Counterparty Outreach (Symphony / Outlook / Teams / Slack / Jira via plugins)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const queueOutreachMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      break_id: z.string().uuid().optional(),
      channel: z.enum(["symphony","outlook","teams","slack","email"]),
      recipient: z.string().min(1),
      subject: z.string().optional(),
      body: z.string().min(1).max(20_000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("outreach_messages")
      .insert({ ...data, status: "queued", created_by: context.userId } as never).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listOutreachMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      status: z.enum(["queued","sent","failed"]).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("outreach_messages")
      .select("id,channel,recipient,subject,status,sent_at,created_at,error")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
