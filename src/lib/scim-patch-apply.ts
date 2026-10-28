// Apply a parsed SCIM PATCH against ReconIQ tables. Each op is audited to
// public.security_events. Unknown paths are SKIPPED (not errors) per
// RFC 7644 §3.5.2 — IdPs send vendor-specific attributes routinely.
import { ScimPatchError, type ScimPatchOperation } from "./scim-patch-strict";

export interface ScimPatchContext {
  // Service-role Supabase client (admin). We accept `any` because the
  // generated Database type is huge and we use only loose .from()/.update()/.insert().
  // Callers MUST pass a service-role client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string; // ReconIQ user id (uuid) PATCH targets — for User PATCH
  tenantId: string;
  actorUserId: string | null; // IdP service account / admin who triggered the call
  groupId?: string; // For Group PATCH
}

export interface ScimPatchOpResult {
  updated: number;
  path: string;
  value?: unknown;
  skipped?: boolean;
  reason?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function audit(
  ctx: ScimPatchContext,
  event_type: "scim.patch.applied" | "scim.patch.unknown_path",
  severity: "info" | "warning" | "error",
  context: Record<string, unknown>,
) {
  try {
    await ctx.supabase.from("security_events").insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.actorUserId,
      event_type,
      severity,
      context,
    });
  } catch {
    // Audit write must never break the PATCH. Best-effort.
  }
}

function normalizePath(path?: string): string {
  return (path ?? "").trim();
}

/**
 * Map a (path, op, value) tuple to a profiles-table column update.
 * Returns null when the path is not a known User attribute.
 */
function userColumnUpdate(
  path: string,
  op: ScimPatchOperation["op"],
  value: unknown,
): { table: "profiles" | "tenant_members"; field: string; value: unknown } | null {
  const p = path.toLowerCase();

  if (p === "active") {
    const status = value === true || value === "true";
    return { table: "tenant_members", field: "active", value: status };
  }
  if (p === "username" && typeof value === "string") {
    // Special-cased by caller (writes to auth.users via Admin API + profiles.email).
    return { table: "profiles", field: "email", value: value.trim().toLowerCase() };
  }
  if (p === "displayname" && typeof value === "string") {
    return { table: "profiles", field: "full_name", value };
  }
  if ((p === "name.givenname" || p === "name.familyname" || p === "name.formatted") && typeof value === "string") {
    return { table: "profiles", field: "full_name", value };
  }
  if (p === "locale" && typeof value === "string") {
    return { table: "profiles", field: "locale", value };
  }
  if (p === "preferredlanguage" && typeof value === "string") {
    return { table: "profiles", field: "locale", value };
  }
  if (p === "externalid" && typeof value === "string") {
    return { table: "profiles", field: "external_id", value };
  }
  // Enterprise extension — department
  if (
    p === "urn:ietf:params:scim:schemas:extension:enterprise:2.0:user.department" ||
    p === "urn:ietf:params:scim:schemas:extension:enterprise:2.0:user:department" ||
    p === "department"
  ) {
    if (typeof value === "string") return { table: "profiles", field: "department", value };
  }
  // emails[primary eq true].value
  if (/^emails\[\s*primary\s+eq\s+true\s*\]\.value$/i.test(path) && typeof value === "string") {
    return { table: "profiles", field: "email", value: value.trim().toLowerCase() };
  }
  return null;
}

export async function applyScimPatch(
  ctx: ScimPatchContext,
  ops: ScimPatchOperation[],
): Promise<ScimPatchOpResult[]> {
  const results: ScimPatchOpResult[] = [];

  for (const opItem of ops) {
    const path = normalizePath(opItem.path);
    const op = opItem.op;
    const value = opItem.value;

    // --- Groups membership ops (Group PATCH) ---
    if (path.toLowerCase() === "members" && ctx.groupId) {
      const members = Array.isArray(value) ? value : value !== undefined ? [value] : [];
      const ids = members
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((m: any) => (typeof m === "string" ? m : String(m?.value ?? "")))
        .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
      if (op === "add" || op === "replace") {
        if (op === "replace") {
          await ctx.supabase.from("tenant_group_members").delete().eq("group_id", ctx.groupId);
        }
        if (ids.length > 0) {
          const { error } = await ctx.supabase
            .from("tenant_group_members")
            .upsert(
              ids.map((uid) => ({ group_id: ctx.groupId, user_id: uid })),
              { onConflict: "group_id,user_id" },
            );
          if (error) {
            await audit(ctx, "scim.patch.applied", "error", { op, path, success: false, error: error.message });
            throw new ScimPatchError("invalid_body", `Group member add failed: ${error.message}`);
          }
        }
        await audit(ctx, "scim.patch.applied", "info", { group_id: ctx.groupId, op, path, success: true, count: ids.length });
        results.push({ updated: ids.length, path, value: ids });
      } else if (op === "remove") {
        if (ids.length > 0) {
          await ctx.supabase
            .from("tenant_group_members")
            .delete()
            .eq("group_id", ctx.groupId)
            .in("user_id", ids);
        }
        await audit(ctx, "scim.patch.applied", "info", { group_id: ctx.groupId, op, path, success: true, count: ids.length });
        results.push({ updated: ids.length, path, value: ids });
      }
      continue;
    }

    // --- User attribute ops ---
    const mapped = userColumnUpdate(path, op, value);
    if (!mapped) {
      await audit(ctx, "scim.patch.unknown_path", "warning", {
        user_id: ctx.userId,
        op,
        path,
      });
      results.push({ updated: 0, path, skipped: true, reason: "unknown_path" });
      continue;
    }

    // Validate email format before writing.
    if (mapped.field === "email" && typeof mapped.value === "string" && !EMAIL_RE.test(mapped.value)) {
      throw new ScimPatchError("invalid_op", `Invalid email format: ${mapped.value}`);
    }

    try {
      if (mapped.table === "profiles") {
        const update = { [mapped.field]: op === "remove" ? null : mapped.value };
        const { error } = await ctx.supabase.from("profiles").update(update).eq("id", ctx.userId);
        if (error) throw new Error(error.message);

        // userName / email changes propagate to auth.users
        if (mapped.field === "email" && typeof mapped.value === "string" && op !== "remove") {
          try {
            await ctx.supabase.auth.admin.updateUserById(ctx.userId, { email: mapped.value });
          } catch {
            // Auth Admin API failure is logged but non-fatal here.
          }
        }
      } else if (mapped.table === "tenant_members") {
        const upd: Record<string, unknown> = {
          [mapped.field]: mapped.value,
          deactivated_at: mapped.field === "active" && mapped.value === false ? new Date().toISOString() : null,
        };
        const { error } = await ctx.supabase
          .from("tenant_members")
          .update(upd)
          .eq("tenant_id", ctx.tenantId)
          .eq("user_id", ctx.userId);
        if (error) throw new Error(error.message);
      }
      await audit(ctx, "scim.patch.applied", "info", {
        user_id: ctx.userId,
        op,
        path,
        success: true,
      });
      results.push({ updated: 1, path, value: mapped.value });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await audit(ctx, "scim.patch.applied", "error", {
        user_id: ctx.userId,
        op,
        path,
        success: false,
        error: msg,
      });
      throw new ScimPatchError("invalid_op", msg);
    }
  }

  return results;
}
