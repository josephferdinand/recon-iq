import { createFileRoute } from "@tanstack/react-router";
import type { Json } from "@/integrations/supabase/types";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { getRuntimeEnv } from "@/lib/runtime-env.server";
import { sendViaZeptoMail } from "@/lib/email-templates/zeptomail";
import { renderBrandedQueueEmail, signupAdmissionNotice } from "@/lib/email-templates/queue-brand";

type QueueMessage = {
  msg_id: number;
  read_ct: number;
  message: Json;
};

type SignupEvent = {
  event_id: string;
  request_id: string;
  tenant_id: string;
  user_id: string;
  event_name: "signup.admission_requested" | "signup.admission_approved" | "signup.admission_denied";
  lease_token: string;
  idempotency_key: string;
};

function parsePayload(value: Json) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const to = typeof value.to === "string" ? value.to.trim() : "";
  const subject = typeof value.subject === "string" ? value.subject.trim() : "";
  const template = typeof value.template === "string" ? value.template.trim() : "notification";
  const data =
    value.data && !Array.isArray(value.data) && typeof value.data === "object" ? value.data : {};
  const body =
    typeof data.body === "string" ? data.body : "You have a new ReconIQ notification.";
  if (!/^\S+@\S+\.\S+$/u.test(to) || !subject || subject.length > 200 || body.length > 10_000)
    return null;
  return { to, subject, template, body };
}

async function processSignupEvents() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const apiToken = getRuntimeEnv("ZEPTOMAIL_API_KEY");
  if (!apiToken) throw new Error("ZeptoMail runtime credential unavailable");
  const { data, error } = await (supabaseAdmin as any).rpc("claim_tenant_signup_events", {
    _batch_size: 10, _lease_seconds: 120,
  });
  if (error) throw new Error("Signup notification outbox unavailable");
  const events = (data ?? []) as SignupEvent[];
  let sent = 0;
  let failed = 0;

  for (const event of events) {
    let failureCode = "dispatch_failed";
    try {
      if (!["signup.admission_requested", "signup.admission_approved", "signup.admission_denied"].includes(event.event_name)) {
        failureCode = "unsupported_event";
        throw new Error(failureCode);
      }
      const { data: request, error: requestError } = await (supabaseAdmin as any)
        .from("tenant_signup_requests")
        .select("id,tenant_id,user_id,email,full_name")
        .eq("id", event.request_id).eq("tenant_id", event.tenant_id).eq("user_id", event.user_id).single();
      if (requestError || !request) {
        failureCode = "request_unavailable";
        throw new Error(failureCode);
      }

      const recipients: Array<{ email: string; kind: "admin" | "applicant" }> = [
        { email: request.email, kind: "applicant" },
      ];
      if (event.event_name === "signup.admission_requested") {
        const { data: admins, error: adminError } = await supabaseAdmin.from("tenant_members")
          .select("user_id").eq("tenant_id", event.tenant_id).eq("active", true).eq("role", "tenant_admin");
        if (adminError || !admins?.length) {
          failureCode = "admin_unavailable";
          throw new Error(failureCode);
        }
        const { data: profiles, error: profileError } = await supabaseAdmin.from("profiles")
          .select("id,email").in("id", admins.map((admin) => admin.user_id));
        if (profileError || !profiles?.some((profile) => profile.email)) {
          failureCode = "admin_email_unavailable";
          throw new Error(failureCode);
        }
        recipients.push(...profiles.filter((profile) => profile.email).map((profile) => ({
          email: profile.email as string, kind: "admin" as const,
        })));
      }

      for (const [index, recipient] of recipients.entries()) {
        const { data: existing, error: logReadError } = await supabaseAdmin.from("email_send_log")
          .select("id").eq("status", "sent")
          .contains("metadata", { signup_event_id: event.event_id, recipient_email: recipient.email })
          .limit(1);
        if (logReadError) {
          failureCode = "delivery_log_unavailable";
          throw new Error(failureCode);
        }
        if (existing?.length) continue;
        const notice = signupAdmissionNotice(event.event_name, recipient.kind, request.full_name);
        const reference = `${event.idempotency_key}-${index}`;
        const result = await sendViaZeptoMail({
          to: [{ email: recipient.email }],
          from: { email: "notifications@reconintelligence.app", name: "ReconIQ" },
          subject: notice.subject,
          htmlBody: renderBrandedQueueEmail(notice.subject, notice.body),
          textBody: `${notice.subject}\n\n${notice.body}`,
          clientReference: reference,
        }, { apiToken, apiBase: "https://api.zeptomail.in" });
        const { error: logError } = await supabaseAdmin.from("email_send_log").insert({
          recipient_email: recipient.email,
          status: "sent",
          template_name: event.event_name,
          message_id: result.messageId ?? reference,
          metadata: { signup_event_id: event.event_id, recipient_email: recipient.email },
        });
        if (logError) {
          failureCode = "delivery_log_write_failed";
          throw new Error(failureCode);
        }
        sent += 1;
      }
      const { data: acknowledged, error: ackError } = await (supabaseAdmin as any).rpc("ack_tenant_signup_event", {
        _event_id: event.event_id, _lease_token: event.lease_token,
        _provider_message_id: event.idempotency_key,
      });
      if (ackError || !acknowledged) {
        failureCode = "ack_failed";
        throw new Error(failureCode);
      }
    } catch {
      failed += 1;
      await (supabaseAdmin as any).rpc("fail_tenant_signup_event", {
        _event_id: event.event_id, _lease_token: event.lease_token,
        _error_code: failureCode,
      });
    }
  }
  return { claimed: events.length, sent, failed };
}

