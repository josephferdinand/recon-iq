// SCIM 2.0 endpoint (Users + Groups for Okta / Entra ID / Google).
// Day 1+2 — provisioning via invitations, soft-deactivation, RFC 7644 PATCH,
// single-resource reads, externalId mapping, filter: userName eq "x".
import { createFileRoute } from "@tanstack/react-router";
import { applyGroupPatch, applyUserPatch, parsePatchOperations, parseFilter, evalFilter, type ScimEmail, type ScimPhone } from "@/lib/scim-patch";
import { parseScimPatch, ScimPatchError } from "@/lib/scim-patch-strict";
import { applyScimPatch } from "@/lib/scim-patch-apply";
import { getPublicCorsOrigin } from "@/lib/public-cors";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const SCIM_HEADERS_BASE: Record<string, string> = { "content-type": "application/scim+json" };
const SCIM_HEADERS = SCIM_HEADERS_BASE;
function scimHeaders(request: Request): Record<string, string> {
  const origin = getPublicCorsOrigin(request.headers.get("origin"));
  if (origin) {
    return { ...SCIM_HEADERS_BASE, "access-control-allow-origin": origin };
  }
  return { ...SCIM_HEADERS_BASE };
}

function scimError(status: number, detail: string, scimType?: string, request?: Request) {
  return new Response(JSON.stringify({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  }), { status, headers: scimHeaders(request ?? ({} as any)) });
}
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: SCIM_HEADERS });

async function authenticate(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const hash = await sha256Hex(m[1].trim());
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("scim_tokens").select("id, tenant_id, is_active, expires_at")
    .eq("token_hash", hash).maybeSingle();
  if (!row || !row.is_active) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  await supabaseAdmin.from("scim_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { tenant_id: row.tenant_id as string, token_id: row.id as string };
}

async function logSync(token_id: string, tenant_id: string, resource_type: string, operation: string, status: number, payload?: any, error?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("scim_sync_log").insert({
    tenant_id, token_id, resource_type, operation,
    status_code: status, payload: payload ?? null, error: error ?? null,
  } as any);
}

// ----- helpers ---------------------------------------------------------------

type Ctx = { tenant_id: string; token_id: string };

function parsePath(splat: string) {
  const parts = splat.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  return { resource: parts[0] ?? "", id: parts[1] ?? "" };
}

// Parse SCIM filter — first try simple eq for fast DB-side filtering,
// otherwise return AST for in-memory eval (RFC 7644 §3.4.2.2 grammar).
function parseSimpleFilter(filter: string | null) {
  if (!filter) return null;
  const m = filter.match(/^\s*(userName|externalId)\s+eq\s+"([^"]+)"\s*$/i);
  return m ? { attr: m[1].toLowerCase() as "username" | "externalid", value: m[2] } : null;
}

function paginate<T>(rows: T[], startIndex: number, count: number) {
  const total = rows.length;
  const start = Math.max(1, startIndex);
  const slice = count <= 0 ? [] : rows.slice(start - 1, start - 1 + count);
  return { total, start, slice };
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function lookupExternal(ctx: Ctx, resource_type: "User" | "Group", external_id: string) {
  const admin = await getAdmin();
  const { data } = await admin.from("scim_external_ids")
    .select("internal_id,external_id,user_name")
    .eq("tenant_id", ctx.tenant_id).eq("resource_type", resource_type).eq("external_id", external_id)
    .maybeSingle();
  return data ?? null;
}

async function userResource(ctx: Ctx, user_id: string) {
  const admin = await getAdmin();
  const { data: m } = await admin
    .from("tenant_members")
    .select("user_id, role, joined_at, active, deactivated_at, profile:profiles(email, full_name, phone)")
    .eq("tenant_id", ctx.tenant_id).eq("user_id", user_id).maybeSingle();
  if (!m) return null;
  const { data: ext } = await admin.from("scim_external_ids")
    .select("external_id").eq("tenant_id", ctx.tenant_id).eq("resource_type", "User").eq("internal_id", user_id).maybeSingle();
  const profile = (m as any).profile ?? {};
  const phones = profile.phone ? [{ value: profile.phone, primary: true, type: "work" }] : [];
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: m.user_id,
    externalId: ext?.external_id ?? undefined,
    userName: profile.email,
    name: { formatted: profile.full_name ?? profile.email },
    displayName: profile.full_name ?? profile.email,
    emails: profile.email ? [{ value: profile.email, primary: true, type: "work" }] : [],
    phoneNumbers: phones,
    active: (m as any).active !== false,
    meta: { resourceType: "User", created: m.joined_at, location: `/api/public/scim/v2/Users/${m.user_id}` },
  };
}

