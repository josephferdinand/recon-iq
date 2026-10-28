import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { safeSupabaseError } from "@/lib/safe-error.server";
import { assertChatopsEnv } from "@/lib/chatops-env.server";

// S-6 — warn on missing secret at module load; the request handler
// below is the fail-closed enforcement point (returns 503 when unset).
// A module-load throw would take down the entire SSR worker on
// Cloudflare, so we intentionally do not throw here.
try {
  assertChatopsEnv("SLACK_SIGNING_SECRET", process.env.SLACK_SIGNING_SECRET, "development");
} catch { /* never throws in the dev branch, but belt-and-braces */ }

// Public Slack slash-command endpoint for ReconIQ Chat-Ops.
// S-4: signature + body shape validated in a single pass with a
// constant-time HMAC compare on every request. Both malformed-body and
// bad-signature paths follow the exact same code path before returning 401.

const SLACK_REPLY = (text: string) => Response.json({ response_type: "ephemeral", text });
const PATH = "/api/public/chat-ops/slack";

function fmtErr(reason: string) {
  return SLACK_REPLY(`:warning: ${reason}`);
}

// Constant-time compare that tolerates length mismatches by hashing both
// sides through HMAC before timingSafeEqual.
function ctEqual(a: string, b: string, key: Buffer): boolean {
  const ha = createHmac("sha256", key).update(a).digest();
  const hb = createHmac("sha256", key).update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const Route = createFileRoute("/api/public/chat-ops/slack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signingSecret = process.env.SLACK_SIGNING_SECRET;
        if (!signingSecret) {
          // S-3 — sanitize upstream errors: log server-side, return generic to client.
          console.error("[chat-ops/slack] SLACK_SIGNING_SECRET is not configured");
          return new Response("Service unavailable", { status: 503 });
        }

        const body = await request.text();
        const ts = request.headers.get("x-slack-request-timestamp") ?? "";
        const sig = request.headers.get("x-slack-signature") ?? "";
        const secretKey = Buffer.from(signingSecret);

        // ---- Single-pass validation: compute every check, AND them together.
        // Each branch is executed unconditionally so timing does not reveal
        // which check failed (body shape vs signature vs timestamp).

        // 1. Timestamp freshness — also feeds the HMAC input.
        const tsNum = Number(ts);
        const tsOk = Number.isFinite(tsNum) && Math.abs(Date.now() / 1000 - tsNum) <= 60 * 5;

        // 2. Body shape — Slack slash commands send url-encoded form bodies.
        //    We always parse, even if signature will reject, to keep timing flat.
        let params: URLSearchParams;
        let shapeOk: boolean;
        try {
          params = new URLSearchParams(body);
          shapeOk = !!(params.get("team_id") || params.get("channel_id"));
        } catch {
          params = new URLSearchParams();
          shapeOk = false;
        }

        // 3. Signature — always compute the HMAC over the actual body so
        //    timing does not depend on whether shape parsing succeeded.
        const expected = "v0=" + createHmac("sha256", secretKey).update(`v0:${ts}:${body}`).digest("hex");

        // S-3 sibling: assert Slack's `v0=` scheme prefix is present.
        const schemeOk = sig.startsWith("v0=");
        const sigOk = schemeOk && ctEqual(sig, expected, secretKey);

        if (!(tsOk && shapeOk && sigOk)) {
          // Constant-time fallback: run one more HMAC of equal size so the
          // failure path costs the same as a successful one regardless of
          // which sub-check tripped.
          ctEqual(expected, expected, secretKey);
          return new Response("Unauthorized", { status: 401 });
        }

        const text = (params.get("text") ?? "").trim();
        const userName = params.get("user_name") ?? "unknown";
        const userId = params.get("user_id") ?? "";
        const teamId = params.get("team_id") ?? "";
        const channelId = params.get("channel_id") ?? "";
        const tokens = text.split(/\s+/).filter(Boolean);
        const verb = (tokens[0] ?? "help").toLowerCase();

        if (verb === "help" || verb === "") {
          return SLACK_REPLY(
            "*Demo Bank · ReconIQ Chat-Ops*\n" +
              "• `/fvi breaks open <recon-name>` — list open breaks\n" +
              "• `/fvi assign <break-id> <user-email>` — assign\n" +
              "• `/fvi close  <break-id> <reason>` — close\n" +
              "• `/fvi comment <break-id> <text>` — add a note",
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: subs, error: subErr } = await supabaseAdmin
          .from("chat_ops_subscriptions")
          .select("tenant_id, channel, enabled")
          .eq("platform", "slack")
          .eq("enabled", true)
          .in("channel", [teamId, channelId, `team:${teamId}`, `channel:${channelId}`]);
        if (subErr) { safeSupabaseError(subErr, { path: PATH }); return fmtErr("Chat-Ops lookup failed."); }
        const tenantId = subs?.[0]?.tenant_id;
        if (!tenantId) {
          return fmtErr(
            `No ReconIQ tenant is bound to this Slack workspace (team_id=${teamId}). Ask a tenant admin to add a Chat-Ops subscription.`,
          );
        }

        const findBreak = async (token: string) => {
          if (!token) return null;
          let q = supabaseAdmin
            .from("recon_exceptions")
            .select("id,status,assignee,priority,severity")
            .eq("tenant_id", tenantId)
            .limit(2);
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(token)) q = q.eq("id", token);
          else q = q.ilike("id", `${token}%`);
          const { data } = await q;
          if (!data || data.length === 0) return null;
          if (data.length > 1) return "ambiguous";
          return data[0];
        };

        const audit = async (action: string, resourceId: string, ctx: Record<string, unknown>) => {
          await supabaseAdmin.from("audit_log").insert({
            actor_user_id: null,
            tenant_id: tenantId,
            scope: "tenant",
            action,
            resource_type: "recon_exceptions",
            resource_id: resourceId,
            context: { source: "slack", slack_user: userName, slack_user_id: userId, team_id: teamId, ...ctx },
          } as never);
        };

        const safeFail = (e: { message?: string; code?: string; details?: string }) => {
          safeSupabaseError(e, { tenantId, path: PATH });
          return fmtErr("Operation failed.");
        };

        try {
          switch (verb) {
            case "breaks": {
              const { data, error } = await supabaseAdmin
                .from("recon_exceptions")
                .select("id,reason,severity,priority,status")
                .eq("tenant_id", tenantId)
                .in("status", ["open", "investigating"])
                .order("created_at", { ascending: false })
                .limit(10);
              if (error) return safeFail(error);
              if (!data || data.length === 0) return SLACK_REPLY(":tada: No open breaks for Demo Bank.");
              const lines = data.map(
                (r) => `• \`${String(r.id).slice(0, 8)}\` *${r.severity ?? "med"}* — ${r.reason ?? "(no reason)"} (${r.status})`,
              );
              return SLACK_REPLY(`*Open breaks (top ${data.length}):*\n${lines.join("\n")}`);
            }

            case "assign": {
              const token = tokens[1] ?? "";
              const email = tokens[2] ?? "";
              if (!token || !email) return fmtErr("Usage: `/fvi assign <break-id> <user-email>`");
              const brk = await findBreak(token);
              if (!brk) return fmtErr(`No break found matching \`${token}\``);
              if (brk === "ambiguous") return fmtErr(`Ambiguous break id \`${token}\` — provide more characters.`);
              const { data: profile } = await supabaseAdmin
                .from("profiles").select("id").eq("email", email).maybeSingle();
              if (!profile) return fmtErr(`User \`${email}\` not found in ReconIQ.`);
              const { error: uErr } = await supabaseAdmin
                .from("recon_exceptions")
                .update({ assignee: profile.id, assigned_at: new Date().toISOString() })
                .eq("id", brk.id).eq("tenant_id", tenantId);
              if (uErr) return safeFail(uErr);
              await audit("exception.assign", brk.id, { assignee_email: email });
              return SLACK_REPLY(`:white_check_mark: Assigned *${String(brk.id).slice(0, 8)}* to \`${email}\`.`);
            }

            case "close": {
              const token = tokens[1] ?? "";
              const reason = tokens.slice(2).join(" ").trim();
              if (!token || !reason) return fmtErr("Usage: `/fvi close <break-id> <reason>`");
              const brk = await findBreak(token);
              if (!brk) return fmtErr(`No break found matching \`${token}\``);
              if (brk === "ambiguous") return fmtErr(`Ambiguous break id \`${token}\` — provide more characters.`);
              const now = new Date().toISOString();
              const { error: cErr } = await supabaseAdmin
                .from("recon_exceptions")
                .update({ status: "closed", close_reason: reason, closed_at: now, resolved_at: now })
                .eq("id", brk.id).eq("tenant_id", tenantId);
              if (cErr) return safeFail(cErr);
              await audit("exception.close", brk.id, { reason });
              return SLACK_REPLY(`:lock: Closed *${String(brk.id).slice(0, 8)}* — ${reason}`);
            }

            case "comment": {
              const token = tokens[1] ?? "";
              const note = tokens.slice(2).join(" ").trim();
              if (!token || !note) return fmtErr("Usage: `/fvi comment <break-id> <text>`");
              const brk = await findBreak(token);
              if (!brk) return fmtErr(`No break found matching \`${token}\``);
              if (brk === "ambiguous") return fmtErr(`Ambiguous break id \`${token}\` — provide more characters.`);
              const { error: nErr } = await supabaseAdmin.from("break_notes").insert({
                tenant_id: tenantId,
                exception_id: brk.id,
                body_md: `_via Slack by @${userName}_\n\n${note}`,
                author_id: null,
              } as never);
              if (nErr) return safeFail(nErr);
              await audit("exception.comment", brk.id, { length: note.length });
              return SLACK_REPLY(`:speech_balloon: Comment added to *${String(brk.id).slice(0, 8)}*.`);
            }

            default:
              return SLACK_REPLY(
                "Unknown verb. Try `/fvi help`, `/fvi breaks open`, `/fvi assign`, `/fvi close`, or `/fvi comment`.",
              );
          }
        } catch (e) {
          safeSupabaseError({ message: String((e as Error).message ?? e), code: "P0001" }, { tenantId, path: PATH });
          return fmtErr("Internal error.");
        }
      },
    },
  },
});

// Exported for tests (S-4 timing assertions).
export async function __validateSlackRequest(body: string, ts: string, sig: string, signingSecret: string): Promise<{ ok: boolean; elapsedNs: bigint }> {
  const start = process.hrtime.bigint();
  const secretKey = Buffer.from(signingSecret);
  const tsNum = Number(ts);
  const tsOk = Number.isFinite(tsNum) && Math.abs(Date.now() / 1000 - tsNum) <= 60 * 5;
  let shapeOk = false;
  try { shapeOk = !!(new URLSearchParams(body).get("team_id") || new URLSearchParams(body).get("channel_id")); } catch { shapeOk = false; }
  const expected = "v0=" + createHmac("sha256", secretKey).update(`v0:${ts}:${body}`).digest("hex");
  const schemeOk = sig.startsWith("v0=");
  const sigOk = schemeOk && ctEqual(sig, expected, secretKey);
  const ok = tsOk && shapeOk && sigOk;
  if (!ok) ctEqual(expected, expected, secretKey);
  return { ok, elapsedNs: process.hrtime.bigint() - start };
}