async function processQueue() {
  const [{ supabaseAdmin }, apiToken] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    Promise.resolve(getRuntimeEnv("ZEPTOMAIL_API_KEY")),
  ]);
  if (!apiToken) throw new Error("ZeptoMail runtime credential unavailable");
  const { processFailedLoginQueueMessage, recoverRecordedFailedLoginEmails } = await import("@/lib/failed-login-email.server");
  await recoverRecordedFailedLoginEmails(supabaseAdmin as any);
  const { data, error } = await supabaseAdmin.rpc("read_email_batch", {
    queue_name: "transactional_emails",
    batch_size: 10,
    vt: 120,
  });
  if (error) throw new Error(error.message);
  const messages = (data ?? []) as QueueMessage[];
  let sent = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const item of messages) {
    const failedLogin = await processFailedLoginQueueMessage(supabaseAdmin as any, item, apiToken);
    if (failedLogin) {
      sent += failedLogin.sent;
      failed += failedLogin.failed;
      continue;
    }
    const payload = parsePayload(item.message);
    if (!payload) {
      await supabaseAdmin.rpc("move_to_dlq", {
        source_queue: "transactional_emails",
        dlq_name: "transactional_emails_dlq",
        message_id: item.msg_id,
        payload: item.message,
      });
      deadLettered += 1;
      continue;
    }
    try {
      const result = await sendViaZeptoMail(
        {
          to: [{ email: payload.to }],
          from: { email: "notifications@reconintelligence.app", name: "ReconIQ" },
          subject: payload.subject,
          htmlBody: renderBrandedQueueEmail(payload.subject, payload.body),
          textBody: `${payload.subject}\n\n${payload.body}`,
          clientReference: `fvi-queue-${item.msg_id}`,
        },
        { apiToken, apiBase: "https://api.zeptomail.in" },
      );
      await supabaseAdmin.from("email_send_log").insert({
        recipient_email: payload.to,
        status: "sent",
        template_name: payload.template,
        message_id: result.messageId ?? `pgmq-${item.msg_id}`,
        metadata: { queue: "transactional_emails", queue_message_id: item.msg_id },
      });
      await supabaseAdmin.rpc("delete_email", {
        queue_name: "transactional_emails",
        message_id: item.msg_id,
      });
      sent += 1;
    } catch (sendError) {
      failed += 1;
      await supabaseAdmin.from("email_send_log").insert({
        recipient_email: payload.to,
        status: "failed",
        template_name: payload.template,
        message_id: `pgmq-${item.msg_id}`,
        error_message: sendError instanceof Error ? sendError.message.slice(0, 500) : "send_failed",
        metadata: { queue: "transactional_emails", queue_message_id: item.msg_id },
      });
      if (item.read_ct >= 3) {
        await supabaseAdmin.rpc("move_to_dlq", {
          source_queue: "transactional_emails",
          dlq_name: "transactional_emails_dlq",
          message_id: item.msg_id,
          payload: item.message,
        });
        deadLettered += 1;
      }
    }
  }
  return { read: messages.length, sent, failed, dead_lettered: deadLettered };
}

export const Route = createFileRoute("/api/public/cron/email-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronSecret(request);
        if (unauthorized) return unauthorized;
        try {
          // A failure in either queue must not starve the other notification path.
          const [queueResult, signupResult] = await Promise.allSettled([
            processQueue(), processSignupEvents(),
          ]);
          const queue = queueResult.status === "fulfilled"
            ? queueResult.value : { read: 0, sent: 0, failed: 1, dead_lettered: 0 };
          const signup = signupResult.status === "fulfilled"
            ? signupResult.value : { claimed: 0, sent: 0, failed: 1 };
          const ok = queueResult.status === "fulfilled"
            && signupResult.status === "fulfilled" && signup.failed === 0;
          return Response.json({ ok, ...queue, signup }, { status: ok ? 200 : 503 });
        } catch (error) {
          console.error("[email-queue] processing failed", error);
          return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
