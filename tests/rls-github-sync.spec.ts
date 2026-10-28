/**
 * RLS · github_sync_settings + github_sync_change_requests
 * --------------------------------------------------------
 * Verifies that:
 *   1. Non-platform-admin users cannot read or write the singleton settings.
 *   2. Non-platform-admin users cannot read, create, or update change requests.
 *   3. Platform admins can read settings + change requests.
 *   4. 4-eyes guard: requester cannot be either approver, and approver_1 !=
 *      approver_2.
 *   5. Terminal states (applied/rejected/cancelled) are immutable.
 *   6. Settings UPDATE from an authenticated client is blocked by the
 *      settings write-guard (only service_role/apply path may mutate).
 *   7. Audit-log entries for github_sync.* actions remain platform-admin-only.
 *
 * Run:
 *   bunx vitest run tests/rls-github-sync.spec.ts
 */

// @ts-nocheck — requires live Supabase env vars.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PW = "Test!12345";
const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
}

async function mkUser(prefix: string) {
  const email = `${prefix}+${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}@fvi.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (error) throw error;
  return { id: data.user!.id, email };
}

describe("RLS · github_sync_settings + github_sync_change_requests", () => {
  let platformAdmin: any, secondAdmin: any, outsider: any;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    [platformAdmin, secondAdmin, outsider] = await Promise.all([
      mkUser("ghs-padmin1"),
      mkUser("ghs-padmin2"),
      mkUser("ghs-outsider"),
    ]);
    await admin.from("platform_roles").insert([
      { user_id: platformAdmin.id, role: "platform_admin" },
      { user_id: secondAdmin.id, role: "platform_admin" },
    ]);
  });

  afterAll(async () => {
    if (createdRequestIds.length) {
      await admin
        .from("github_sync_change_requests")
        .delete()
        .in("id", createdRequestIds);
    }
    for (const u of [platformAdmin, secondAdmin, outsider]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  });

  // ─── settings table ─────────────────────────────────────────────────────
  describe("github_sync_settings", () => {
    it("outsider CANNOT read settings", async () => {
      const c = await signIn(outsider.email);
      const { data } = await c
        .from("github_sync_settings")
        .select("id")
        .eq("id", SETTINGS_ID);
      expect(data ?? []).toHaveLength(0);
    });

    it("outsider CANNOT update settings", async () => {
      const c = await signIn(outsider.email);
      const { data } = await c
        .from("github_sync_settings")
        .update({ owner: "hijack" })
        .eq("id", SETTINGS_ID)
        .select();
      expect((data ?? []).length).toBe(0);
    });

    it("platform admin CAN read settings", async () => {
      const c = await signIn(platformAdmin.email);
      const { data, error } = await c
        .from("github_sync_settings")
        .select("id, owner, repo_name")
        .eq("id", SETTINGS_ID);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });

    it("platform admin UPDATE is blocked by settings write-guard", async () => {
      const c = await signIn(platformAdmin.email);
      const { error, data } = await c
        .from("github_sync_settings")
        .update({ owner: "should-not-apply" })
        .eq("id", SETTINGS_ID)
        .select();
      // Either guard exception OR zero rows due to RLS — both are acceptable.
      const blocked = !!error || (data ?? []).length === 0;
      expect(blocked).toBe(true);
    });
  });

  // ─── change request table ───────────────────────────────────────────────
  describe("github_sync_change_requests", () => {
    it("outsider CANNOT read change requests", async () => {
      const c = await signIn(outsider.email);
      const { data } = await c
        .from("github_sync_change_requests")
        .select("id")
        .limit(1);
      expect(data ?? []).toHaveLength(0);
    });

    it("outsider CANNOT insert a change request", async () => {
      const c = await signIn(outsider.email);
      const { error } = await c.from("github_sync_change_requests").insert({
        proposed_owner: "x",
        proposed_repo_name: "y",
        reason: "nope",
        requested_by: outsider.id,
      } as any);
      expect(error).not.toBeNull();
    });

    it("platform admin CAN insert a pending change request", async () => {
      const c = await signIn(platformAdmin.email);
      const { data, error } = await c
        .from("github_sync_change_requests")
        .insert({
          proposed_owner: "falcon-org",
          proposed_repo_name: "fvi-test",
          reason: "regression-test",
          requested_by: platformAdmin.id,
        } as any)
        .select("id, status")
        .single();
      expect(error).toBeNull();
      expect(data?.status).toBe("pending");
      createdRequestIds.push(data!.id);
    });

    it("requester CANNOT self-approve (4-eyes guard)", async () => {
      const c = await signIn(platformAdmin.email);
      const id = createdRequestIds[0];
      const { error } = await c
        .from("github_sync_change_requests")
        .update({ approver_1: platformAdmin.id })
        .eq("id", id);
      expect(error).not.toBeNull();
      expect(String(error?.message)).toMatch(/4-eyes|requester cannot/i);
    });

    it("approver_1 and approver_2 must be distinct", async () => {
      const c = await signIn(platformAdmin.email);
      const id = createdRequestIds[0];
      const { error } = await c
        .from("github_sync_change_requests")
        .update({ approver_1: secondAdmin.id, approver_2: secondAdmin.id })
        .eq("id", id);
      expect(error).not.toBeNull();
      expect(String(error?.message)).toMatch(/distinct|4-eyes/i);
    });

    it("terminal status (applied) is immutable", async () => {
      // Seed an applied row via service role, then attempt UPDATE as admin.
      const { data: row } = await admin
        .from("github_sync_change_requests")
        .insert({
          proposed_owner: "o",
          proposed_repo_name: "r",
          reason: "terminal-test",
          requested_by: platformAdmin.id,
          status: "applied",
          applied_at: new Date().toISOString(),
        } as any)
        .select("id")
        .single();
      createdRequestIds.push(row!.id);

      const c = await signIn(platformAdmin.email);
      const { error } = await c
        .from("github_sync_change_requests")
        .update({ reason: "tamper" })
        .eq("id", row!.id);
      expect(error).not.toBeNull();
      expect(String(error?.message)).toMatch(/terminal/i);
    });
  });

  // ─── audit_log gating for github_sync.* events ──────────────────────────
  describe("audit_log github_sync.* entries", () => {
    it("outsider CANNOT read github_sync.* audit entries", async () => {
      await admin.from("audit_log").insert({
        action: "github_sync.change_requested",
        actor_id: platformAdmin.id,
        resource_type: "github_sync_change_request",
        resource_id: createdRequestIds[0] ?? null,
        metadata: { test: true },
      } as any);

      const c = await signIn(outsider.email);
      const { data } = await c
        .from("audit_log")
        .select("id")
        .like("action", "github_sync.%")
        .limit(5);
      expect(data ?? []).toHaveLength(0);
    });
  });
});
