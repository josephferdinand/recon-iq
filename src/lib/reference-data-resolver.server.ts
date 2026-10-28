import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { RuleSpec } from "@/lib/recon-engine";

type ResolverMode = "authenticated" | "service";

type ManagedReferenceParams = NonNullable<RuleSpec["params"]> & {
  reference_table_id?: string;
  reference_value_column?: string;
  reference_as_of?: string;
  reference_key_fields?: Record<string, string[]>;
  managed_lookup?: Record<string, unknown>;
  reference_key_columns?: string[];
  reference_version_id?: string;
  reference_content_sha256?: string;
};

export type ReferenceVersionEvidence = {
  rule_id: string;
  table_id: string;
  version_id: string;
  version_number: number;
  content_sha256: string;
  as_of: string;
};

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function recordFromJson(value: Json): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Managed reference version contains a non-object row");
  }
  return value as Record<string, unknown>;
}

export async function hydrateManagedReferenceRules(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  rules: RuleSpec[],
  mode: ResolverMode,
): Promise<{ rules: RuleSpec[]; evidence: ReferenceVersionEvidence[] }> {
  const evidence: ReferenceVersionEvidence[] = [];
  const hydrated: RuleSpec[] = [];

  for (const rule of rules) {
    const params = (rule.params ?? {}) as ManagedReferenceParams;
    if (rule.kind !== "reference_lookup" || !params.reference_table_id) {
      hydrated.push(rule);
      continue;
    }

    const { data: table, error: tableError } = await supabase
      .from("reference_data_tables")
      .select("id,key_columns,value_columns")
      .eq("id", params.reference_table_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (tableError || !table) {
      throw new Error(tableError?.message ?? `Reference table not found for rule ${rule.id}`);
    }
    const keyColumns = table.key_columns ?? [];
    const valueColumn = params.reference_value_column;
    if (keyColumns.length === 0) {
      throw new Error(`Reference table for rule ${rule.id} has no key columns`);
    }
    if (!valueColumn || !(table.value_columns ?? []).includes(valueColumn)) {
      throw new Error(`Rule ${rule.id} must select a declared reference value column`);
    }

    const sideKeyFields: Record<string, string[]> = {};
    for (const sideId of Object.keys(rule.fields)) {
      const configured = params.reference_key_fields?.[sideId];
      const fields = configured ?? (keyColumns.length === 1 ? [rule.fields[sideId]] : undefined);
      if (!fields || fields.length !== keyColumns.length || fields.some((field) => !field)) {
        throw new Error(`Rule ${rule.id} must map every composite reference key for side ${sideId}`);
      }
      sideKeyFields[sideId] = fields;
    }

    const asOf = params.reference_as_of ?? currentIsoDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw new Error(`Rule ${rule.id} has an invalid reference as-of date`);
    }
    const rpcName = mode === "service"
      ? "resolve_reference_data_version_for_execution"
      : "resolve_reference_data_version";
    const { data: resolved, error: resolveError } = await supabase.rpc(rpcName, {
      _tenant_id: tenantId,
      _table_id: table.id,
      _as_of: asOf,
    });
    if (resolveError) throw new Error(resolveError.message);
    const version = Array.isArray(resolved) ? resolved[0] : resolved;
    if (!version?.resolved_version_id || !version.resolved_content_sha256) {
      throw new Error(`No effective published reference version for rule ${rule.id}`);
    }
    const rows = Array.isArray(version.resolved_rows) ? version.resolved_rows : [];
    const lookup: Record<string, unknown> = {};
    for (const jsonRow of rows) {
      const row = recordFromJson(jsonRow);
      const key = JSON.stringify(keyColumns.map((column) => row[column] ?? null));
      if (Object.prototype.hasOwnProperty.call(lookup, key)) {
        throw new Error(`Resolved reference version contains duplicate keys for rule ${rule.id}`);
      }
      lookup[key] = row[valueColumn];
    }

    hydrated.push({
      ...rule,
      params: {
        ...params,
        managed_lookup: lookup,
        reference_key_columns: keyColumns,
        reference_key_fields: sideKeyFields,
        reference_version_id: version.resolved_version_id,
        reference_content_sha256: version.resolved_content_sha256,
        reference_as_of: asOf,
      },
    });
    evidence.push({
      rule_id: rule.id,
      table_id: table.id,
      version_id: version.resolved_version_id,
      version_number: Number(version.resolved_version_number),
      content_sha256: version.resolved_content_sha256,
      as_of: asOf,
    });
  }

  return { rules: hydrated, evidence };
}
