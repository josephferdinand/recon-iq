import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

/**
 * Application owner — the single account that must remain a platform
 * super-admin at all times. Any attempt to revoke, downgrade, or delete
 * roles for this email is rejected server-side, regardless of caller.
 */
const OWNER_EMAIL = "joseph.ferdinand@reconiq.example";

const platformRoleZ = z.enum([
  "platform_admin",
  "platform_member",
  "platform_super_admin",
]);

async function assertPlatformAdmin(context: any) {
  await requirePlatformAdmin(context, { fnName: "platform" });
}

async function assertNotOwner(context: any, userId: string) {
  const { data: prof } = await context.supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (prof?.email && String(prof.email).toLowerCase() === OWNER_EMAIL) {
    throw new Error(
      "This account is the application owner and its platform roles cannot be modified.",
    );
  }
}


export const listPlatformUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data: roles, error: rErr } = await context.supabase
      .from("platform_roles")
      .select("id, user_id, role, granted_at");
    if (rErr) throw new Error(rErr.message);

    const userIds = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
    let profiles: any[] = [];
    if (userIds.length) {
      const { data: profs, error: pErr } = await context.supabase
        .from("profiles")
        .select("id, email, full_name, avatar_url")
        .in("id", userIds);
      if (pErr) throw new Error(pErr.message);
      profiles = profs ?? [];
    }
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const grouped = new Map<string, any>();
    for (const r of roles ?? []) {
      const cur = grouped.get(r.user_id) ?? {
        user_id: r.user_id,
        profile: byId.get(r.user_id) ?? null,
        roles: [] as string[],
        granted_at: r.granted_at,
      };
      cur.roles.push(r.role);
      grouped.set(r.user_id, cur);
    }
    return Array.from(grouped.values());
  });

const FindInput = z.object({ email: z.string().email() });
export const findUserByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => FindInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: prof, error } = await context.supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .ilike("email", data.email)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return prof;
  });

const GrantInput = z.object({
  user_id: z.string().uuid(),
  role: platformRoleZ,

});
export const grantPlatformRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => GrantInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase
      .from("platform_roles")
      .insert({ user_id: data.user_id, role: data.role, granted_by: context.userId });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "platform_role.grant",
      resource_type: "platform_role",
      resource_id: data.user_id,
      context: { role: data.role },
    } as any);
    return { ok: true };
  });

const RevokeInput = z.object({
  user_id: z.string().uuid(),
  role: platformRoleZ,
});
export const revokePlatformRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => RevokeInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    // Owner lock — protects the app owner from accidental or malicious revoke.
    await assertNotOwner(context, data.user_id);
    if (data.user_id === context.userId && data.role === "platform_admin") {
      const { count } = await context.supabase
        .from("platform_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "platform_admin");
      if ((count ?? 0) <= 1) throw new Error("Cannot revoke the last platform administrator.");
    }

    const { error } = await context.supabase
      .from("platform_roles")
      .delete()
      .eq("user_id", data.user_id)
      .eq("role", data.role);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "platform_role.revoke",
      resource_type: "platform_role",
      resource_id: data.user_id,
      context: { role: data.role },
    } as any);
    return { ok: true };
  });

const UpdateTenantInput = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(2).max(80).optional(),
  custom_domain: z.string().max(120).nullable().optional(),
  ai_enabled: z.boolean().optional(),
});
export const updateTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => UpdateTenantInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const patch: any = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.custom_domain !== undefined) patch.custom_domain = data.custom_domain || null;
    if (data.ai_enabled !== undefined) patch.ai_enabled = data.ai_enabled;
    if (!Object.keys(patch).length) return { ok: true };

    const { data: row, error } = await context.supabase
      .from("tenants")
      .update(patch)
      .eq("id", data.tenant_id)
      .select("id, slug")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: row.id,
      tenant_slug: row.slug,
      scope: "platform",
      action: "tenant.update",
      resource_type: "tenant",
      resource_id: row.id,
      context: patch,
    } as any);
    return { ok: true };
  });