async function groupResource(ctx: Ctx, group_id: string) {
  const admin = await getAdmin();
  const { data: g } = await admin.from("tenant_groups")
    .select("id, name, created_at, members:tenant_group_members(user_id)")
    .eq("tenant_id", ctx.tenant_id).eq("id", group_id).maybeSingle();
  if (!g) return null;
  const { data: ext } = await admin.from("scim_external_ids")
    .select("external_id").eq("tenant_id", ctx.tenant_id).eq("resource_type", "Group").eq("internal_id", group_id).maybeSingle();
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: g.id,
    externalId: ext?.external_id ?? undefined,
    displayName: g.name,
    members: ((g as any).members ?? []).map((m: any) => ({ value: m.user_id, type: "User" })),
    meta: { resourceType: "Group", created: g.created_at, location: `/api/public/scim/v2/Groups/${g.id}` },
  };
}

// Resolve internal user id from either a ReconIQ user UUID or an external id.
async function resolveUserId(ctx: Ctx, id: string): Promise<string | null> {
  const admin = await getAdmin();
  // Try as internal id
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const { data } = await admin.from("tenant_members")
      .select("user_id").eq("tenant_id", ctx.tenant_id).eq("user_id", id).maybeSingle();
    if (data) return data.user_id;
  }
  const ext = await lookupExternal(ctx, "User", id);
  return ext?.internal_id ?? null;
}

async function resolveGroupId(ctx: Ctx, id: string): Promise<string | null> {
  const admin = await getAdmin();
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const { data } = await admin.from("tenant_groups")
      .select("id").eq("tenant_id", ctx.tenant_id).eq("id", id).maybeSingle();
    if (data) return data.id;
  }
  const ext = await lookupExternal(ctx, "Group", id);
  return ext?.internal_id ?? null;
}

// ----- handlers --------------------------------------------------------------

