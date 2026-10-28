import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/email-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => { const _unauth = verifyCronSecret(request); if (_unauth) return _unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();
        const hourUtc = now.getUTCHours();
        const isWeekly = now.getUTCDay() === 1 && hourUtc === 7;
        const isDaily = hourUtc === 7;
        if (!isDaily) return Response.json({ skipped: "not digest hour" });

        const { data: subs } = await supabaseAdmin.from("email_digest_subscriptions")
          .select("user_id, frequency, last_sent_at")
          .neq("frequency", "off");
        if (!subs?.length) return Response.json({ sent: 0 });

        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const sent: any[] = [];
        for (const sub of subs) {
          if (sub.frequency === "weekly" && !isWeekly) continue;
          if (sub.last_sent_at && new Date(sub.last_sent_at).getTime() > Date.now() - 23 * 60 * 60 * 1000) continue;

          const { data: notifs } = await supabaseAdmin.from("notifications")
            .select("title, body, severity, created_at, link_to, tenant_id")
            .eq("user_id", sub.user_id)
            .gte("created_at", cutoff)
            .order("created_at", { ascending: false }).limit(50);
          if (!notifs?.length) continue;

          const { data: profile } = await supabaseAdmin.from("profiles")
            .select("email, full_name").eq("id", sub.user_id).single();
          if (!profile?.email) continue;

          const html = renderDigest(profile.full_name ?? "", notifs);
          try {
            await supabaseAdmin.rpc("enqueue_email" as any, {
              to_email: profile.email,
              subject: `ReconIQ Digest — ${notifs.length} updates`,
              html,
            });
            await supabaseAdmin.from("email_digest_subscriptions")
              .update({ last_sent_at: new Date().toISOString() })
              .eq("user_id", sub.user_id);
            sent.push({ user_id: sub.user_id, count: notifs.length });
          } catch (e: any) {
            sent.push({ user_id: sub.user_id, error: e.message });
          }
        }
        return Response.json({ sent: sent.length, detail: sent });
      },
    },
  },
});

function renderDigest(name: string, notifs: any[]): string {
  const rows = notifs.map((n) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px 12px;font-size:13px;color:#666">${new Date(n.created_at).toLocaleString()}</td>
      <td style="padding:10px 12px;font-size:14px">
        <div style="font-weight:600;color:#111">${escape(n.title)}</div>
        <div style="color:#555">${escape(n.body ?? "")}</div>
      </td>
      <td style="padding:10px 12px;font-size:12px;text-transform:uppercase;color:${sevColor(n.severity)}">${n.severity ?? "info"}</td>
    </tr>`).join("");
  return `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;background:#f7f7f5;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden">
      <div style="padding:20px 24px;border-bottom:1px solid #eee;background:#0d0d0d;color:#c9a84c">
        <div style="font-weight:700;letter-spacing:.5px">RECONIQ</div>
        <div style="font-size:13px;color:#bbb;margin-top:4px">Your reconciliation digest</div>
      </div>
      <div style="padding:20px 24px;color:#222">
        <p style="margin:0 0 16px">Hi ${escape(name) || "there"},</p>
        <p style="margin:0 0 16px;color:#555">Here's what happened across your tenants in the last 24 hours:</p>
        <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee">${rows}</table>
        <p style="margin:20px 0 0;font-size:12px;color:#888">Manage your digest in ReconIQ → Preferences.</p>
      </div>
    </div></body></html>`;
}
function escape(s: string) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
function sevColor(s: string) { return ({ critical: "#ef4444", warning: "#f59e0b", success: "#10b981", info: "#3b82f6" } as any)[s] ?? "#3b82f6"; }
