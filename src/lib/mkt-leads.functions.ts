import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  hasAnyMktRole,
  MKT_ANALYTICS_ROLES,
  MKT_PII_READ_ROLES,
  MKT_PII_WRITE_ROLES,
  type MktRole,
} from "@/lib/mkt-admin-roles";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Public schema                                                       */
/* ------------------------------------------------------------------ */

export const LEAD_CATEGORIES = ["sales","support","product","partnership","careers","general"] as const;
export const AREAS_OF_INTEREST = [
  "Reconciliation","Exception Management","AI Automation","Reporting","Workflow Automation","Enterprise Integration",
] as const;

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREE_EMAIL = new Set(["gmail.com","yahoo.com","outlook.com","hotmail.com","aol.com","icloud.com","protonmail.com","proton.me","live.com","msn.com"]);

export const publicLeadInput = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().max(200).regex(emailRe, "Invalid email"),
  mobile: z.string().max(40).optional().nullable(),
  company: z.string().min(1).max(200),
  plan: z.enum(["Professional", "Institutional", "Enterprise", "Not sure yet"]).optional().nullable(),
  purpose: z.string().trim().min(1).max(240).optional().nullable(),
  job_title: z.string().max(120).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  industry: z.string().max(80).optional().nullable(),
  company_size: z.string().max(40).optional().nullable(),
  current_recon_tool: z.string().max(120).optional().nullable(),
  erp_platform: z.string().max(120).optional().nullable(),
  monthly_txn_volume: z.string().max(40).optional().nullable(),
  areas_of_interest: z.array(z.string().max(60)).max(12).default([]),
  message: z.string().max(4000).optional().nullable(),
  consent: z.literal(true),
  source: z.enum(["contact_form","chatbot","book_demo","api","import","other"]).default("contact_form"),
  utm: z.record(z.string(), z.string().max(200)).optional(),
});

export type PublicLeadInput = z.infer<typeof publicLeadInput>;

/* ------------------------------------------------------------------ */
/* Scoring + categorization                                            */
/* ------------------------------------------------------------------ */

const ENTERPRISE_INDUSTRIES = new Set([
  "banking","capital markets","investment banking","asset management",
  "wealth management","insurance","broker dealer","fintech","exchange",
  "clearing","custody","hedge fund","private equity",
]);

export function scoreLead(input: PublicLeadInput): { score: number; temperature: "hot"|"warm"|"cold" } {
  let s = 0;
  const domain = input.email.split("@")[1]?.toLowerCase() ?? "";
  if (domain && !FREE_EMAIL.has(domain)) s += 25;

  const size = (input.company_size ?? "").toLowerCase();
  if (/10000|>|5000|1000/.test(size)) s += 25;
  else if (/500|250/.test(size)) s += 15;
  else if (/50|100/.test(size)) s += 8;

  const ind = (input.industry ?? "").toLowerCase();
  if ([...ENTERPRISE_INDUSTRIES].some((k) => ind.includes(k))) s += 15;

  s += Math.min(input.areas_of_interest.length, 6) * 3;

  const msg = `${input.purpose ?? ""} ${input.message ?? ""}`.toLowerCase();
  if (msg.length > 40) s += 5;
  if (/rfp|proposal|evaluat|poc|pilot|demo|pricing|buy|purchase/.test(msg)) s += 15;

  const vol = (input.monthly_txn_volume ?? "").toLowerCase();
  if (/million|>1m|100k|1m|10m/.test(vol)) s += 10;

  s = Math.min(100, s);
  const temperature = s >= 70 ? "hot" : s >= 40 ? "warm" : "cold";
  return { score: s, temperature };
}

export function categorizeLead(input: PublicLeadInput): typeof LEAD_CATEGORIES[number] {
  const m = `${input.purpose ?? ""} ${input.message ?? ""}`.toLowerCase();
  if (/support|issue|bug|help|problem|down|error/.test(m)) return "support";
  if (/partner|reseller|integrator|alliance/.test(m)) return "partnership";
  if (/career|hiring|job|internship|resume/.test(m)) return "careers";
  if (/product|feature|roadmap|api|integration/.test(m)) return "product";
  if (input.source === "book_demo") return "sales";
  if (input.areas_of_interest.length > 0) return "sales";
  return "general";
}

/* ------------------------------------------------------------------ */
/* Admin server functions                                              */
/* ------------------------------------------------------------------ */

type LeadStage = "new"|"qualified"|"meeting_scheduled"|"proposal"|"negotiation"|"won"|"lost";
type LeadCategory = "sales"|"support"|"product"|"partnership"|"careers"|"general";

type MktLeadAuthContext = { supabase: SupabaseClient<Database>; userId: string };

