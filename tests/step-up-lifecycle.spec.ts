// C-3 — step_up_grant_lifecycle audit
//
// The DB-side trigger writes 'granted' on INSERT into step_up_grants and the
// daily pg_cron job writes 'expired'. The 'consumed' transition is owned by
// requireStepUp() in application code, which is what this spec exercises.
import { describe, it, expect } from "vitest";
import { requireStepUp } from "@/lib/step-up.server";

type Call = { table: string; op: string; payload?: unknown };

function mkSupabase(opts: { grant: { id: string; expires_at: string; consumed_at: string | null } | null }) {
  const calls: Call[] = [];
  const supabase = {
    from(table: string) {
      return {
        select: (_c: string) => ({
          eq: (_a: string, _v: unknown) => ({
            eq: (_b: string, _w: unknown) => ({
              is: (_d: string, _e: unknown) => ({
                gt: (_f: string, _g: unknown) => ({
                  order: (_h: string, _o: unknown) => ({
                    limit: (_n: number) => ({
                      maybeSingle: async () => ({ data: opts.grant, error: opts.grant ? null : { message: "no grant" } }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
        update: (payload: unknown) => {
          calls.push({ table, op: "update", payload });
          const updateResult = opts.grant ? [{ id: opts.grant.id }] : [];
          const chain: Record<string, unknown> = {};
          for (const method of ["eq", "is", "gt", "select", "limit"]) {
            chain[method] = () => chain;
          }
          chain.then = (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: updateResult, error: null }).then(resolve);
          return chain as never;
        },
        insert: async (payload: unknown) => {
          calls.push({ table, op: "insert", payload });
          return { error: null };
        },
      };
    },
  };
  return { supabase, calls };
}

describe("C-3 step-up lifecycle consumed write", () => {
  it("requireStepUp marks the grant consumed AND writes lifecycle row", async () => {
    const { supabase, calls } = mkSupabase({
      grant: { id: "g-1", expires_at: new Date(Date.now() + 60_000).toISOString(), consumed_at: null },
    });
    await requireStepUp({ supabase, userId: "u-1" }, "byok.rotate");

    const updates = calls.filter((c) => c.table === "step_up_grants" && c.op === "update");
    expect(updates).toHaveLength(1);
    expect((updates[0].payload as { consumed_at: string }).consumed_at).toBeTruthy();

    const inserts = calls.filter((c) => c.table === "step_up_grant_lifecycle" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].payload as { grant_id: string; action: string; actor_user_id: string };
    expect(payload.grant_id).toBe("g-1");
    expect(payload.action).toBe("consumed");
    expect(payload.actor_user_id).toBe("u-1");
  });

  it("requireStepUp rejects and does NOT write a lifecycle row when no valid grant", async () => {
    const { supabase, calls } = mkSupabase({ grant: null });
    await expect(requireStepUp({ supabase, userId: "u-1" }, "byok.rotate")).rejects.toBeInstanceOf(Response);
    const inserts = calls.filter((c) => c.table === "step_up_grant_lifecycle");
    expect(inserts).toHaveLength(0);
  });
});
