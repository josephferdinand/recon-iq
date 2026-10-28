import { describe, it, expect, beforeEach } from "vitest";
import { applyScimPatch, type ScimPatchContext } from "@/lib/scim-patch-apply";

// In-memory mock service-role client. Records all writes for assertions.
function makeMockSupabase() {
  const log: Array<{ table: string; action: string; payload: unknown; where?: unknown }> = [];
  const events: Array<Record<string, unknown>> = [];
  const authCalls: Array<{ id: string; email: string }> = [];

  const builder = (table: string) => {
    const ctx: { where: Record<string, unknown>; in?: { col: string; vals: unknown[] } } = { where: {} };
    const chain = {
      update(payload: unknown) {
        log.push({ table, action: "update", payload, where: ctx.where });
        return { eq(col: string, val: unknown) { ctx.where[col] = val; return this; } };
      },
      insert(payload: unknown) {
        if (table === "security_events") events.push(payload as Record<string, unknown>);
        log.push({ table, action: "insert", payload });
        return Promise.resolve({ error: null });
      },
      upsert(payload: unknown) {
        log.push({ table, action: "upsert", payload });
        return Promise.resolve({ error: null });
      },
      delete() {
        log.push({ table, action: "delete", where: ctx.where });
        return {
          eq(col: string, val: unknown) { ctx.where[col] = val; return this; },
          in(col: string, vals: unknown[]) { ctx.in = { col, vals }; return Promise.resolve({ error: null }); },
        };
      },
    };
    return chain;
  };

  return {
    log, events, authCalls,
    from: (table: string) => builder(table),
    auth: {
      admin: {
        async updateUserById(id: string, attrs: { email: string }) {
          authCalls.push({ id, email: attrs.email });
          return { data: { user: { id, email: attrs.email } }, error: null };
        },
      },
    },
  };
}

const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const ACTOR = "33333333-3333-3333-3333-333333333333";
const GROUP = "44444444-4444-4444-4444-444444444444";
const MEMBER = "55555555-5555-5555-5555-555555555555";

let supabase: ReturnType<typeof makeMockSupabase>;
let ctx: ScimPatchContext;

beforeEach(() => {
  supabase = makeMockSupabase();
  ctx = { supabase, userId: USER, tenantId: TENANT, actorUserId: ACTOR };
});

describe("applyScimPatch", () => {
  it("PATCH active=false disables the user", async () => {
    const r = await applyScimPatch(ctx, [{ op: "replace", path: "active", value: false }]);
    expect(r[0].updated).toBe(1);
    const upd = supabase.log.find((l) => l.table === "tenant_members" && l.action === "update");
    expect(upd).toBeTruthy();
    expect((upd!.payload as Record<string, unknown>).active).toBe(false);
  });

  it("PATCH emails[primary eq true].value updates email", async () => {
    await applyScimPatch(ctx, [
      { op: "replace", path: "emails[primary eq true].value", value: "new@acme.com" },
    ]);
    const upd = supabase.log.find((l) => l.table === "profiles" && l.action === "update");
    expect((upd!.payload as Record<string, unknown>).email).toBe("new@acme.com");
  });

  it("PATCH userName updates auth.users.email", async () => {
    await applyScimPatch(ctx, [{ op: "replace", path: "userName", value: "u@acme.com" }]);
    expect(supabase.authCalls[0]).toEqual({ id: USER, email: "u@acme.com" });
  });

  it("PATCH name.givenName updates profiles.full_name", async () => {
    await applyScimPatch(ctx, [{ op: "replace", path: "name.givenName", value: "Jane" }]);
    const upd = supabase.log.find((l) => l.table === "profiles" && l.action === "update");
    expect((upd!.payload as Record<string, unknown>).full_name).toBe("Jane");
  });

  it("PATCH groups add inserts a tenant_group_members row", async () => {
    const groupCtx: ScimPatchContext = { ...ctx, groupId: GROUP };
    const r = await applyScimPatch(groupCtx, [
      { op: "add", path: "members", value: [{ value: MEMBER }] },
    ]);
    expect(r[0].updated).toBe(1);
    const ups = supabase.log.find((l) => l.table === "tenant_group_members" && l.action === "upsert");
    expect(ups).toBeTruthy();
  });

  it("Unknown path skips the op and writes a warning security_events row", async () => {
    const r = await applyScimPatch(ctx, [
      { op: "replace", path: "nickName", value: "JJ" },
    ]);
    expect(r[0].skipped).toBe(true);
    const warn = supabase.events.find(
      (e) => e.event_type === "scim.patch.unknown_path" && e.severity === "warning",
    );
    expect(warn).toBeTruthy();
  });

  it("PATCH department (enterprise extension) updates profiles.department", async () => {
    await applyScimPatch(ctx, [
      {
        op: "replace",
        path: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.department",
        value: "Finance",
      },
    ]);
    const upd = supabase.log.find(
      (l) => l.table === "profiles" && l.action === "update" && (l.payload as Record<string, unknown>).department === "Finance",
    );
    expect(upd).toBeTruthy();
  });

  it("invalid email format throws ScimPatchError", async () => {
    await expect(
      applyScimPatch(ctx, [{ op: "replace", path: "userName", value: "not-an-email" }]),
    ).rejects.toThrow(/Invalid email/);
  });
});

// Re-export so vitest doesn't tree-shake the schema constant.
export { PATCH_SCHEMA };
