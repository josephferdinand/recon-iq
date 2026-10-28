import { readFile } from "node:fs/promises";
import path from "node:path";

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set the canonical FVI_VAULT_PATH");
}
const vault = await readFile(vaultPath, "utf8");
const begin = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
if (begin < 0 || end <= begin) throw new Error("Canonical credential section unavailable");
const row = vault.slice(begin, end).split(/\r?\n/u)
  .find((line) => /^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/u.test(line));
const token = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(token ?? "")) throw new Error("Management access unavailable");

const statement = `select jsonb_build_object(
  'qa_leads',(
    select coalesce(jsonb_agg(jsonb_build_object(
      'tag',split_part(l.email,'@',1),'source',l.source,
      'plan',l.metadata->>'plan','purpose_present',coalesce(length(l.metadata->>'purpose'),0)>0,
      'consent_at_present',l.consent_at is not null,
      'created_event',exists(select 1 from public.mkt_lead_activity a where a.lead_id=l.id and a.action='created'),
      'notification_queued',exists(select 1 from public.mkt_lead_activity a where a.lead_id=l.id and a.action='support_notification.queued'),
      'notification_failed',exists(select 1 from public.mkt_lead_activity a where a.lead_id=l.id and a.action='support_notification.failed')
    ) order by l.created_at),'[]'::jsonb)
    from public.mkt_leads l where lower(l.email) in (
      'qa+contact-20260928@reconiq.example',
      'qa+pricing-20260928@reconiq.example',
      'qa+demo-20260928@reconiq.example',
      'qa+dual-notify-20260928@reconiq.example')),
  'notification_send_log',(
    select coalesce(jsonb_agg(jsonb_build_object('recipient',recipient_email,
      'status',status,'total',total) order by recipient_email,status),'[]'::jsonb)
    from (select recipient_email,status,count(*) total from public.email_send_log
      where recipient_email in ('support@reconiq.example','joseph.ferdinand@reconiq.example')
        and template_name='mkt_lead_received'
        and created_at>now()-interval '3 hours'
      group by recipient_email,status) counts),
  'pending_notification_queue',(
    select count(*) from pgmq.q_transactional_emails
    where message->>'to' in ('support@reconiq.example','joseph.ferdinand@reconiq.example')
      and message->>'template'='mkt_lead_received')
) as state`;
const response = await fetch("https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/database/query", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: statement, read_only: true }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Marketing QA readback HTTP ${response.status}`);
const rows = await response.json();
console.log(JSON.stringify(rows?.[0]?.state ?? { error: "no_state" }));