export const verifyAuditChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ limit: z.number().int().min(100).max(100000).default(10000) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const startedAt = new Date().toISOString();
    const { data: vData, error } = await context.supabase.rpc("audit_chain_integrity_status", {
      _limit: data.limit,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(vData) ? vData[0] : vData;
    const ok = !!row?.ok;
    const firstBadId: number | null = row?.first_bad_id ?? null;
    const forkCount = Number(row?.fork_count ?? 0);
    const orphanCount = Number(row?.orphan_count ?? 0);
    const headMatchesLatest = !!row?.head_matches_latest;

    // The verifier itself is audited (it appends a row to the chain).
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "audit.chain.verify",
      resource_type: "audit_log",
      resource_id: firstBadId ? String(firstBadId) : null,
      context: {
        ok,
        first_bad_id: firstBadId,
        fork_count: forkCount,
        orphan_count: orphanCount,
        head_matches_latest: headMatchesLatest,
        limit: data.limit,
        started_at: startedAt,
      },
    } as any);

    if (ok || !firstBadId) {
      return {
        ok,
        first_bad_id: null as number | null,
        evidence: null,
        fork_count: forkCount,
        orphan_count: orphanCount,
        head_matches_latest: headMatchesLatest,
        verified_rows: data.limit,
        verified_at: new Date().toISOString(),
      };
    }

    // Fetch full forensic evidence for the first compromised row
    const { data: bad } = await context.supabase
      .from("audit_log")
      .select(
        "id, occurred_at, actor_user_id, actor_email, tenant_id, tenant_slug, scope, action, resource_type, resource_id, context, prev_hash, row_hash",
      )
      .eq("id", firstBadId)
      .maybeSingle();

    const prevRes = bad
      ? await context.supabase
          .from("audit_log")
          .select("id, occurred_at, action, row_hash")
          .lt("id", firstBadId)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null as any };
    const prev = prevRes.data;

    const hex = (b: any) => (typeof b === "string" ? b.replace(/^\\x/, "") : "");
    const expectedPrevHashHex = prev ? hex((prev as any).row_hash) : "";
    const storedPrevHashHex = bad ? hex((bad as any).prev_hash) : "";
    const storedRowHashHex = bad ? hex((bad as any).row_hash) : "";

    const expectedPayload = bad
      ? [
          expectedPrevHashHex,
          (bad as any).actor_user_id ?? "",
          (bad as any).tenant_id ?? "",
          (bad as any).scope,
          (bad as any).action,
          (bad as any).resource_type ?? "",
          (bad as any).resource_id ?? "",
          JSON.stringify((bad as any).context ?? {}),
          (bad as any).occurred_at,
        ].join("|")
      : null;

    return {
      ok: false,
      first_bad_id: firstBadId,
      fork_count: forkCount,
      orphan_count: orphanCount,
      head_matches_latest: headMatchesLatest,
      verified_rows: data.limit,
      verified_at: new Date().toISOString(),
      evidence: {
        compromised_row: bad,
        previous_row: prev,
        expected_prev_hash_hex: expectedPrevHashHex,
        stored_prev_hash_hex: storedPrevHashHex,
        stored_row_hash_hex: storedRowHashHex,
        expected_payload: expectedPayload,
        diagnosis:
          bad && storedPrevHashHex !== expectedPrevHashHex
            ? "prev_hash mismatch — a row was likely inserted, deleted, or reordered before this row"
            : "row_hash mismatch — this row's contents were modified after insert",
      },
    };
  });

const AuditSortColumn = z.enum(["occurred_at", "actor_email", "tenant_slug", "action", "scope"]);
const AuditFilter = z.object({
  tenant_id: z.string().uuid().optional(),
  tenant_slug: z.string().max(80).optional(),
  scope: z.enum(["platform", "tenant", "workspace"]).optional(),
  action_prefix: z.string().max(80).optional(),
  actor_email: z.string().max(120).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).max(100000).default(0),
  sort_column: AuditSortColumn.default("occurred_at"),
  sort_dir: z.enum(["asc", "desc"]).default("desc"),
});
export const listAuditFiltered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => AuditFilter.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const ascending = data.sort_dir === "asc";
    const from = data.offset;
    const to = data.offset + data.limit - 1;
    let q = context.supabase
      .from("audit_log")
      .select("id, occurred_at, actor_email, scope, action, tenant_slug, tenant_id, resource_type, resource_id, context", { count: "exact" })
      .order(data.sort_column, { ascending })
      .range(from, to);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.tenant_slug) q = q.ilike("tenant_slug", `%${data.tenant_slug}%`);
    if (data.scope) q = q.eq("scope", data.scope);
    if (data.action_prefix) q = q.ilike("action", `${data.action_prefix}%`);
    if (data.actor_email) q = q.ilike("actor_email", `%${data.actor_email}%`);
    if (data.since) q = q.gte("occurred_at", data.since);
    if (data.until) q = q.lte("occurred_at", data.until);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, offset: data.offset, limit: data.limit };
  });


