/**
 * Live Slack two-way thread sync — outbound side. Sends a break comment to
 * the mapped Slack thread (or creates the thread on first comment) and
 * records the delivery in slack_comment_sync. Inbound side is handled by
 * the Slack Events server route (api/public/chat-ops/slack-events).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tenantId = z.string().uuid();

export const listSlackWorkspaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("slack_workspaces" as any)
      .select("id,team_id,team_name,bot_user_id,installed_at,rotated_at,active,scope")
      .eq("tenant_id", data.tenant_id)
      .order("installed_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Register a Slack workspace install. Token is encrypted via the existing
 * field-encryption helper before persistence.
 */
export const registerSlackWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tenantId,
      team_id: z.string().min(1).max(40),
      team_name: z.string().max(200).optional(),
      bot_user_id: z.string().max(40).optional(),
      bot_token: z.string().min(10).max(500),
      scope: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { encryptField } = await import("@/lib/crypto.server");
    const enc = await encryptField(data.bot_token);
    const { data: row, error } = await context.supabase
      .from("slack_workspaces" as any)
      .upsert({
        tenant_id: data.tenant_id,
        team_id: data.team_id,
        team_name: data.team_name ?? null,
        bot_user_id: data.bot_user_id ?? null,
        encrypted_bot_token: enc as any,
        scope: data.scope ?? null,
        installed_by: context.userId,
      } as any, { onConflict: "tenant_id,team_id" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "slack.workspace.install",
      resource_type: "slack_workspaces",
      resource_id: (row as any).id,
    } as any);
    return { ok: true, workspace_id: (row as any).id };
  });

/**
 * Record an outbound comment delivery (mapping created if not present).
 * Posting to Slack's web API itself is done by the dispatcher; we record
 * idempotently here so re-deliveries do not double-write.
 */
export const recordOutboundComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tenantId,
      break_id: z.string().uuid(),
      workspace_id: z.string().uuid(),
      channel_id: z.string().min(1).max(40),
      thread_ts: z.string().min(1).max(40),
      comment_id: z.string().uuid().optional(),
      slack_message_ts: z.string().min(1).max(40),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: mapping, error: merr } = await context.supabase
      .from("slack_thread_mappings" as any)
      .upsert({
        tenant_id: data.tenant_id,
        break_id: data.break_id,
        workspace_id: data.workspace_id,
        channel_id: data.channel_id,
        thread_ts: data.thread_ts,
      } as any, { onConflict: "workspace_id,channel_id,thread_ts" })
      .select("id")
      .single();
    if (merr) throw new Error(merr.message);
    const { error: cerr } = await context.supabase
      .from("slack_comment_sync" as any)
      .insert({
        mapping_id: (mapping as any).id,
        comment_id: data.comment_id ?? null,
        slack_message_ts: data.slack_message_ts,
        direction: "outbound",
      } as any);
    if (cerr) throw new Error(cerr.message);
    return { ok: true, mapping_id: (mapping as any).id };
  });
