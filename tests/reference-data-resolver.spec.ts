import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runRecon, type ReconSpec, type RuleSpec } from "@/lib/recon-engine";
import { hydrateManagedReferenceRules } from "@/lib/reference-data-resolver.server";

const tenantId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";

function mockClient(options?: {
  keyColumns?: string[];
  valueColumns?: string[];
  rows?: Array<Record<string, unknown>>;
}) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({
    data: {
      id: tableId,
      key_columns: options?.keyColumns ?? ["alias"],
      value_columns: options?.valueColumns ?? ["canonical"],
    },
    error: null,
  }));
  const rpc = vi.fn(async () => ({
    data: [{
      resolved_version_id: versionId,
      resolved_version_number: 7,
      resolved_content_sha256: "a".repeat(64),
      resolved_rows: options?.rows ?? [
        { alias: "US DOLLAR", canonical: "USD" },
        { alias: "USD", canonical: "USD" },
      ],
    }],
    error: null,
  }));
  return {
    client: { from: vi.fn(() => chain), rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

function managedRule(params?: Partial<NonNullable<RuleSpec["params"]>>): RuleSpec {
  return {
    id: "managed-currency",
    kind: "reference_lookup",
    fields: { A: "currency", B: "currency" },
    params: {
      reference_table_id: tableId,
      reference_value_column: "canonical",
      reference_as_of: "2026-09-08",
      ...params,
    },
    is_key: true,
  };
}

function runWith(rule: RuleSpec, a: Record<string, unknown>, b: Record<string, unknown>) {
  const spec: ReconSpec = {
    recon_type: "two_sided",
    sides: [
      { side_id: "A", label: "A", data_source_id: crypto.randomUUID() },
      { side_id: "B", label: "B", data_source_id: crypto.randomUUID() },
    ],
    rules: [rule],
  };
  return runRecon(spec, [
    { side_id: "A", rows: [a] },
    { side_id: "B", rows: [b] },
  ]);
}

describe("managed Reference Data reconciliation hydration", () => {
  it("resolves an authenticated version and matches aliases through its immutable snapshot", async () => {
    const { client, rpc } = mockClient();
    const hydrated = await hydrateManagedReferenceRules(client, tenantId, [managedRule()], "authenticated");
    expect(rpc).toHaveBeenCalledWith("resolve_reference_data_version", {
      _tenant_id: tenantId,
      _table_id: tableId,
      _as_of: "2026-09-08",
    });
    expect(hydrated.evidence).toEqual([{
      rule_id: "managed-currency",
      table_id: tableId,
      version_id: versionId,
      version_number: 7,
      content_sha256: "a".repeat(64),
      as_of: "2026-09-08",
    }]);
    const result = runWith(hydrated.rules[0], { currency: "US DOLLAR" }, { currency: "USD" });
    expect(result.matches).toHaveLength(1);
    expect(result.exceptions).toHaveLength(0);
  });

  it("uses the service-only resolver for orchestrated execution", async () => {
    const { client, rpc } = mockClient();
    await hydrateManagedReferenceRules(client, tenantId, [managedRule()], "service");
    expect(rpc).toHaveBeenCalledWith("resolve_reference_data_version_for_execution", expect.any(Object));
  });

  it("supports ordered composite reference keys", async () => {
    const { client } = mockClient({
      keyColumns: ["currency", "region"],
      rows: [
        { currency: "USD", region: "US", canonical: "USD-US" },
        { currency: "USD", region: "EU", canonical: "USD-EU" },
      ],
    });
    const rule = managedRule({
      reference_key_fields: { A: ["ccy", "market"], B: ["currency_code", "region_code"] },
    });
    const hydrated = await hydrateManagedReferenceRules(client, tenantId, [rule], "authenticated");
    const result = runWith(
      hydrated.rules[0],
      { ccy: "USD", market: "US" },
      { currency_code: "USD", region_code: "US" },
    );
    expect(result.matches).toHaveLength(1);
  });

  it("fails closed when either side has no managed mapping", async () => {
    const { client } = mockClient();
    const hydrated = await hydrateManagedReferenceRules(client, tenantId, [
      managedRule({ managed_lookup: { '["EUR"]': "USD" } }),
    ], "authenticated");
    const result = runWith(hydrated.rules[0], { currency: "US DOLLAR" }, { currency: "EUR" });
    expect(result.matches).toHaveLength(0);
    expect(result.exceptions.length).toBeGreaterThan(0);
  });

  it("rejects incomplete composite mappings and undeclared value columns", async () => {
    const composite = mockClient({ keyColumns: ["currency", "region"] });
    await expect(hydrateManagedReferenceRules(
      composite.client,
      tenantId,
      [managedRule()],
      "authenticated",
    )).rejects.toThrow("must map every composite reference key");

    const invalidValue = mockClient();
    await expect(hydrateManagedReferenceRules(
      invalidValue.client,
      tenantId,
      [managedRule({ reference_value_column: "unapproved" })],
      "authenticated",
    )).rejects.toThrow("must select a declared reference value column");
  });
});
