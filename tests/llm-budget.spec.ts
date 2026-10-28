// C6 — LLM cost guardrail tests against the real checkBudget implementation.
import { describe, it, expect } from "vitest";
import { checkBudget } from "@/lib/ai-metering.server";

type State = Record<string, { budget?: { daily?: number; monthly?: number; hardPct?: number }; usage: Array<{ cost_usd: number; created_at: string }> }>;

function mkSb(state: State) {
  return {
    from(table: string) {
      const api: any = {
        _tenant: undefined as string | undefined,
        select() { return api; },
        eq(col: string, v: any) { if (col === "tenant_id") api._tenant = v; return api; },
        gte() { return api; },
        async maybeSingle() {
          if (table === "ai_budgets") {
            const b = state[api._tenant!]?.budget;
            return {
              data: b ? {
                daily_max_tokens: null,
                daily_max_cost_usd: b.daily ?? 50,
                monthly_max_cost_usd: b.monthly ?? 1000,
                hard_stop_at_pct: b.hardPct ?? 100,
              } : null,
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then(resolve: any) {
          if (table === "ai_usage_events") {
            return resolve({ data: state[api._tenant!]?.usage ?? [], error: null });
          }
          return resolve({ data: null, error: null });
        },
      };
      return api;
    },
  } as any;
}

const isoToday = () => new Date().toISOString();

describe("C6 — checkBudget", () => {
  it("under budget: allowed=true", async () => {
    const sb = mkSb({ "t-a": { budget: { daily: 50, monthly: 1000 }, usage: [{ cost_usd: 1.25, created_at: isoToday() }] } });
    const r = await checkBudget(sb, "t-a");
    expect(r.allowed).toBe(true);
  });

  it("at budget: blocked with reason", async () => {
    const sb = mkSb({ "t-a": { budget: { daily: 10, monthly: 1000 }, usage: [{ cost_usd: 10, created_at: isoToday() }] } });
    const r = await checkBudget(sb, "t-a");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/budget reached/i);
  });

  it("per-tenant isolation: tenant A exceeding does not block tenant B", async () => {
    const sb = mkSb({
      "t-a": { budget: { daily: 10, monthly: 1000 }, usage: [{ cost_usd: 99, created_at: isoToday() }] },
      "t-b": { budget: { daily: 10, monthly: 1000 }, usage: [{ cost_usd: 0.1, created_at: isoToday() }] },
    });
    expect((await checkBudget(sb, "t-a")).allowed).toBe(false);
    expect((await checkBudget(sb, "t-b")).allowed).toBe(true);
  });
});