async function handleGet(ctx: Ctx, request: Request, splat: string) {
  const admin = await getAdmin();  const { resource, id } = parsePath(splat);

  if (resource === "ServiceProviderConfig") {
    return ok({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true }, bulk: { supported: false },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false },
      authenticationSchemes: [{ type: "oauthbearertoken", name: "OAuth Bearer Token", description: "SCIM token" }],
      meta: { location: "/api/public/scim/v2/ServiceProviderConfig", resourceType: "ServiceProviderConfig" },
    });
  }

  if (resource === "ResourceTypes") {
    return ok({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 2,
      Resources: [
        { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: "urn:ietf:params:scim:schemas:core:2.0:User" },
        { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "Group", name: "Group", endpoint: "/Groups", schema: "urn:ietf:params:scim:schemas:core:2.0:Group" },
      ],
    });
  }

  if (resource === "Schemas") {
    const userSchema = {
      id: "urn:ietf:params:scim:schemas:core:2.0:User",
      name: "User", description: "ReconIQ User",
      attributes: [
        { name: "userName", type: "string", required: true, uniqueness: "server", mutability: "readWrite", returned: "default" },
        { name: "active", type: "boolean", required: false, mutability: "readWrite", returned: "default" },
        { name: "displayName", type: "string", mutability: "readWrite", returned: "default" },
        { name: "externalId", type: "string", mutability: "readWrite", returned: "default" },
        { name: "name", type: "complex", subAttributes: [
          { name: "formatted", type: "string" }, { name: "givenName", type: "string" }, { name: "familyName", type: "string" },
        ]},
        { name: "emails", type: "complex", multiValued: true, subAttributes: [
          { name: "value", type: "string" }, { name: "type", type: "string" }, { name: "primary", type: "boolean" },
        ]},
        { name: "phoneNumbers", type: "complex", multiValued: true, subAttributes: [
          { name: "value", type: "string" }, { name: "type", type: "string" }, { name: "primary", type: "boolean" },
        ]},
      ],
    };
    const groupSchema = {
      id: "urn:ietf:params:scim:schemas:core:2.0:Group",
      name: "Group", description: "ReconIQ Group",
      attributes: [
        { name: "displayName", type: "string", required: true, mutability: "readWrite", returned: "default" },
        { name: "externalId", type: "string", mutability: "readWrite", returned: "default" },
        { name: "members", type: "complex", multiValued: true, subAttributes: [
          { name: "value", type: "string" }, { name: "display", type: "string" }, { name: "type", type: "string" },
        ]},
      ],
    };
    if (id) {
      const match = id === "urn:ietf:params:scim:schemas:core:2.0:User" ? userSchema
        : id === "urn:ietf:params:scim:schemas:core:2.0:Group" ? groupSchema : null;
      if (!match) return scimError(404, `Schema ${id} not found`);
      return ok(match);
    }
    return ok({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 2, Resources: [userSchema, groupSchema], startIndex: 1, itemsPerPage: 2,
    });
  }

  // ---- pagination + filter (Users / Groups list) ----
  const url = new URL(request.url);
  const startIndex = Math.max(1, parseInt(url.searchParams.get("startIndex") ?? "1", 10) || 1);
  const count = Math.max(0, Math.min(200, parseInt(url.searchParams.get("count") ?? "100", 10) || 100));
  const rawFilter = url.searchParams.get("filter");

  if (resource === "Users") {
    if (id) {
      const uid = await resolveUserId(ctx, id);
      if (!uid) return scimError(404, `User ${id} not found`);
      const r = await userResource(ctx, uid);
      await logSync(ctx.token_id, ctx.tenant_id, "Users", "read", 200);
      return ok(r);
    }
    const simple = parseSimpleFilter(rawFilter);
    let q = admin.from("tenant_members")
      .select("user_id, role, joined_at, active, profile:profiles(email, full_name, phone)")
      .eq("tenant_id", ctx.tenant_id);
    if (simple?.attr === "username") q = q.eq("profile.email", simple.value);
    const { data: members } = await q;
    let rows = members ?? [];
    if (simple?.attr === "externalid") {
      const ext = await lookupExternal(ctx, "User", simple.value);
      rows = ext ? rows.filter((m: any) => m.user_id === ext.internal_id) : [];
    }
    let resources = await Promise.all(rows.map((m: any) => userResource(ctx, m.user_id)));
    if (rawFilter && !simple) {
      try {
        const ast = parseFilter(rawFilter);
        resources = resources.filter((r) => r && evalFilter(ast, r));
      } catch (e: any) {
        return scimError(400, `Invalid filter: ${e?.message ?? "parse error"}`, "invalidFilter");
      }
    }
    const { total, start, slice } = paginate(resources, startIndex, count);
    await logSync(ctx.token_id, ctx.tenant_id, "Users", "list", 200);
    return ok({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: total, Resources: slice, startIndex: start, itemsPerPage: slice.length,
    });
  }

  if (resource === "Groups") {
    if (id) {
      const gid = await resolveGroupId(ctx, id);
      if (!gid) return scimError(404, `Group ${id} not found`);
      const r = await groupResource(ctx, gid);
      await logSync(ctx.token_id, ctx.tenant_id, "Groups", "read", 200);
      return ok(r);
    }
    const { data: groups } = await admin.from("tenant_groups")
      .select("id").eq("tenant_id", ctx.tenant_id);
    let resources = await Promise.all((groups ?? []).map((g: any) => groupResource(ctx, g.id)));
    if (rawFilter) {
      try {
        const ast = parseFilter(rawFilter);
        resources = resources.filter((r) => r && evalFilter(ast, r));
      } catch (e: any) {
        return scimError(400, `Invalid filter: ${e?.message ?? "parse error"}`, "invalidFilter");
      }
    }
    const { total, start, slice } = paginate(resources, startIndex, count);
    await logSync(ctx.token_id, ctx.tenant_id, "Groups", "list", 200);
    return ok({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: total, Resources: slice, startIndex: start, itemsPerPage: slice.length,
    });
  }

  return scimError(404, `Unknown resource: ${resource}`);
}

