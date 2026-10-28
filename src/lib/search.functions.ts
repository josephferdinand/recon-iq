import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type SearchHit = {
  kind: "recon" | "exception" | "ticket" | "kb" | "data_source";
  id: string;
  title: string;
  subtitle?: string;
  tenant_id: string;
};

export const globalSearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id?: string; q: string }) =>
    z.object({ tenant_id: z.string().uuid().optional(), q: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const q = data.q.trim();
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const T = data.tenant_id;

    const apply = <T>(qb: any) => (T ? qb.eq("tenant_id", T) : qb);

    const [recons, exceptions, tickets, kb, ds] = await Promise.all([
      apply(supabase.from("recon_definitions").select("id, tenant_id, name, description"))
        .ilike("name", like).limit(5),
      apply(supabase.from("recon_exceptions").select("id, tenant_id, reason, severity, status"))
        .ilike("reason", like).limit(5),
      apply(supabase.from("support_tickets").select("id, tenant_id, subject, status, priority"))
        .ilike("subject", like).limit(5),
      apply(supabase.from("kb_articles").select("id, tenant_id, title, summary"))
        .ilike("title", like).limit(5),
      apply(supabase.from("workspace_data_sources").select("id, tenant_id, name, source_type"))
        .ilike("name", like).limit(5),
    ]);

    const hits: SearchHit[] = [];
    (recons.data ?? []).forEach((r: any) => hits.push({ kind: "recon", id: r.id, tenant_id: r.tenant_id, title: r.name, subtitle: r.description ?? undefined }));
    (exceptions.data ?? []).forEach((r: any) => hits.push({ kind: "exception", id: r.id, tenant_id: r.tenant_id, title: r.reason, subtitle: `${r.severity} · ${r.status}` }));
    (tickets.data ?? []).forEach((r: any) => hits.push({ kind: "ticket", id: r.id, tenant_id: r.tenant_id, title: r.subject, subtitle: `${r.priority} · ${r.status}` }));
    (kb.data ?? []).forEach((r: any) => hits.push({ kind: "kb", id: r.id, tenant_id: r.tenant_id, title: r.title, subtitle: r.summary ?? undefined }));
    (ds.data ?? []).forEach((r: any) => hits.push({ kind: "data_source", id: r.id, tenant_id: r.tenant_id, title: r.name, subtitle: r.source_type }));
    return hits;
  });