async function assertMktLeadRole(context: MktLeadAuthContext, allowedRoles: readonly MktRole[]) {
  const { data, error } = await context.supabase
    .from("mkt_admin_roles")
    .select("role")
    .eq("user_id", context.userId);
  const roles = (data ?? []).map(({ role }) => role);
  if (error || !hasAnyMktRole(roles, allowedRoles)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

const leadKpisResultSchema = z.object({
  total: z.number().int().nonnegative().nullable(),
  restricted: z.boolean(),
  suppressed: z.boolean(),
  byStage: z.record(z.string(), z.number().int().nonnegative()),
  byTemp: z.object({
    hot: z.number().int().nonnegative().nullable(),
    warm: z.number().int().nonnegative().nullable(),
    cold: z.number().int().nonnegative().nullable(),
  }),
  daily: z.record(z.string(), z.number().int().nonnegative()),
  last7: z.number().int().nonnegative().nullable(),
});

export const listLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      stage: z.string().optional(),
      temperature: z.enum(["hot","warm","cold"]).optional(),
      category: z.string().optional(),
      q: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertMktLeadRole(context, MKT_PII_READ_ROLES);
    let q = context.supabase.from("mkt_leads")
      .select("id,first_name,last_name,email,company,country,industry,stage,temperature,category,score,owner_id,created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.stage) q = q.eq("stage", data.stage as LeadStage);
    if (data.temperature) q = q.eq("temperature", data.temperature);
    if (data.category) q = q.eq("category", data.category as LeadCategory);
    if (data.q) q = q.or(`email.ilike.%${data.q}%,company.ilike.%${data.q}%,first_name.ilike.%${data.q}%,last_name.ilike.%${data.q}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktLeadRole(context, MKT_PII_READ_ROLES);
    const leadCols = "id,first_name,last_name,email,mobile,company,job_title,country,industry,company_size,current_recon_tool,erp_platform,monthly_txn_volume,areas_of_interest,message,source,category,stage,temperature,score,owner_id,consent_at,utm_source,utm_medium,utm_campaign,utm_content,utm_term,user_agent,metadata,created_at,updated_at";
    const [{ data: lead, error: e1 }, notes, tasks, files, activity] = await Promise.all([
      context.supabase.from("mkt_leads").select(leadCols).eq("id", data.id).maybeSingle(),
      context.supabase.from("mkt_lead_notes").select("id,kind,body,author_id,created_at").eq("lead_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("mkt_lead_tasks").select("id,title,description,status,due_at,assignee_id,created_at").eq("lead_id", data.id).order("due_at", { ascending: true }),
      context.supabase.from("mkt_lead_files").select("id,filename,mime,size_bytes,storage_path,created_at").eq("lead_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("mkt_lead_activity").select("id,action,details,actor_id,created_at").eq("lead_id", data.id).order("created_at", { ascending: false }).limit(100),
    ]);
    if (e1) throw new Error(e1.message);
    if (!lead) throw new Error("Lead not found");
    return {
      lead,
      notes: notes.data ?? [],
      tasks: tasks.data ?? [],
      files: files.data ?? [],
      activity: activity.data ?? [],
    };
  });

export const updateLeadStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(),
    stage: z.enum(["new","qualified","meeting_scheduled","proposal","negotiation","won","lost"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktLeadRole(context, MKT_PII_WRITE_ROLES);
    const { data: before } = await context.supabase
      .from("mkt_leads").select("id,stage,first_name,last_name,company").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase.from("mkt_leads").update({ stage: data.stage }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("mkt_lead_activity").insert({
      lead_id: data.id, actor_id: context.userId, action: "stage.changed", details: { stage: data.stage },
    });
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "lead",
      entity_key: data.id,
      action: "update",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: (before ?? null) as never,
      after: { id: data.id, stage: data.stage } as never,
      summary: `Lead stage → ${data.stage}${before ? ` (${(before as { first_name?: string }).first_name ?? ""} ${(before as { last_name?: string }).last_name ?? ""} · ${(before as { company?: string }).company ?? ""})`.trim() : ""}`,
    });
    return { ok: true };
  });

export const addLeadNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(), body: z.string().min(1).max(4000), kind: z.string().max(20).default("note"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktLeadRole(context, MKT_PII_WRITE_ROLES);
    const { error } = await context.supabase.from("mkt_lead_notes").insert({
      lead_id: data.id, author_id: context.userId, body: data.body, kind: data.kind,
    });
    if (error) throw new Error(error.message);
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "lead",
      entity_key: data.id,
      action: "create",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: null,
      after: { lead_id: data.id, kind: data.kind, body: data.body.slice(0, 280) } as never,
      summary: `Added ${data.kind} to lead`,
    });
    return { ok: true };
  });

export const assignLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), owner_id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktLeadRole(context, MKT_PII_WRITE_ROLES);
    const { data: before } = await context.supabase
      .from("mkt_leads").select("id,owner_id").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase.from("mkt_leads").update({ owner_id: data.owner_id }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("mkt_lead_activity").insert({
      lead_id: data.id, actor_id: context.userId, action: "assigned", details: { owner_id: data.owner_id },
    });
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "lead",
      entity_key: data.id,
      action: "update",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: (before ?? null) as never,
      after: { id: data.id, owner_id: data.owner_id } as never,
      summary: data.owner_id ? `Assigned lead to ${data.owner_id}` : "Unassigned lead",
    });
    return { ok: true };
  });

export const leadKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertMktLeadRole(context, MKT_ANALYTICS_ROLES);
    const aggregateClient = context.supabase as unknown as {
      rpc: (name: "mkt_lead_kpis") => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await aggregateClient.rpc("mkt_lead_kpis");
    if (error) throw new Error(error.message);
    return leadKpisResultSchema.parse(data);
  });