async function handlePost(ctx: Ctx, request: Request, splat: string) {
  const admin = await getAdmin();
  const { resource } = parsePath(splat);
  let body: any;
  try { body = await request.json(); }
  catch { return scimError(400, "Request body must be valid JSON", "invalidSyntax"); }

  if (resource === "Users") {
    const email = String(body.userName ?? body.emails?.[0]?.value ?? "").trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      await logSync(ctx.token_id, ctx.tenant_id, "Users", "create", 400, body, "invalid userName");
      return scimError(400, "userName must be a valid email", "invalidValue");
    }
    const externalId = body.externalId ? String(body.externalId) : null;
    const fullName = body.name?.formatted
      ?? [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ")
      ?? body.displayName ?? null;

    // If already a member by email, return that record
    const { data: existingMember } = await admin
      .from("tenant_members")
      .select("user_id, profile:profiles!inner(email)")
      .eq("tenant_id", ctx.tenant_id).eq("profile.email", email).maybeSingle();

    let internalId: string | null = (existingMember as any)?.user_id ?? null;

    if (!internalId) {
      // Resolve tenant-configured default_role; fall back to tenant_member.
      const { data: scimCfg } = await admin
        .from("scim_provisioning_settings").select("default_role")
        .eq("tenant_id", ctx.tenant_id).maybeSingle();
      const role = (scimCfg as any)?.default_role ?? "tenant_member";
      // Create a tenant invitation so the user can claim membership at first login.
      const { error: invErr } = await admin.from("tenant_invitations").insert({
        tenant_id: ctx.tenant_id, email, role,
      } as any);
      if (invErr && !/duplicate/i.test(invErr.message)) {
        await logSync(ctx.token_id, ctx.tenant_id, "Users", "create", 500, body, invErr.message);
        return scimError(500, invErr.message);
      }
      // Use a deterministic placeholder id derived from email until the user accepts.
      // Note: external_id mapping is keyed by external_id, so this still resolves.
      internalId = crypto.randomUUID();
    }

    if (externalId) {
      // Uniqueness check on externalId per RFC 7643 §7
      const { data: clash } = await admin.from("scim_external_ids")
        .select("internal_id").eq("tenant_id", ctx.tenant_id).eq("resource_type", "User")
        .eq("external_id", externalId).maybeSingle();
      if (clash && clash.internal_id !== internalId) {
        await logSync(ctx.token_id, ctx.tenant_id, "Users", "create", 409, body, "externalId uniqueness");
        return scimError(409, `externalId ${externalId} already mapped to a different user`, "uniqueness");
      }
      await admin.from("scim_external_ids").upsert({
        tenant_id: ctx.tenant_id, resource_type: "User",
        external_id: externalId, internal_id: internalId, user_name: email, token_id: ctx.token_id,
      } as any, { onConflict: "tenant_id,resource_type,external_id" });
    }

    // Optional phone on create (Okta/Entra send phoneNumbers[])
    const phone = Array.isArray(body.phoneNumbers) && body.phoneNumbers[0]?.value
      ? String(body.phoneNumbers[0].value) : null;
    if (phone) await admin.from("profiles").update({ phone }).eq("id", internalId);

    await logSync(ctx.token_id, ctx.tenant_id, "Users", "create", 201, body);
    return ok({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: internalId, externalId: externalId ?? undefined,
      userName: email, displayName: fullName ?? email,
      name: { formatted: fullName ?? email },
      emails: [{ value: email, primary: true, type: "work" }],
      phoneNumbers: phone ? [{ value: phone, primary: true, type: "work" }] : [],
      active: true,
      meta: { resourceType: "User", created: new Date().toISOString(), location: `/api/public/scim/v2/Users/${internalId}` },
    }, 201);
  }

  if (resource === "Groups") {
    const name = String(body.displayName ?? "").trim();
    if (!name) return scimError(400, "displayName required", "invalidValue");
    const externalId = body.externalId ? String(body.externalId) : null;
    const { data: row, error } = await admin.from("tenant_groups")
      .insert({ tenant_id: ctx.tenant_id, name } as any).select("id, created_at").single();
    if (error) {
      await logSync(ctx.token_id, ctx.tenant_id, "Groups", "create", 500, body, error.message);
      return scimError(500, "Internal error");
    }
    if (externalId) {
      await admin.from("scim_external_ids").upsert({
        tenant_id: ctx.tenant_id, resource_type: "Group",
        external_id: externalId, internal_id: row.id, token_id: ctx.token_id,
      } as any, { onConflict: "tenant_id,resource_type,external_id" });
    }
    // Add initial members if supplied — filter to tenant members only.
    const rawMemberIds = Array.isArray(body.members)
      ? body.members.map((m: any) => String(m?.value ?? m)).filter(Boolean) : [];
    let memberIds: string[] = [];
    if (rawMemberIds.length > 0) {
      const { data: valid } = await admin.from("tenant_members")
        .select("user_id").eq("tenant_id", ctx.tenant_id).in("user_id", rawMemberIds);
      memberIds = (valid ?? []).map((r: any) => r.user_id);
    }
    if (memberIds.length > 0) {
      await admin.from("tenant_group_members").insert(
        memberIds.map((uid: string) => ({ group_id: row.id, user_id: uid })) as any
      );
    }
    await logSync(ctx.token_id, ctx.tenant_id, "Groups", "create", 201, body);
    const r = await groupResource(ctx, row.id);
    return ok(r, 201);
  }

  return scimError(404, `Unknown resource: ${resource}`);
}

