/**
 * Slack slash-command receiver. Verifies the Slack signature, dispatches
 * read-only /fvi commands (assign/resolve return a step-up link rather
 * than mutating data directly), and records the invocation in
 * chat_ops_slash_commands.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/chat-ops/slash")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ts = request.headers.get("x-slack-request-timestamp") ?? "";
        const sig = request.headers.get("x-slack-signature") ?? "";
        const secret = process.env.SLACK_SIGNING_SECRET;
        const body = await request.text();
        if (!secret) return new Response("misconfigured", { status: 500 });
        const tsNum = parseInt(ts, 10);
        if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
          return new Response("stale", { status: 401 });
        }
        const expected = "v0=" + createHmac("sha256", secret)
          .update(`v0:${ts}:${body}`)
          .digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(sig);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("bad signature", { status: 401 });
        }

        const form = new URLSearchParams(body);
        const text = (form.get("text") ?? "").trim();
        const team_id = form.get("team_id") ?? "";
        const user_email = form.get("user_name") ?? "";
        const [verb, arg1, ...rest] = text.split(/\s+/);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ws } = await supabaseAdmin
          .from("slack_workspaces" as any)
          .select("tenant_id")
          .eq("team_id", team_id)
          .eq("active", true)
          .maybeSingle();
        if (!ws) return Response.json({ response_type: "ephemeral", text: "ReconIQ not installed for this Slack workspace." });
        const tenant_id = (ws as any).tenant_id as string;

        const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://app.reconiq.example";
        let status: "ok" | "denied" | "step_up_required" | "error" = "ok";
        let responseText = "";
        try {
          if (verb === "break" && arg1) {
            const { data: brk } = await supabaseAdmin
              .from("recon_exceptions")
              .select("id,status,severity,description,created_at")
              .eq("tenant_id", tenant_id)
              .ilike("id", `${arg1}%`)
              .maybeSingle();
            responseText = brk
              ? `*Break ${(brk as any).id}* — ${(brk as any).status} (${(brk as any).severity})\n${(brk as any).description ?? ""}`
              : `Break starting with ${arg1} not found.`;
          } else if (verb === "resolve" && arg1) {
            status = "step_up_required";
            responseText = `Resolving a break requires step-up auth. Open: ${baseUrl}/break/${arg1}`;
          } else if (verb === "assign" && arg1 && rest[0]) {
            status = "step_up_required";
            const assignee = rest[0].replace(/^@/, "");
            responseText = `Assignment requires step-up auth. Open ${baseUrl}/break/${arg1} and assign to ${assignee}.`;
          } else {
            responseText = "Usage: `/fvi break <id>` · `/fvi assign <id> @user` · `/fvi resolve <id>`";
          }
        } catch (err) {
          status = "error"; responseText = String(err);
        }
        await supabaseAdmin.from("chat_ops_slash_commands" as any).insert({
          tenant_id,
          command: `/${verb ?? ""}`,
          invoked_by_email: user_email,
          payload: Object.fromEntries(form) as any,
          response_payload: { text: responseText } as any,
          status,
        } as any);
        return Response.json({ response_type: "ephemeral", text: responseText });
      },
    },
  },
});
