import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const chain = {
      middleware: () => chain,
      validator: (fn: (value: unknown) => unknown) => { validate = fn; return chain; },
      handler: (fn: (args: any) => unknown) => (args: { data: unknown; context: unknown }) =>
        fn({ ...args, data: validate(args.data) }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));

import { listPipelines } from "@/lib/data-prep.functions";

const tenantId = "11111111-1111-4111-8111-111111111111";

type Row = {
  id: string;
  tenant_id: string;
  public_uid: string;
  name: string;
  status: string;
  lifecycle_state: string;
  updated_at: string;
  last_run_at: string | null;
  steps: unknown[];
  dq_rules: unknown[];
};

function makeRows(): Row[] {
  return Array.from({ length: 400 }, (_, index) => {
    const day = String(Math.floor(index / 40) + 1).padStart(2, "0");
    return {
      id: `pipeline-${String(index).padStart(3, "0")}`,
      tenant_id: tenantId,
      public_uid: `DP-${String(index).padStart(3, "0")}`,
      name: `Pipeline ${index}`,
      status: "draft",
      lifecycle_state: "production",
      updated_at: `2026-05-${day}T12:00:00.000Z`,
      last_run_at: null,
      steps: [],
      dq_rules: [],
    };
  });
}

function makeContext(sourceRows: Row[], fail = false) {
  const calls: Array<{ operations: Array<[string, ...unknown[]]> }> = [];
  const supabase = {
    from(table: string) {
      if (table !== "data_prep_pipelines") throw new Error("Unexpected table");
      const call = { operations: [] as Array<[string, ...unknown[]]> };
      calls.push(call);
      const query = {
        select: (...args: unknown[]) => { call.operations.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => { call.operations.push(["eq", ...args]); return query; },
        gte: (...args: unknown[]) => { call.operations.push(["gte", ...args]); return query; },
        lt: (...args: unknown[]) => { call.operations.push(["lt", ...args]); return query; },
        order: (...args: unknown[]) => { call.operations.push(["order", ...args]); return query; },
        range: async (from: number, to: number) => {
          call.operations.push(["range", from, to]);
          if (fail) return { data: null, error: { message: "PRIVATE STORAGE DETAIL" } };
          let selected = sourceRows.filter((row) => row.tenant_id === tenantId);
          for (const [operator, field, boundary] of call.operations) {
            if (field !== "updated_at" || typeof boundary !== "string") continue;
            selected = selected.filter((row) => operator === "gte"
              ? row.updated_at >= boundary
              : operator === "lt" ? row.updated_at < boundary : true);
          }
          selected.sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id));
          return { data: selected.slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
  return { context: { supabase }, calls };
}

function callPipelines(context: unknown, data: Record<string, unknown>) {
  return (listPipelines as any)({ data, context });
}

describe("Data Prep UTC updated-date list filters", () => {
  it("filters all 400 rows at the tenant read before paging and includes both UTC calendar boundaries", async () => {
    const rows = makeRows();
    rows[80].updated_at = "2026-05-03T00:00:00.000Z";
    rows[159].updated_at = "2026-05-04T23:59:59.999Z";
    rows[160].updated_at = "2026-05-05T00:00:00.000Z";
    const db = makeContext(rows);

    const result = await callPipelines(db.context, {
      tenant_id: tenantId,
      page: 0,
      page_size: 25,
      updated_from: "2026-05-03",
      updated_through: "2026-05-04",
    });

    expect(result.total).toBe(80);
    expect(result.rows).toHaveLength(25);
    expect(result.rows[0].id).toBe("pipeline-159");
    expect(result.rows.map((row: Row) => row.id)).not.toContain("pipeline-160");
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].operations).toContainEqual(["gte", "updated_at", "2026-05-03T00:00:00.000Z"]);
    expect(db.calls[0].operations).toContainEqual(["lt", "updated_at", "2026-05-05T00:00:00.000Z"]);
    expect(db.calls[0].operations).toContainEqual(["range", 0, 499]);
    expect(db.calls[0].operations.findIndex(([op]) => op === "gte")).toBeLessThan(db.calls[0].operations.findIndex(([op]) => op === "range"));
  });

  it("rejects impossible and reversed dates before reading tenant data", () => {
    const db = makeContext(makeRows());
    expect(() => callPipelines(db.context, { tenant_id: tenantId, updated_from: "2026-02-30" })).toThrow();
    expect(() => callPipelines(db.context, { tenant_id: tenantId, updated_from: "2026-05-05", updated_through: "2026-05-04" })).toThrow();
    expect(db.calls).toHaveLength(0);
  });

  it("fails closed with a safe list error when the filtered database read fails", async () => {
    const db = makeContext(makeRows(), true);
    await expect(callPipelines(db.context, {
      tenant_id: tenantId,
      updated_from: "2026-05-03",
      updated_through: "2026-05-04",
    })).rejects.toThrow("Unable to load Data Prep pipelines");
    expect(db.calls).toHaveLength(1);
  });
});
