import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tenantId: "a4444444-4444-4444-8444-444444444444",
  projectRef: "YOUR_PROJECT_REF",
  row: null as null | Record<string, unknown>,
  intakeStatus: "open" as "open" | "paused" | "unavailable",
  rpc: vi.fn(),
  manifest: { package: { recon_definitions: [], data_prep_pipelines: [] },
    configuration: { data_sources: [], connector_schedules: [], watchers: [] },
    settings: { access_grants: [] } },
}));

vi.mock("@/lib/environment-package.server", () => ({
  buildEnvironmentPackage: async () => state.manifest,
}));
vi.mock("@/lib/environment-control-plane.server", () => ({
  checkEnvironmentChangeIntake: async () => state.intakeStatus,
}));

vi.mock("@/lib/runtime-env.server", () => ({
  getRuntimeEnv: (name: string) => name === "SUPABASE_PROJECT_ID" ? state.projectRef : undefined,
}));
vi.mock("@/lib/public-workflow-api.server", () => ({
  authorizeTenantApiRequest: async () => ({
    ok: true,
    principal: { tenantId: state.tenantId, actorUserId: "a1111111-1111-4111-8111-111111111111" },
    cors: {},
    admin: {
      rpc: state.rpc,
      from: () => ({
        select: () => ({
          in: async () => ({ data: [
            { environment: "dev", project_ref: "YOUR_PROJECT_REF", enabled: true },
            { environment: "prod", project_ref: "YOUR_PROJECT_REF", enabled: true },
          ], error: null }),
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }),
        }),
      }),
    },
  }),
  workflowApiJson: (status: number, body: unknown) => Response.json(body, { status }),
  workflowApiCors: () => ({}),
}));
vi.mock("@/lib/public-resource-api.server", () => ({
  claimPublicMutation: async () => ({ ok: true, requestHash: "fixture-hash" }),
  completePublicMutation: vi.fn(),
  publicApiRequestContext: () => ({}),
  requirePublicIdempotencyKey: () => ({ ok: true, key: "fixture-idempotency-key" }),
  writePublicApiAudit: vi.fn(),
}));

import {
  createPublicEnvironmentChange,
  decidePublicEnvironmentChange,
} from "../src/lib/public-environment-change-api.server";

const sourceTenant = "a4444444-4444-4444-8444-444444444444";
const targetTenant = "a5555555-5555-4555-8555-555555555555";
const requestId = "a7777777-7777-4777-8777-777777777777";
const creation = {
  direction: "dev_to_prod",
  source_tenant_id: sourceTenant,
  target_tenant_id: targetTenant,
  title: "Promote cash reconciliation",
  reason: "Approved package for the matching PROD tenant",
};
function post(body: unknown) {
  return new Request("https://app.reconiq.example/api/v1/source/environment-changes", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("public environment delivery stage guards", () => {
  beforeEach(() => {
    state.projectRef = "YOUR_PROJECT_REF";
    state.tenantId = sourceTenant;
    state.row = null;
    state.intakeStatus = "open";
    state.rpc.mockReset();
  });

  it("rejects a caller-supplied manifest before using the database", async () => {
    const response = await createPublicEnvironmentChange(post({ ...creation, manifest: { package: {}, configuration: {}, settings: {} } }), "source");
    expect(response.status).toBe(422);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("rejects a target-environment create and a foreign source tenant", async () => {
    state.projectRef = "YOUR_PROJECT_REF";
    expect((await createPublicEnvironmentChange(post(creation), "source")).status).toBe(409);
    state.projectRef = "YOUR_PROJECT_REF";
    expect((await createPublicEnvironmentChange(post({ ...creation, source_tenant_id: targetTenant }), "source")).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("submits the server-built source package to the source-stage RPC", async () => {
    state.rpc.mockResolvedValue({ data: [{ request_id: requestId, request_status: "pending_approval" }], error: null });
    const response = await createPublicEnvironmentChange(post(creation), "source");
    expect(response.status).toBe(201);
    const [rpcName, args] = state.rpc.mock.calls[0];
    expect(rpcName).toBe("request_source_environment_change_for_api");
    expect(args._request).toMatchObject({
      source_tenant_id: sourceTenant,
      control_tenant_id: sourceTenant,
      source_project_ref: "YOUR_PROJECT_REF",
      target_project_ref: "YOUR_PROJECT_REF",
      manifest: state.manifest,
      validation_results: expect.arrayContaining([expect.objectContaining({ check: "source_tenant_binding", status: "pass" })]),
    });
  });

  it("requires mapping confirmation and correct target project before target approval", async () => {
    state.tenantId = targetTenant;
    state.row = { approval_stage: "target_review", target_project_ref: "YOUR_PROJECT_REF" };
    expect((await decidePublicEnvironmentChange(post({ approve: true }), "target", requestId)).status).toBe(409);
    state.projectRef = "YOUR_PROJECT_REF";
    expect((await decidePublicEnvironmentChange(post({ approve: true }), "target", requestId)).status).toBe(422);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("routes a confirmed target decision through the target-stage RPC", async () => {
    state.tenantId = targetTenant;
    state.projectRef = "YOUR_PROJECT_REF";
    state.row = { approval_stage: "target_review", target_project_ref: state.projectRef };
    state.rpc.mockResolvedValue({ data: "approved", error: null });
    const response = await decidePublicEnvironmentChange(post({ approve: true, confirm_access_mapping: true }), "target", requestId);
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("approve_incoming_environment_change_for_api",
      expect.objectContaining({ _request_id: requestId, _confirm_access_mapping: true }));
  });

  it("keeps approved source transport pending under API-token authentication", async () => {
    state.row = { approval_stage: "source_review", source_project_ref: state.projectRef };
    state.rpc.mockResolvedValue({ data: "approved", error: null });
    const response = await decidePublicEnvironmentChange(post({ approve: true }), "source", requestId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      status: "approved", approval_stage: "source_review", transport_status: "pending",
    } });
    expect(state.rpc).toHaveBeenCalledWith("decide_source_environment_change_for_api",
      expect.objectContaining({ _request_id: requestId }));
  });

  it("does not persist a source approval while intake is paused or unavailable", async () => {
    state.row = { approval_stage: "source_review", source_project_ref: state.projectRef };
    for (const intakeStatus of ["paused", "unavailable"] as const) {
      state.intakeStatus = intakeStatus;
      const response = await decidePublicEnvironmentChange(
        post({ approve: true }), "source", requestId,
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: intakeStatus === "paused"
          ? "environment_change_imports_paused"
          : "environment_change_intake_unavailable",
      });
      expect(state.rpc).not.toHaveBeenCalled();
    }
  });

  it("still allows target-stage review decisions while new intake is paused", async () => {
    state.intakeStatus = "paused";
    state.tenantId = targetTenant;
    state.projectRef = "YOUR_PROJECT_REF";
    state.row = { approval_stage: "target_review", target_project_ref: state.projectRef };
    state.rpc.mockResolvedValue({ data: "approved", error: null });
    const response = await decidePublicEnvironmentChange(
      post({ approve: true, confirm_access_mapping: true }), "target", requestId,
    );
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("approve_incoming_environment_change_for_api",
      expect.objectContaining({ _request_id: requestId, _confirm_access_mapping: true }));
  });

  it("hides a request outside the token tenant", async () => {
    expect((await decidePublicEnvironmentChange(post({ approve: true }), "source", requestId)).status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