async function handlePatch(ctx: Ctx, request: Request, splat: string) {
  const admin = await getAdmin();
  const { resource, id } = parsePath(splat);
  if (!id) return scimError(400, "PATCH requires resource id");
  let body: any;
  try { body = await request.json(); }
  catch { return scimError(400, "Request body must be valid JSON", "invalidSyntax"); }

  // RFC 7644 §3.5.2 strict validation up-front. Returns typed errors.
  let strictOps;
  try {
    strictOps = parseScimPatch(body).Operations;
  } catch (e) {
    if (e instanceof ScimPatchError) {
      await logSync(ctx.token_id, ctx.tenant_id, resource, "patch", 400, body, `${e.code}: ${e.message}`);
      const scimType = e.code === "invalid_op" || e.code === "missing_value" || e.code === "missing_path"
        ? "invalidValue" : "invalidSyntax";
      return scimError(400, e.message, scimType);
    }
    throw e;
  }

  const ops = parsePatchOperations(body);
  if (ops.length === 0) return scimError(400, "Operations array required", "invalidSyntax");

  if (resource === "Users") {
    const uid = await resolveUserId(ctx, id);
    if (!uid) return scimError(404, `User ${id} not found`);
    // Per-op audit + auth.users propagation + enterprise extension writes.
    try {
      await applyScimPatch(
        { supabase: admin, userId: uid, tenantId: ctx.tenant_id, actorUserId: null },
        strictOps,
      );
    } catch (e) {
      if (e instanceof ScimPatchError) {
        await logSync(ctx.token_id, ctx.tenant_id, "Users", "patch", 400, { ops: strictOps }, e.message);
        return scimError(400, e.message, "invalidValue");
      }
      throw e;
    }
    const patch = applyUserPatch(ops);

    const memberUpd: any = {};
    if (typeof patch.active === "boolean") {
      memberUpd.active = patch.active;
      memberUpd.deactivated_at = patch.active ? null : new Date().toISOString();
    }
    if (Object.keys(memberUpd).length > 0) {
      await admin.from("tenant_members").update(memberUpd)
        .eq("tenant_id", ctx.tenant_id).eq("user_id", uid);
    }

    // Profile fields
    const fullName = patch.formattedName
      ?? (patch.givenName || patch.familyName ? [patch.givenName, patch.familyName].filter(Boolean).join(" ") : undefined)
      ?? patch.displayName;
    if (fullName) {
      await admin.from("profiles").update({ full_name: fullName }).eq("id", uid);
    }

    if (patch.externalId) {
      const { data: clash } = await admin.from("scim_external_ids")
        .select("internal_id").eq("tenant_id", ctx.tenant_id).eq("resource_type", "User")
        .eq("external_id", patch.externalId).maybeSingle();
      if (clash && clash.internal_id !== uid) {
        await logSync(ctx.token_id, ctx.tenant_id, "Users", "patch", 409, { ops }, "externalId uniqueness");
        return scimError(409, `externalId ${patch.externalId} already mapped to a different user`, "uniqueness");
      }
      await admin.from("scim_external_ids").upsert({
        tenant_id: ctx.tenant_id, resource_type: "User",
        external_id: patch.externalId, internal_id: uid, token_id: ctx.token_id,
      } as any, { onConflict: "tenant_id,resource_type,external_id" });
    }

    // Phone: replace-set takes precedence; otherwise first added wins; remove clears matching
    const phoneUpd: { phone?: string | null } = {};
    if (patch.phoneNumbers !== undefined) {
      phoneUpd.phone = patch.phoneNumbers[0]?.value ?? null;
    } else if (patch.addPhones.length > 0) {
      phoneUpd.phone = patch.addPhones[0].value;
    } else if (patch.removePhones.length > 0) {
      phoneUpd.phone = null;
    }
    if (Object.keys(phoneUpd).length > 0) {
      await admin.from("profiles").update(phoneUpd).eq("id", uid);
    }

    await logSync(ctx.token_id, ctx.tenant_id, "Users", "patch", 200, { ops, patch });
    const r = await userResource(ctx, uid);
    return ok(r);
  }

  if (resource === "Groups") {
    const gid = await resolveGroupId(ctx, id);
    if (!gid) return scimError(404, `Group ${id} not found`);
    const patch = applyGroupPatch(ops);

    if (patch.displayName) {
      await admin.from("tenant_groups").update({ name: patch.displayName }).eq("id", gid);
    }

    // 409 if removeMembers references a non-member (RFC 7644 noTarget)
    if (patch.removeMembers.length > 0) {
      const { data: existing } = await admin.from("tenant_group_members")
        .select("user_id").eq("group_id", gid).in("user_id", patch.removeMembers);
      const have = new Set((existing ?? []).map((r: any) => r.user_id));
      const missing = patch.removeMembers.filter((u) => !have.has(u));
      if (missing.length > 0) {
        await logSync(ctx.token_id, ctx.tenant_id, "Groups", "patch", 409, { ops }, `noTarget: ${missing.join(",")}`);
        return scimError(409, `Cannot remove non-member(s): ${missing.join(", ")}`, "noTarget");
      }
    }

    async function filterTenantMembers(uids: string[]): Promise<string[]> {
      if (uids.length === 0) return [];
      const { data: valid } = await admin.from("tenant_members")
        .select("user_id").eq("tenant_id", ctx.tenant_id).in("user_id", uids);
      return (valid ?? []).map((r: any) => r.user_id);
    }
    if (patch.replaceMembers !== undefined) {
      await admin.from("tenant_group_members").delete().eq("group_id", gid);
      const safeReplace = await filterTenantMembers(patch.replaceMembers);
      if (safeReplace.length > 0) {
        await admin.from("tenant_group_members").insert(
          safeReplace.map((uid) => ({ group_id: gid, user_id: uid })) as any
        );
      }
    }
    if (patch.addMembers.length > 0) {
      const safeAdd = await filterTenantMembers(patch.addMembers);
      if (safeAdd.length > 0) {
        await admin.from("tenant_group_members").upsert(
          safeAdd.map((uid) => ({ group_id: gid, user_id: uid })) as any,
          { onConflict: "group_id,user_id" }
        );
      }
    }
    if (patch.removeMembers.length > 0) {
      await admin.from("tenant_group_members").delete()
        .eq("group_id", gid).in("user_id", patch.removeMembers);
    }

    await logSync(ctx.token_id, ctx.tenant_id, "Groups", "patch", 200, { ops, patch });
    const r = await groupResource(ctx, gid);
    return ok(r);
  }

  return scimError(404, `Unknown resource: ${resource}`);
}

