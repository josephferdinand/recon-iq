import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");
const spec = load(read("docs/openapi/proposed/reconciliation-run-read.openapi.patch.yaml")) as any;
const sql = read("docs/openapi/proposed/reconciliation-run-read.forward.sql");
describe("reconciliation API integration proposal", () => {
  it("maps both proposed GET operations to concrete new source routes", () => {
    for (const [path, item] of Object.entries(spec.paths) as Array<[string, any]>) {
      const route = path.replace(/\{([a-zA-Z]+)\}/gu, "$$$1");
      const source = read(`src/routes${route}.ts`);
      expect(source).toContain(`createFileRoute("${route}")`);
      expect(source).toContain("GET:");
      expect(item.get.security).toEqual([{ tenantApiToken: [] }]);
      expect(item.get["x-required-scope"]).toBe("recons.read");
    }
  });
  it("qualifies existing principal guards and denies unclassified creator-only tokens", () => {
    expect(sql).not.toContain("HELD: verified immutable API-token actor binding");
    expect(sql).toContain("reconciliation API dependency catalog drift");
    expect(sql).toContain("guard_api_token_principal_metadata");
    expect(sql).toContain("t.principal_kind='user_delegated'");
    expect(sql).toContain("t.subject_user_id=t.created_by AND t.issuer_user_id=t.created_by");
    expect(sql).toContain("revoked_at IS NULL");
    expect(sql).toContain("_required_scope=ANY(t.scopes)");
    expect(sql).toContain("active=true FOR SHARE");
    expect(sql).toContain("recon_authoritative_access_decision_as(actor,_recon_id,'view')");
    expect(sql).not.toContain("service_recon_actor_access_decision(");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION");
  });
  it("uses one database transaction for each read's audit and restricts RPC execution", () => {
    expect(sql).toContain("INSERT INTO public.audit_log");
    expect(sql).toContain("RETURNING id INTO audit_id");
    expect(sql).toContain("FROM PUBLIC,anon,authenticated");
    expect(sql).toContain("TO service_role");
    expect(sql).not.toContain("set_config(");
    expect(sql).not.toContain("SET ROLE");
    expect(sql).toBe(read("supabase/migrations/20261003153000_public_reconciliation_run_read.sql"));
  });
});
