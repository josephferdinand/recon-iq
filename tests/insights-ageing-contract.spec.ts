import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate: (data: unknown) => unknown = (data) => data;
  const chain = { middleware: () => chain, validator: (fn: typeof validate) => { validate = fn; return chain; }, handler: (fn: any) => (input: any) => fn({ ...input, data: validate(input.data) }) };
  return chain;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
import { AGEING_READ_LIMIT, buildAgeingObservation, computeAgeing } from "@/lib/batch-bc.functions";
const now = Date.parse("2026-10-02T12:00:00Z");
const row = (id: string, days: number, payload: unknown) => ({ id, created_at: new Date(now - days * 86400000).toISOString(), payload });
function client(data: unknown, error: unknown = null) {
  const query: any = {};
  for (const method of ["select", "eq", "not", "order", "lte"]) query[method] = vi.fn(() => query);
  query.range = vi.fn(async () => ({ data, error }));
  const from = vi.fn(() => query);
  return { supabase: { from, rpc: vi.fn(async () => ({ data: { as_of: new Date(now).toISOString(), totals: { open: 2501 }, ageing: [{ name: "90+", count: 2501 }] }, error: null })) }, query, from };
}
describe("read-only visible exception ageing", () => {
  beforeEach(() => vi.clearAllMocks());
  it("keeps decimal amounts exact and separate by currency", () => {
    const result = buildAgeingObservation([
      row("a", 2, { amount: "0.1", currency: "USD" }), row("b", 2, { amount: "0.2", currency: "USD" }),
      row("c", 2, { amount: "4.50", currency: "EUR" }), row("d", 2, { amount: "invalid", currency: "USD" }),
    ], now);
    const bucket = result.buckets.find((b) => b.bucket === "2-5d")!;
    expect(bucket.count).toBe(4);
    expect(bucket.currencies).toEqual([
      { currency: "EUR", amount: "4.5", known_amounts: 1, missing_amounts: 0 },
      { currency: "USD", amount: "0.3", known_amounts: 2, missing_amounts: 1 },
    ]);
  });
  it("does not invent age, currency or zero amount from invalid/missing values", () => {
    const result = buildAgeingObservation([
      { id: "unknown", created_at: "not-a-date", payload: { diff: 99, currency: "USD" } },
      row("future", -1, { amount: 2, currency: "USD" }), row("missing", 31, { amount: 10 }),
      row("unrecorded", 31, { currency: "EUR" }),
    ], now);
    expect(result.unknown_age).toBe(2);
    expect(result.rows[0].amount).toBeNull();
    const bucket = result.buckets.find((b) => b.bucket === "30d+")!;
    expect(bucket.missing_currency).toBe(1);
    expect(bucket.currencies[0].amount).toBeNull();
  });
  it("uses whole elapsed days at boundaries and labels a capped observation", () => {
    const result = buildAgeingObservation([row("one", 1.99, {}), row("two", 2, {}), row("thirty", 30, {}), row("older", 31, {})], now);
    expect(result.rows.map((r) => r.bucket)).toEqual(["0-1d", "2-5d", "16-30d", "30d+"]);
    const capped = buildAgeingObservation(Array.from({ length: AGEING_READ_LIMIT + 1 }, (_, i) => row(String(i), 2, {})), now);
    expect(capped.count).toBe(AGEING_READ_LIMIT);
    expect(capped.has_more).toBe(true);
  });
  it("reads the original scoped client and never rewrites snapshots", async () => {
    const c = client([]);
    const result = await (computeAgeing as any)({ data: { tenant_id: "11111111-1111-4111-8111-111111111111" }, context: { supabase: c.supabase } });
    expect(c.from).toHaveBeenCalledExactlyOnceWith("recon_exceptions");
    expect(c.query.eq).toHaveBeenCalledWith("tenant_id", "11111111-1111-4111-8111-111111111111");
    expect(c.supabase.rpc).toHaveBeenCalledWith("get_exception_dashboard", { _tenant_id: "11111111-1111-4111-8111-111111111111", _days: 30 });
    expect(c.query.not).toHaveBeenCalledWith("status", "in", "(resolved,wont_fix)");
    expect(c.query.not).toHaveBeenCalledWith("lifecycle_state", "in", "(resolved,written_off)");
    expect(c.query.range).toHaveBeenCalledWith(0, 50);
    expect(result.total_open).toBe(2501);
    expect(result.rows).toHaveLength(0);
  });
  it("refuses an unavailable aggregate before reading details, rather than using the capped rows", async () => {
    const c = client([]);
    c.supabase.rpc.mockResolvedValueOnce({ data: null as any, error: { code: "PGRST002" } } as any);
    await expect((computeAgeing as any)({ data: { tenant_id: "11111111-1111-4111-8111-111111111111" }, context: { supabase: c.supabase } })).rejects.toThrow("temporarily unavailable");
    expect(c.from).not.toHaveBeenCalled();
  });
  it("pages details without replacing the full backlog aggregate", async () => {
    const c = client(Array.from({ length: 51 }, (_, i) => row(String(i), 92, { amount: "0.1", currency: "EUR" })));
    const result = await (computeAgeing as any)({ data: { tenant_id: "11111111-1111-4111-8111-111111111111", page: 3 }, context: { supabase: c.supabase } });
    expect(c.query.range).toHaveBeenCalledWith(150, 200);
    expect(result.rows).toHaveLength(50); expect(result.has_more).toBe(true);
    expect(result.total_open).toBe(2501);
  });
  it.each([
    [{ code: "42501", message: "private SQL denied" }, "Forbidden"],
    [{ code: "PGRST002", message: "private catalog details" }, "temporarily unavailable"],
  ])("refuses a failed read instead of returning or persisting zero snapshots", async (error, expected) => {
    const c = client(null, error);
    await expect((computeAgeing as any)({ data: { tenant_id: "11111111-1111-4111-8111-111111111111" }, context: { supabase: c.supabase } })).rejects.toThrow(expected);
    expect(c.from).toHaveBeenCalledExactlyOnceWith("recon_exceptions");
  });
});
