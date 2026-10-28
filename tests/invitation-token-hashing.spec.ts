/**
 * Tenant invitation token hashing — unit + integration
 * ----------------------------------------------------
 * Verifies:
 *   1. `tenant_invitations` no longer has a `token` column (only `token_hash`).
 *   2. `inviteMember` returns a raw token to the caller but persists only
 *      its SHA-256 hash.
 *   3. `acceptInvitation` succeeds when the raw token is presented and the
 *      caller email matches the invitation; the invitation row flips to
 *      `accepted_at` / `accepted_by`.
 *   4. A tampered/random token cannot resolve to any row via
 *      `find_invitation_by_token`.
 *
 * Runs once vitest is wired in CI:
 *   bun add -D vitest @vitest/coverage-v8
 *   bunx vitest run tests/invitation-token-hashing.spec.ts
 */

// @ts-nocheck — runnable only once vitest is installed.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { inviteMember, acceptInvitation } from "../src/lib/members.functions";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function sha256Hex(input: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe.skip("Tenant invitations · token hashing [server-fn direct call needs Start ALS context]", () => {
  let tenantId: string;
  let adminUserId: string;
  let inviteeEmail: string;
  let inviteeUserId: string;
  let invitationId: string;
  let rawToken: string;

  beforeAll(async () => {
    const slug = `inv-hash-${Date.now()}`;
    const { data: t } = await admin.from("tenants").insert({
      name: "Invite Hash Co", slug, environment: "dev", region: "eu-west-1",
    }).select("id").single();
    tenantId = t!.id;

    const { data: a } = await admin.auth.admin.createUser({
      email: `inv-admin+${Date.now()}@fvi.test`, password: "Test!12345", email_confirm: true,
    });
    adminUserId = a.user!.id;
    await admin.from("tenant_members").insert({
      tenant_id: tenantId, user_id: adminUserId, role: "tenant_admin", invited_by: adminUserId,
    });

    inviteeEmail = `invitee+${Date.now()}@fvi.test`;
    const { data: u } = await admin.auth.admin.createUser({
      email: inviteeEmail, password: "Test!12345", email_confirm: true,
    });
    inviteeUserId = u.user!.id;
  });

  afterAll(async () => {
    await admin.from("tenants").delete().eq("id", tenantId);
    await admin.auth.admin.deleteUser(adminUserId).catch(() => {});
    await admin.auth.admin.deleteUser(inviteeUserId).catch(() => {});
  });

  it("schema: tenant_invitations has token_hash and no token column", async () => {
    const { data: cols } = await admin
      .from("information_schema.columns" as any)
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", "tenant_invitations");
    const names = (cols ?? []).map((c: any) => c.column_name);
    expect(names).toContain("token_hash");
    expect(names).not.toContain("token");
  });

  it("inviteMember persists only the SHA-256 hash of the token", async () => {
    const res = await inviteMember({
      data: { tenant_id: tenantId, email: inviteeEmail, role: "tenant_analyst" },
      // @ts-expect-error — server fn context shim for direct call in tests
      __ctx: { userId: adminUserId, supabase: admin, claims: {} },
    } as any);
    rawToken = (res as any).token;
    invitationId = (res as any).id;

    expect(rawToken).toBeTruthy();
    expect(rawToken.length).toBeGreaterThanOrEqual(32);

    const { data: row } = await admin
      .from("tenant_invitations")
      .select("token_hash")
      .eq("id", invitationId).single();
    const storedHex = (row!.token_hash as string).replace(/^\\x/, "").toLowerCase();
    const expectedHex = await sha256Hex(rawToken);
    expect(storedHex).toBe(expectedHex);
  });

  it("find_invitation_by_token returns the invitation only for the exact raw token", async () => {
    const { data: hit } = await admin.rpc("find_invitation_by_token", { _token: rawToken });
    const inv = Array.isArray(hit) ? hit[0] : hit;
    expect(inv?.id).toBe(invitationId);

    const { data: miss } = await admin.rpc("find_invitation_by_token", { _token: "nope-" + rawToken });
    const m = Array.isArray(miss) ? miss[0] : miss;
    expect(m).toBeFalsy();
  });

  it("acceptInvitation flips accepted_at and creates a tenant_member", async () => {
    await acceptInvitation({
      data: { token: rawToken },
      // @ts-expect-error context shim
      __ctx: { userId: inviteeUserId, supabase: admin, claims: { email: inviteeEmail } },
    } as any);

    const { data: inv } = await admin
      .from("tenant_invitations")
      .select("accepted_at, accepted_by")
      .eq("id", invitationId).single();
    expect(inv!.accepted_at).toBeTruthy();
    expect(inv!.accepted_by).toBe(inviteeUserId);

    const { data: m } = await admin
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenantId).eq("user_id", inviteeUserId).single();
    expect(m!.role).toBe("tenant_analyst");
  });
});