/* ---------------- PII Redaction events ---------------- */
// Combined view across both destinations of redactAndAudit:
//   - ai_usage_events    where meta.event_type = 'pii.redaction'
//   - security_events    where event_type      = 'pii.redaction.unattributed'
// Filterable by policy_version, tenant_id, and user (caller) id.
const PiiFilter = z.object({
  policy_version: z.string().max(120).optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().optional(),
  destination: z.enum(["copilot", "agent", "embed", "email"]).optional(),
  include_attributed: z.boolean().default(true),
  include_unattributed: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(200),
});

export const listPiiRedactionEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PiiFilter.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const limit = data.limit;

    type Row = {
      id: string;
      occurred_at: string;
      source: "ai_usage_events" | "security_events";
      tenant_id: string | null;
      user_id: string | null;
      destination: string | null;
      policy_version: string | null;
      counts: Record<string, number>;
      redacted: boolean;
      input_hash: string | null;
      event_type: string;
      severity: string | null;
    };

    const out: Row[] = [];

    if (data.include_attributed) {
      let q = context.supabase
        .from("ai_usage_events")
        .select("id, occurred_at, tenant_id, user_id, meta")
        .contains("meta", { event_type: "pii.redaction" })
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
      if (data.user_id) q = q.eq("user_id", data.user_id);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const m = (r as any).meta ?? {};
        if (data.policy_version && m.policy_version !== data.policy_version) continue;
        if (data.destination && m.destination !== data.destination) continue;
        out.push({
          id: (r as any).id,
          occurred_at: (r as any).occurred_at,
          source: "ai_usage_events",
          tenant_id: (r as any).tenant_id,
          user_id: (r as any).user_id,
          destination: m.destination ?? null,
          policy_version: m.policy_version ?? null,
          counts: m.counts ?? {},
          redacted: !!m.redacted,
          input_hash: m.input_hash ?? null,
          event_type: m.event_type ?? "pii.redaction",
          severity: null,
        });
      }
    }

    if (data.include_unattributed && !data.tenant_id) {
      let q = context.supabase
        .from("security_events")
        .select("id, occurred_at, tenant_id, user_id, event_type, severity, context")
        .eq("event_type", "pii.redaction.unattributed")
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (data.user_id) q = q.eq("user_id", data.user_id);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const c = (r as any).context ?? {};
        if (data.policy_version && c.policy_version !== data.policy_version) continue;
        if (data.destination && c.destination !== data.destination) continue;
        out.push({
          id: (r as any).id,
          occurred_at: (r as any).occurred_at,
          source: "security_events",
          tenant_id: (r as any).tenant_id ?? null,
          user_id: (r as any).user_id ?? null,
          destination: c.destination ?? null,
          policy_version: c.policy_version ?? null,
          counts: c.counts ?? {},
          redacted: !!c.redacted,
          input_hash: c.input_hash ?? null,
          event_type: (r as any).event_type,
          severity: (r as any).severity ?? null,
        });
      }
    }

    out.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    return out.slice(0, limit);
  });

export const listKnownPiiPolicyVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { PII_POLICY_VERSION } = await import("./pii-redact");
    return { current: PII_POLICY_VERSION };
  });

/* =====================================================================
   Platform Invitations — invite people to become platform admins/members
   before they've signed in for the first time.
   ===================================================================== */

const InviteInput = z.object({
  email: z.string().email().max(254),
  full_name: z.string().trim().min(1).max(120).optional(),
  role: platformRoleZ,
  message: z.string().max(2000).optional(),
  send_email: z.boolean().default(true),
});

