import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertMktRole } from "./mkt-admin.functions";
import { MKT_TAB_ROLES } from "./mkt-admin-roles";
import { z } from "zod";


export type SiteLogo = {
  id: string;
  name: string;
  category: string;
  logo_url: string | null;
  website_url: string | null;
  display_order: number;
  published: boolean;
  created_at: string;
  updated_at: string;
};

const logoInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  category: z.enum(["customer", "partner", "self", "regulator", "auditor"]).default("customer"),
  logo_url: z.string().url().max(2048).optional().nullable(),
  website_url: z.string().url().max(2048).optional().nullable(),
  display_order: z.number().int().min(0).max(9999).default(100),
  published: z.boolean().default(true),
});

export const listSiteLogosAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.site_logos);
    const { data, error } = await context.supabase

      .from("mkt_site_logos")
      .select("*")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as SiteLogo[];
  });

export const upsertSiteLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => logoInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.site_logos);
    let before: unknown = null;

    if (data.id) {
      const { data: existing } = await context.supabase
        .from("mkt_site_logos")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      before = existing ?? null;
    }
    const row = {
      ...data,
      created_by: context.userId,
    };
    const { data: out, error } = await context.supabase
      .from("mkt_site_logos")
      .upsert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "site_logo",
      entity_key: out.id,
      action: data.id && before ? "update" : "create",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: before as never,
      after: { ...row, id: out.id } as never,
      summary: `${data.id && before ? "Updated" : "Created"} trusted-by logo "${data.name}"`,
    });
    return { id: out.id };
  });

export const deleteSiteLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.site_logos);
    const { data: existing } = await context.supabase

      .from("mkt_site_logos")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase
      .from("mkt_site_logos")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "site_logo",
      entity_key: data.id,
      action: "delete",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: (existing ?? null) as never,
      after: null,
      summary: `Deleted trusted-by logo${existing ? ` "${(existing as { name?: string }).name ?? ""}"` : ""}`,
    });
    return { ok: true };
  });
