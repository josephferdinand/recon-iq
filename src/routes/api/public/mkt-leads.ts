import { createFileRoute } from "@tanstack/react-router";
import { publicLeadInput, scoreLead, categorizeLead } from "@/lib/mkt-leads.functions";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";
import { getRuntimeEnv } from "@/lib/runtime-env.server";

const DEFAULT_NOTIFY_RECIPIENTS = [
  "support@reconintelligence.app",
  "joseph.ferdinand@reconintelligence.app",
];

export function parseNotifyRecipients(configured: string | undefined): string[] {
  if (configured === undefined) return DEFAULT_NOTIFY_RECIPIENTS;
  if (configured.length > 512) return [];
  const entries = configured.split(",");
  if (entries.length === 0 || entries.length > 5) return [];
  const recipients = entries.map((entry) => entry.trim().toLowerCase());
  if (recipients.some((recipient) => !/^[a-z0-9._%+-]+@falconveritas\.com$/u.test(recipient))) return [];
  return [...new Set(recipients)];
}

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  return {
    "cache-control": "no-store",
    vary: "Origin",
    ...(origin ? { "access-control-allow-origin": origin } : {}),
  };
}

export const Route = createFileRoute("/api/public/mkt-leads")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => {
        const co = getCorsOrigin(request.headers.get("origin"));
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type",
            "cache-control": "no-store",
            vary: "Origin",
            ...(co ? { "access-control-allow-origin": co } : {}),
          },
        });
      },
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        try {
          let body: unknown;
          try { body = await request.json(); }
          catch { return json({ error: "invalid_json" }, 400, origin); }

          const parsed = publicLeadInput.safeParse(body);
          if (!parsed.success) {
            return json({ error: "validation_failed", details: parsed.error.flatten() }, 400, origin);
          }
          const input = parsed.data;
          const purpose = input.purpose?.trim() || (input.source === "book_demo" ? "Schedule a product demo" : "Website enquiry");
          const { score, temperature } = scoreLead(input);
          const category = categorizeLead(input);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // Generated Supabase RPC types do not include all retained migrations yet.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const admin = supabaseAdmin as any;
          const address = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
          const ipDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
          const ipKey = Array.from(new Uint8Array(ipDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");

          let rate: unknown;
          try {
            const result = await admin.rpc("rate_limit_hit", {
              _key: `public-mkt-lead:${ipKey}`,
              _window_seconds: 60,
              _limit: 10,
            });
            if (result.error) return json({ error: "rate_limit_unavailable" }, 503, origin);
            rate = result.data;
          } catch {
            return json({ error: "rate_limit_unavailable" }, 503, origin);
          }
          const decision = (Array.isArray(rate) ? rate[0] : rate) as {
            allowed?: unknown;
            retry_after_seconds?: unknown;
          } | null;
          if (!decision || typeof decision.allowed !== "boolean") {
            return json({ error: "rate_limit_unavailable" }, 503, origin);
          }
          if (!decision.allowed) {
            return json({ error: "rate_limit_exceeded" }, 429, origin, {
              "retry-after": String(Math.min(60, Math.max(1, Number(decision.retry_after_seconds) || 60))),
            });
          }

          const { data: lead, error } = await supabaseAdmin.from("mkt_leads").insert({
            first_name: input.first_name,
            last_name: input.last_name,
            email: input.email.toLowerCase(),
            mobile: input.mobile ?? null,
            company: input.company,
            job_title: input.job_title ?? null,
            country: input.country ?? null,
            industry: input.industry ?? null,
            company_size: input.company_size ?? null,
            current_recon_tool: input.current_recon_tool ?? null,
            erp_platform: input.erp_platform ?? null,
            monthly_txn_volume: input.monthly_txn_volume ?? null,
            areas_of_interest: input.areas_of_interest,
            message: input.message ?? null,
            metadata: { plan: input.plan ?? null, purpose },
            consent_at: new Date().toISOString(),
            source: input.source,
            category, stage: "new", temperature, score,
            utm_source: input.utm?.utm_source ?? null,
            utm_medium: input.utm?.utm_medium ?? null,
            utm_campaign: input.utm?.utm_campaign ?? null,
            utm_content: input.utm?.utm_content ?? null,
            utm_term: input.utm?.utm_term ?? null,
            ip: address === "unknown" ? null : address,
            user_agent: request.headers.get("user-agent") ?? null,
          }).select("id").single();

          if (error || !lead?.id) return json({ error: "lead_submission_unavailable" }, 503, origin);

          await supabaseAdmin.from("mkt_lead_activity").insert({
            lead_id: lead.id,
            action: "created",
            details: { source: input.source, score, temperature, category },
          });

          const notificationBody = [
            "A new website request was received.",
            `Name: ${input.first_name} ${input.last_name}`,
            `Email: ${input.email}`,
            `Mobile: ${input.mobile ?? "Not provided"}`,
            `Company: ${input.company}`,
            `Plan: ${input.plan ?? "Not specified"}`,
            `Purpose: ${purpose}`,
            `Lead ID: ${lead.id}`,
          ].join("\n");
          const notificationConfig = getRuntimeEnv("FVI_MARKETING_LEAD_NOTIFY_RECIPIENTS")
            ?? (typeof process !== "undefined" ? process.env?.FVI_MARKETING_LEAD_NOTIFY_RECIPIENTS : undefined);
          const notificationRecipients = parseNotifyRecipients(notificationConfig);
          let notificationQueuedCount = 0;
          let notificationActivityRecorded = true;
          for (const recipient of notificationRecipients) {
            let queued = false;
            try {
              const { error: enqueueError } = await supabaseAdmin.rpc("enqueue_email", {
                queue_name: "transactional_emails",
                payload: {
                  to: recipient,
                  subject: "New ReconIQ website request",
                  template: "mkt_lead_received",
                  data: { body: notificationBody },
                },
              });
              queued = !enqueueError;
            } catch {
              queued = false;
            }
            if (queued) notificationQueuedCount += 1;

            try {
              const { error: activityError } = await supabaseAdmin.from("mkt_lead_activity").insert({
                lead_id: lead.id,
                action: `${recipient === "support@reconintelligence.app" ? "support_notification" : "lead_notification"}.${queued ? "queued" : "failed"}`,
                details: { channel: "email", recipient, queue: "transactional_emails" },
              });
              if (activityError) notificationActivityRecorded = false;
            } catch {
              notificationActivityRecorded = false;
            }
          }

          if (notificationRecipients.length === 0) {
            try {
              const { error: activityError } = await supabaseAdmin.from("mkt_lead_activity").insert({
                lead_id: lead.id,
                action: "lead_notification.failed",
                details: { channel: "email", reason: "invalid_recipient_configuration" },
              });
              notificationActivityRecorded = !activityError;
            } catch {
              notificationActivityRecorded = false;
            }
          }

          return json({
            ok: true,
            lead_accepted: true,
            lead_id: lead.id,
            score,
            temperature,
            category,
            notification_queued: notificationRecipients.length > 0 && notificationQueuedCount === notificationRecipients.length,
            notification_queued_count: notificationQueuedCount,
            notification_recipient_count: notificationRecipients.length,
            notification_activity_recorded: notificationActivityRecorded,
          }, 200, origin);
        } catch {
          return json({ error: "lead_submission_unavailable" }, 503, origin);
        }
      },
    },
  },
});

function json(body: unknown, status: number, origin: string | null, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}