export const createPlatformInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => InviteInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const emailLower = data.email.trim().toLowerCase();

    const { data: existingProfile } = await context.supabase
      .from("profiles")
      .select("id, email")
      .ilike("email", emailLower)
      .maybeSingle();

    if (existingProfile) {
      const { data: existingRoles } = await context.supabase
        .from("platform_roles")
        .select("role")
        .eq("user_id", (existingProfile as any).id);
      const hasRole = (existingRoles ?? []).some((r: any) => r.role === data.role);
      if (hasRole) return { ok: true, status: "already_member" as const };

      const { error: grantErr } = await context.supabase
        .from("platform_roles")
        .insert({ user_id: (existingProfile as any).id, role: data.role, granted_by: context.userId });
      if (grantErr && !/duplicate/i.test(grantErr.message)) throw new Error(grantErr.message);
      // Seed full_name if provided and profile has none
      if (data.full_name) {
        await context.supabase
          .from("profiles")
          .update({ full_name: data.full_name })
          .eq("id", (existingProfile as any).id)
          .or("full_name.is.null,full_name.eq.");
      }
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId,
        scope: "platform",
        action: "platform_role.grant",
        resource_type: "platform_role",
        resource_id: (existingProfile as any).id,
        context: { role: data.role, source: "invitation_shortcircuit" },
      } as any);
      return { ok: true, status: "granted_existing_user" as const };
    }

    const { data: pending } = await context.supabase
      .from("platform_invitations")
      .select("id, send_count")
      .ilike("email", emailLower)
      .eq("role", data.role)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .maybeSingle();

    let inviteId: string;
    if (pending) {
      inviteId = (pending as any).id;
      const { error } = await context.supabase
        .from("platform_invitations")
        .update({
          message: data.message ?? null,
          full_name: data.full_name ?? null,
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          last_sent_at: new Date().toISOString(),
          send_count: ((pending as any).send_count ?? 1) + 1,
        })
        .eq("id", inviteId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await context.supabase
        .from("platform_invitations")
        .insert({
          email: emailLower,
          role: data.role,
          message: data.message ?? null,
          full_name: data.full_name ?? null,
          invited_by: context.userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      inviteId = (row as any).id;
    }

    let email_sent = false;
    let email_error: string | null = null;
    if (data.send_email) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const origin = process.env.PUBLIC_APP_URL || "https://app.reconiq.example";
        const { error: mailErr } = await (supabaseAdmin as any).auth.admin.inviteUserByEmail(emailLower, {
          redirectTo: `${origin}/auth`,
          data: {
            fvi_platform_role: data.role,
            fvi_invited_by: context.userId,
            fvi_invite_kind: "platform",
            ...(data.full_name ? { full_name: data.full_name, name: data.full_name } : {}),
          },
        });
        if (mailErr && !/already been registered|already registered/i.test(mailErr.message)) {
          email_error = mailErr.message;
        } else {
          email_sent = true;
        }
      } catch (e: any) {
        email_error = e?.message ?? "unknown error";
      }
    }

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "platform_invitation.create",
      resource_type: "platform_invitation",
      resource_id: inviteId,
      context: { email: emailLower, role: data.role, email_sent, email_error },
    } as any);

    return { ok: true, status: "invited" as const, invitation_id: inviteId, email_sent, email_error };
  });

export const listPlatformInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("platform_invitations")
      .select("id, email, full_name, role, message, invited_by, expires_at, accepted_at, accepted_by, revoked_at, last_sent_at, send_count, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const inviterIds = Array.from(new Set(
      (rows ?? []).flatMap((r: any) => [r.invited_by, r.accepted_by]).filter(Boolean),
    ));
    let profiles: any[] = [];
    if (inviterIds.length) {
      const { data: p } = await context.supabase
        .from("profiles").select("id, email, full_name").in("id", inviterIds);
      profiles = p ?? [];
    }
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      inviter: r.invited_by ? byId.get(r.invited_by) ?? null : null,
      acceptor: r.accepted_by ? byId.get(r.accepted_by) ?? null : null,
      status: r.revoked_at
        ? "revoked"
        : r.accepted_at
          ? "accepted"
          : new Date(r.expires_at) < new Date()
            ? "expired"
            : "pending",
    }));
  });

export const revokePlatformInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase
      .from("platform_invitations")
      .update({ revoked_at: new Date().toISOString(), revoked_by: context.userId })
      .eq("id", data.id)
      .is("accepted_at", null);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "platform_invitation.revoke",
      resource_type: "platform_invitation",
      resource_id: data.id,
      context: {},
    } as any);
    return { ok: true };
  });

export const resendPlatformInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: inv, error } = await context.supabase
      .from("platform_invitations")
      .select("id, email, role, accepted_at, revoked_at, send_count")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    if ((inv as any).accepted_at) throw new Error("Invitation already accepted");
    if ((inv as any).revoked_at) throw new Error("Invitation was revoked");

    let email_sent = false;
    let email_error: string | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const origin = process.env.PUBLIC_APP_URL || "https://app.reconiq.example";
      const { error: mailErr } = await (supabaseAdmin as any).auth.admin.inviteUserByEmail((inv as any).email, {
        redirectTo: `${origin}/auth`,
        data: { fvi_platform_role: (inv as any).role, fvi_invite_kind: "platform" },
      });
      if (mailErr && !/already been registered|already registered/i.test(mailErr.message)) {
        email_error = mailErr.message;
      } else {
        email_sent = true;
      }
    } catch (e: any) {
      email_error = e?.message ?? "unknown error";
    }

    await context.supabase
      .from("platform_invitations")
      .update({
        last_sent_at: new Date().toISOString(),
        send_count: ((inv as any).send_count ?? 1) + 1,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", data.id);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "platform_invitation.resend",
      resource_type: "platform_invitation",
      resource_id: data.id,
      context: { email_sent, email_error },
    } as any);
    return { ok: true, email_sent, email_error };
  });