async function handleDelete(ctx: Ctx, splat: string) {
  const admin = await getAdmin();
  const { resource, id } = parsePath(splat);
  if (!id) return scimError(400, "DELETE requires resource id");

  if (resource === "Users") {
    const uid = await resolveUserId(ctx, id);
    if (!uid) return scimError(404, `User ${id} not found`);
    // Soft deactivate — preserve audit history per SOC 2.
    await admin.from("tenant_members")
      .update({ active: false, deactivated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenant_id).eq("user_id", uid);
    await logSync(ctx.token_id, ctx.tenant_id, "Users", "delete", 204);
    return new Response(null, { status: 204 });
  }

  if (resource === "Groups") {
    const gid = await resolveGroupId(ctx, id);
    if (!gid) return scimError(404, `Group ${id} not found`);
    await admin.from("tenant_groups").delete().eq("id", gid).eq("tenant_id", ctx.tenant_id);
    await logSync(ctx.token_id, ctx.tenant_id, "Groups", "delete", 204);
    return new Response(null, { status: 204 });
  }

  return scimError(404, `Unknown resource: ${resource}`);
}

export const Route = createFileRoute("/api/public/scim/v2/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await authenticate(request); if (!ctx) return scimError(401, "Unauthorized", undefined, request);
        try { return await handleGet(ctx, request, params._splat ?? ""); }
        catch { return scimError(500, "Internal error", undefined, request); }
      },
      POST: async ({ request, params }) => {
        const ctx = await authenticate(request); if (!ctx) return scimError(401, "Unauthorized", undefined, request);
        try { return await handlePost(ctx, request, params._splat ?? ""); }
        catch { return scimError(500, "Internal error", undefined, request); }
      },
      PATCH: async ({ request, params }) => {
        const ctx = await authenticate(request); if (!ctx) return scimError(401, "Unauthorized", undefined, request);
        try { return await handlePatch(ctx, request, params._splat ?? ""); }
        catch { return scimError(500, "Internal error", undefined, request); }
      },
      PUT: async ({ request, params }) => {
        const ctx = await authenticate(request); if (!ctx) return scimError(401, "Unauthorized", undefined, request);
        try {
          const body = await request.json().catch(() => ({}));
          const wrapped = { Operations: [{ op: "replace", value: body }] };
          const fakeRequest = new Request(request.url, { method: "PATCH", headers: request.headers, body: JSON.stringify(wrapped) });
          return await handlePatch(ctx, fakeRequest, params._splat ?? "");
        } catch { return scimError(500, "Internal error", undefined, request); }
      },
      DELETE: async ({ request, params }) => {
        const ctx = await authenticate(request); if (!ctx) return scimError(401, "Unauthorized", undefined, request);
        try { return await handleDelete(ctx, params._splat ?? ""); }
        catch { return scimError(500, "Internal error", undefined, request); }
      },
    },
  },
});
