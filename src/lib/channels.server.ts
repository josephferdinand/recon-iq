// Server-only outbound delivery for Slack/Teams/Email/Webhook channels.
import { safeFetch, assertSafeOutboundUrl } from "@/lib/ssrf-guard.server";

export type DeliveryPayload = {
  kind: string;
  title: string;
  body?: string;
  link_to?: string;
  severity?: "info" | "success" | "warning" | "critical";
};

const COLORS: Record<string, string> = {
  info: "#3b82f6", success: "#10b981", warning: "#f59e0b", critical: "#ef4444",
};

export async function deliverToChannel(channel: any, payload: DeliveryPayload) {
  const sev = payload.severity ?? "info";
  try {
    // Guard target URL once up front for the HTTP-shaped channel types.
    if (["slack", "teams", "webhook"].includes(channel.channel_type)) {
      try { assertSafeOutboundUrl(channel.target); }
      catch (e: any) { return await record(channel, false, `blocked target: ${e.message}`); }
    }
    if (channel.channel_type === "slack") {
      const r = await safeFetch(channel.target, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `*${payload.title}*\n${payload.body ?? ""}${payload.link_to ? `\n<${payload.link_to}|Open>` : ""}`,
          attachments: [{ color: COLORS[sev], text: `Event: ${payload.kind}` }],
        }),
      });
      return await record(channel, r.ok, `HTTP ${r.status}`);
    }
    if (channel.channel_type === "teams") {
      const r = await safeFetch(channel.target, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          "@type": "MessageCard", "@context": "https://schema.org/extensions",
          themeColor: COLORS[sev].replace("#", ""),
          title: payload.title,
          text: payload.body ?? "",
          potentialAction: payload.link_to ? [{
            "@type": "OpenUri", name: "Open", targets: [{ os: "default", uri: payload.link_to }],
          }] : undefined,
        }),
      });
      return await record(channel, r.ok, `HTTP ${r.status}`);
    }
    if (channel.channel_type === "webhook") {
      const r = await safeFetch(channel.target, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return await record(channel, r.ok, `HTTP ${r.status}`);
    }
    if (channel.channel_type === "email") {
      // Email delivery via Meta email infrastructure if enabled.
      // Falls back to logging status when not yet provisioned.
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.rpc("enqueue_email" as any, {
          to_email: channel.target,
          subject: payload.title,
          html: `<p>${escapeHtml(payload.body ?? "")}</p>${payload.link_to ? `<p><a href="${escapeAttr(payload.link_to)}">Open in ReconIQ</a></p>` : ""}`,
        });
        return await record(channel, true, "enqueued");
      } catch (e: any) {
        return await record(channel, false, `email infra unavailable: ${e.message ?? "unknown"}`);
      }
    }
    return await record(channel, false, "unknown channel type");
  } catch (e: any) {
    return await record(channel, false, e.message ?? "error");
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
function escapeAttr(s: string) { return escapeHtml(s); }

async function record(channel: any, ok: boolean, detail: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("notification_channels").update({
    last_delivery_at: new Date().toISOString(),
    last_delivery_status: ok ? `ok: ${detail}` : `fail: ${detail}`,
  }).eq("id", channel.id);
  return { ok, detail };
}

export async function fanout(tenantId: string, payload: DeliveryPayload) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: channels } = await supabaseAdmin.from("notification_channels")
    .select("*").eq("tenant_id", tenantId).eq("enabled", true);
  if (!channels) return;
  await Promise.all(
    channels
      .filter((c: any) => Array.isArray(c.events) && c.events.includes(payload.kind))
      .map((c: any) => deliverToChannel(c, payload).catch(() => null))
  );
}
