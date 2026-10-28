// Fan-out notifications when a KB write proposal enters the approval queue.
// Fire-and-forget: never throws — logs failures but returns void.
//
// Two channels:
//   1. Direct email to every tenant_admin (and platform_admin for platform-scope
//      articles) via the enqueue_email RPC when it exists. Best-effort.
//   2. Any platform notification channel subscribed to `kb_approval_requested`
//      (reuses the platform_backup_notification_channels table + dispatcher).

import type { SupabaseClient } from "@supabase/supabase-js";

export type KbApprovalNotice = {
  tenantId: string;
  tool: "kb_article_create" | "kb_article_update" | "kb_article_publish" | "kb_article_archive";
  actionId: string;
  requesterUserId: string;
  scope: "tenant" | "platform";
  title: string;
  summary?: string | null;
};

async function collectApproverEmails(supabase: SupabaseClient, notice: KbApprovalNotice): Promise<string[]> {
  const emails = new Set<string>();
  try {
    // tenant_admins for the tenant
    const { data: tenantAdmins } = await (supabase as any)
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", notice.tenantId)
      .eq("role", "tenant_admin");

    // platform_admins whenever scope=platform (or as backstop)
    let platformAdmins: any[] = [];
    if (notice.scope === "platform") {
      const { data } = await (supabase as any)
        .from("user_roles")
        .select("user_id")
        .eq("role", "platform_admin");
      platformAdmins = data ?? [];
    }

    const userIds = Array.from(new Set([
      ...((tenantAdmins ?? []).map((r: any) => r.user_id)),
      ...(platformAdmins.map((r: any) => r.user_id)),
    ])).filter(Boolean);

    if (userIds.length === 0) return [];

    // Prefer profiles.email if present; fall back to auth.users via RPC.
    const { data: profiles } = await (supabase as any)
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    for (const p of profiles ?? []) if (p?.email) emails.add(p.email);
  } catch {
    /* best-effort */
  }
  return Array.from(emails);
}

export async function notifyKbApprovers(
  supabase: SupabaseClient,
  notice: KbApprovalNotice,
): Promise<void> {
  const subject = `[ReconIQ] KB approval required — ${notice.title}`;
  const body = [
    `A Knowledge Base ${notice.tool.replace("kb_article_", "")} request is awaiting approval.`,
    ``,
    `• Article: ${notice.title}`,
    `• Scope:   ${notice.scope}`,
    `• Action:  ${notice.actionId}`,
    notice.summary ? `• Summary: ${notice.summary}` : ``,
    ``,
    `Review it in the Agent Review Queue.`,
  ].filter(Boolean).join("\n");

  // 1) Direct email to approver users (best-effort)
  try {
    const emails = await collectApproverEmails(supabase, notice);
    for (const to of emails) {
      const { error } = await (supabase as any).rpc("enqueue_email", {
        _queue: "transactional_emails",
        _payload: {
          to,
          subject,
          template: "kb_approval_requested",
          data: { body, action_id: notice.actionId, tool: notice.tool, title: notice.title, scope: notice.scope },
        },
      });
      if (error && !/does not exist|not found/i.test(error.message ?? "")) {
        // swallow — never block proposal creation
        console.warn("[kb-approval-notify] email enqueue failed:", error.message);
      }
    }
  } catch (e: any) {
    console.warn("[kb-approval-notify] email fan-out failed:", e?.message ?? e);
  }

  // 2) Platform notification channels (email/slack/webhook) subscribed to
  //    `kb_approval_requested`. Reuses the backup-notifications dispatcher.
  try {
    const { fanOutBackupAlert } = await import("./backup-notifications.functions");
    await fanOutBackupAlert(
      supabase as any,
      "kb_approval_requested",
      subject,
      body,
      {
        action_id: notice.actionId,
        tool: notice.tool,
        tenant_id: notice.tenantId,
        scope: notice.scope,
        title: notice.title,
      },
    );
  } catch (e: any) {
    console.warn("[kb-approval-notify] channel fan-out failed:", e?.message ?? e);
  }
}
