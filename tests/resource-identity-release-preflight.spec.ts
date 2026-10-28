import { describe, expect, it } from "vitest";
import {
  assessState,
  buildReadOnlyQuery,
  parseArgs,
  parseCanonicalVault,
  queryReadOnlyCatalog,
  RESOURCES,
  TARGETS,
} from "../scripts/preflight-fvi-resource-identity-release.mjs";

describe("resource identity release preflight", () => {
  it("requires an exact documented project ref", () => {
    expect(parseArgs(["--project-ref", TARGETS.prod])).toEqual({ target: "prod", projectRef: TARGETS.prod });
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["--project-ref", "another-project"])).toThrow(/exactly match/u);
  });

  it("reads the token only from the marked canonical vault section", () => {
    const valid = [
      "| `SUPABASE_ACCESS_TOKEN` | `YOUR_PRIVATE_VALUE` |",
      "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->",
    ].join("\n");
    expect(parseCanonicalVault(`outside\n<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->\n${valid}`)).toBe("YOUR_PRIVATE_VALUE");
    expect(() => parseCanonicalVault("| `SUPABASE_ACCESS_TOKEN` | `YOUR_PRIVATE_VALUE` |" )).toThrow();
  });

  it("builds a read-only query scoped to the ten intended relations", () => {
    const query = buildReadOnlyQuery([{ version: "20260924230000" }]);
    expect(query).toContain("supabase_migrations.schema_migrations");
    expect(query).toContain("to_regprocedure('digest(text,text)')");
    expect(query).toContain("pg_get_expr");
    expect(query).toContain("pg_get_indexdef");
    expect(query).not.toContain("ix.indexrelid");
    expect(query).toContain("20260924230000");
    for (const { table } of RESOURCES) expect(query).toContain(`'${table}'`);
    expect(query).not.toMatch(/\b(insert|update|delete|alter|create|drop)\s/iu);
  });

  it("blocks a wrong pre-existing generated column or index definition", () => {
    const tables = RESOURCES.map(({ table, prefix }) => ({
      table, id_prefix: prefix, relation_exists: true, id_column_exists: true, can_select: true,
      public_id_exists: false, public_id_is_text: false, public_id_is_stored_generated: false,
      generated_expression: null, index_exists: false, index_is_unique: false, index_is_valid: false,
      index_definition: null,
    }));
    const state = {
      tables, local_versions_missing_remote: [], remote_versions_missing_local: [], schema_usage: true,
      digest: { visible_on_search_path: true, executable_by_current_user: true },
    };
    expect(assessState(state, [{ name: "20260924230000_data_resource_public_ids.sql" }]).ready).toBe(true);
    state.local_versions_missing_remote = ["20260924230000"];
    expect(assessState(state, [{ name: "20260924230000_data_resource_public_ids.sql" }]).ready).toBe(true);
    state.local_versions_missing_remote = ["20260924233000"];
    expect(assessState(state, [{ name: "20260924230000_data_resource_public_ids.sql" }]).ready).toBe(true);
    state.local_versions_missing_remote = ["20260924220000"];
    expect(assessState(state, [{ name: "20260924230000_data_resource_public_ids.sql" }]).blockers).toContain(
      "Predecessor migrations are missing from the remote ledger",
    );
    state.local_versions_missing_remote = [];
    tables[0] = {
      ...tables[0], public_id_exists: true, public_id_is_text: true, public_id_is_stored_generated: true,
      generated_expression: "'FVI-WRONG-' || upper(substr(encode(digest((id)::text, 'sha256'::text), 'hex'::text), 1, 20))",
    };
    expect(assessState(state, [{ name: "20260924230000_data_resource_public_ids.sql" }]).blockers).toContain(
      "workspace_data_sources: pre-existing public_id definition does not match the migration",
    );
    tables[0] = {
      ...tables[0], public_id_exists: false, index_exists: true, index_is_unique: false,
      index_is_valid: true, index_definition: "CREATE INDEX workspace_data_sources_tenant_public_id_uidx ON public.workspace_data_sources (tenant_id, public_id)",
    };
    expect(assessState(state, [{ name: "20260924230000_data_resource_public_ids.sql" }]).blockers).toContain(
      "workspace_data_sources: pre-existing tenant/public_id index does not match the migration",
    );
  });

  it("sends the catalog query only to the exact target with read_only enabled", async () => {
    let observed;
    const fetchImpl = async (url, options) => {
      observed = { url, options };
      return { ok: true, json: async () => [{ state: { ledger_count: 339 } }] };
    };
    const state = await queryReadOnlyCatalog(fetchImpl, TARGETS.prod, "sbp_fixture_only", "select 1");
    expect(state.ledger_count).toBe(339);
    expect(observed.url).toBe(`https://api.supabase.com/v1/projects/${TARGETS.prod}/database/query`);
    expect(JSON.parse(observed.options.body)).toEqual({ query: "select 1", read_only: true });
    await expect(queryReadOnlyCatalog(fetchImpl, "wrong-project", "sbp_fixture_only", "select 1")).rejects.toThrow();
  });
});
