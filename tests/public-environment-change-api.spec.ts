import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { API_GROUPS, API_SCOPES, buildOpenApi } from "../src/lib/api-catalog";

describe("public environment change API", () => {
  it("ships list, detail, request and independent decision routes", async () => {
    const routes = await Promise.all([
      readFile("src/routes/api/v1/$tenantSlug/environment-changes/index.ts", "utf8"),
      readFile("src/routes/api/v1/$tenantSlug/environment-changes/$requestId/index.ts", "utf8"),
      readFile("src/routes/api/v1/$tenantSlug/environment-changes/$requestId/decision.ts", "utf8"),
    ]);
    expect(routes.join("\n")).toContain("listPublicEnvironmentChanges");
    expect(routes.join("\n")).toContain("createPublicEnvironmentChange");
    expect(routes.join("\n")).toContain("getPublicEnvironmentChange");
    expect(routes.join("\n")).toContain("decidePublicEnvironmentChange");
  });

  it("enforces tenant scopes, idempotency, governed RPCs and correlated audit", async () => {
    const source = await readFile("src/lib/public-environment-change-api.server.ts", "utf8");
    for (const scope of [
      "environment-changes.read",
      "environment-changes.write",
      "environment-changes.approve",
    ]) {
      expect(source).toContain(`requiredScope: "${scope}"`);
    }
    expect(source).toContain("requirePublicIdempotencyKey");
    expect(source).toContain("claimPublicMutation");
    expect(source).toContain("completePublicMutation");
    expect(source).toContain("writePublicApiAudit");
    expect(source).toContain('rpc("request_source_environment_change_for_api"');
    expect(source).toContain('"approve_incoming_environment_change_for_api"');
    expect(source).toContain('"decide_source_environment_change_for_api"');
    expect(source).not.toContain('rpc("request_environment_change_for_api"');
    expect(source).not.toContain('rpc("decide_environment_change_for_api"');
    expect(source).not.toContain("start_environment_change_execution_for_api");
  });

  it("builds a source-owned package and requires an explicit target mapping decision", async () => {
    const [source, migration] = await Promise.all([
      readFile("src/lib/public-environment-change-api.server.ts", "utf8"),
      readFile("supabase/migrations/20260923150000_public_environment_two_stage_api.sql", "utf8"),
    ]);
    expect(source).toContain("}).strict()");
    expect(source).toContain("buildEnvironmentPackage(auth.admin, auth.principal.tenantId)");
    expect(source).toContain("parsed.data.source_tenant_id !== auth.principal.tenantId");
    expect(source).toContain("runtimeProjectRef() !== expectedSourceRef");
    expect(source).toContain("runtimeProjectRef() !== expectedRef");
    expect(source).toContain("parsed.data.confirm_access_mapping !== true");
    expect(source).toContain("environment_release_registry");
    expect(source).toContain('transport_status: "pending"');
    expect(migration).toContain("Source tenant must match the control tenant");
    expect(migration).toContain("target.source_requester_email_hash IS NULL");
    expect(migration).toContain("Bound incoming target review is required");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.request_source_environment_change_for_api");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.approve_incoming_environment_change_for_api");
  });

  it("documents all operations and exposes the three least-privilege scopes", () => {
    const group = API_GROUPS.find((entry) => entry.key === "environment-changes");
    expect(group?.endpoints.map((endpoint) => endpoint.id)).toEqual([
      "environment-change-list",
      "environment-change-read",
      "environment-change-create",
      "environment-change-decision",
    ]);
    for (const scope of [
      "environment-changes.read",
      "environment-changes.write",
      "environment-changes.approve",
    ]) {
      expect(API_SCOPES.some((entry) => entry.name === scope)).toBe(true);
    }
    const openapi = buildOpenApi("assurance-lab");
    expect(openapi.paths["/environment-changes"]?.get).toBeDefined();
    expect(openapi.paths["/environment-changes"]?.post).toBeDefined();
    expect(openapi.paths["/environment-changes/{requestId}"]?.get).toBeDefined();
    expect(openapi.paths["/environment-changes/{requestId}/decision"]?.post).toBeDefined();
  });
});
