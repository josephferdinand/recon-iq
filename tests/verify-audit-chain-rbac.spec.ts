/**
 * E2E test: verify_audit_chain RBAC
 * ---------------------------------
 * Confirms that public.verify_audit_chain(integer):
 *   - returns a "permission denied" error for authenticated non-platform-admin users
 *   - executes successfully for platform_admin users
 *   - rejects anon callers entirely (EXECUTE revoked from PUBLIC/anon)
 *
 * Run:
 *   bunx vitest run tests/verify-audit-chain-rbac.spec.ts
 */

// @ts-nocheck — runnable only with live Supabase env vars.
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });

async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

describe("verify_audit_chain · platform-admin RBAC", () => {
  const PW = "Test!12345";
  let platformAdmin: { id: string; email: string };
  let regularUser: { id: string; email: string };

  async function mkUser(prefix: string) {
    const email = `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fvi.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PW, email_confirm: true,
    });
    if (error) throw error;
    return { id: data.user!.id, email };
  }

  beforeAll(async () => {
    platformAdmin = await mkUser("vac-platadmin");
    regularUser = await mkUser("vac-user");
    await admin.from("platform_roles").insert({
      user_id: platformAdmin.id, role: "platform_admin",
    });
  });

  it("rejects anonymous callers (EXECUTE revoked from anon/PUBLIC)", async () => {
    const { error } = await anon.rpc("verify_audit_chain", { _limit: 10 });
    expect(error).toBeTruthy();
    expect(`${error?.message} ${error?.code}`.toLowerCase()).toMatch(/permission|denied|not.*found|42501|42883/);
  });

  it("returns permission denied for a signed-in non-admin user", async () => {
    const client = await signedInClient(regularUser.email, PW);
    const { data, error } = await client.rpc("verify_audit_chain", { _limit: 10 });
    expect(error).toBeTruthy();
    expect(data).toBeNull();
    const blob = `${error?.message ?? ""} ${error?.code ?? ""}`.toLowerCase();
    expect(blob).toMatch(/permission denied|not authorized|forbidden|42501/);
  });

  it("succeeds for a platform_admin user", async () => {
    const client = await signedInClient(platformAdmin.email, PW);
    const { data, error } = await client.rpc("verify_audit_chain", { _limit: 10 });
    expect(error).toBeNull();
    // Function returns a row/table describing chain status; just assert shape exists.
    expect(data).toBeDefined();
  });
});
