import type { SupabaseClient } from "@supabase/supabase-js";
import { CopilotRefusal } from "./contracts";

export async function loadThreadHistory(sb: SupabaseClient, threadId: string) {
  const { data, error } = await sb.from("copilot_messages").select("id,role,content,created_at")
    .eq("thread_id", threadId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(32);
  if (error) throw new CopilotRefusal(503, "copilot.history_unavailable", "Conversation history could not be loaded.");
  const history = ((data ?? []) as any[]).reverse()
    .filter(row => ["user", "assistant"].includes(row.role))
    .map(row => ({ role: row.role as "user" | "assistant", content: String(row.content ?? "").slice(0, 8000) }));
  if (!history.length || history.at(-1)?.role !== "user")
    throw new CopilotRefusal(409, "copilot.history_changed", "Conversation changed. Refresh before sending again.");
  return history;
}

export async function currentToolPermission(sb: SupabaseClient, tenantId: string | null) {
  const { data: platform, error: pe } = await sb.from("platform_ai_settings")
    .select("ai_enabled,allow_copilot_global,default_autonomy_ceiling").eq("id", true).single();
  const p = platform as any;
  if (pe || !p || p.ai_enabled !== true || p.allow_copilot_global !== true || !["suggest", "assist", "auto"].includes(p.default_autonomy_ceiling))
    throw new CopilotRefusal(403, "copilot.disabled", "Copilot is not enabled by platform policy.");
  let writeProposals = p.default_autonomy_ceiling !== "suggest";
  if (tenantId) {
    const { data: tenant, error: te } = await sb.from("tenant_ai_settings")
      .select("ai_enabled,allow_copilot,default_autonomy").eq("tenant_id", tenantId).single();
    const t = tenant as any;
    if (te || !t || t.ai_enabled !== true || t.allow_copilot !== true || !["read_only", "supervised", "autonomous"].includes(t.default_autonomy))
      throw new CopilotRefusal(403, "copilot.disabled", "Copilot is not enabled by tenant policy.");
    writeProposals = writeProposals && t.default_autonomy !== "read_only";
  }
  return { writeProposals };
}

const ticketReads = new Set(["list_support_tickets", "get_support_ticket", "check_ticket_sla_status", "upcoming_ticket_sla"]);
export function allowedTicketTools<T>(tools: Record<string, T>, writeProposals: boolean): Record<string, T> {
  return writeProposals ? tools : Object.fromEntries(Object.entries(tools).filter(([name]) => ticketReads.has(name)));
}
