import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getReconAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { recon_id: string }) =>
    z.object({ recon_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: def } = await context.supabase.from("recon_definitions")
      .select("id, tenant_id, visibility, name").eq("id", data.recon_id).maybeSingle();
    if (!def) throw new Error("Recon not found");
    const { data: perms } = await context.supabase.from("recon_permissions")
      .select("id, principal_type, principal_id, permission").eq("recon_id", data.recon_id);
    return { def, perms: perms ?? [] };
  });

export const setReconVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      recon_id: z.string().uuid(),
      visibility: z.enum(["tenant", "restricted"]),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("recon_definitions")
      .update({ visibility: data.visibility }).eq("id", data.recon_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const grantReconPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      recon_id: z.string().uuid(),
      principal_type: z.enum(["user", "group"]),
      principal_id: z.string().uuid(),
      permission: z.enum(["read", "run", "edit", "approve"]),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("recon_permissions")
      .insert({ ...data, granted_by: context.userId } as any);
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });

export const revokeReconPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ permission_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("recon_permissions")
      .delete().eq("id", data.permission_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
