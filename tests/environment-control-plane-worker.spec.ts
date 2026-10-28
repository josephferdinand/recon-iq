import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../workers/environment-control-plane/src/index";

const env = {
  TARGET_ENVIRONMENT: "prod" as const,
  TARGET_PROJECT_REF: "YOUR_PROJECT_REF",
  TARGET_SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  TARGET_SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  TARGET_INTAKE_ACTOR_ID: "44444444-4444-4444-8444-444444444444",
  ENVIRONMENT_CHANGE_IMPORTS_PAUSED: "false",
  DEV_SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  DEV_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  PROD_SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  PROD_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
};

afterEach(() => vi.unstubAllGlobals());

describe("environment control-plane Worker", () => {
  it("is internal-by-default and rejects unauthenticated transport", async () => {
    const health = await worker.fetch(new Request("https://internal/health"), env);
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      target_environment: "prod",
      target_configured: true,
      target_intake_actor_configured: true,
      environment_change_imports_paused: false,
    });
    const denied = await worker.fetch(
      new Request("https://internal/v1/environment-changes/receive", { method: "POST" }),
      env,
    );
    expect(denied.status).toBe(401);
  });

  it("fails closed before reading a source package when the target intake actor is missing or malformed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const targetId of [undefined, "source-checker", "00000000-0000-0000-0000-000000000000"]) {
      const unconfigured = { ...env, TARGET_INTAKE_ACTOR_ID: targetId };
      const health = await worker.fetch(new Request("https://internal/health"), unconfigured);
      await expect(health.json()).resolves.toMatchObject({
        target_configured: false,
        target_intake_actor_configured: false,
      });
      const response = await worker.fetch(
        new Request("https://internal/v1/environment-changes/receive", {
          method: "POST",
          headers: { authorization: "Bearer source-user-token" },
          body: JSON.stringify({
            source_request_id: "33333333-3333-4333-8333-333333333333",
            source_environment: "dev",
          }),
        }),
        unconfigured,
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "target_environment_unconfigured" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps intake paused unless the operator explicitly sets false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const pauseValue of [undefined, "", "true", "FALSE", "yes"]) {
      const pausedEnv = { ...env, ENVIRONMENT_CHANGE_IMPORTS_PAUSED: pauseValue };
      const health = await worker.fetch(new Request("https://internal/health"), pausedEnv);
      await expect(health.json()).resolves.toMatchObject({
        target_configured: true,
        environment_change_imports_paused: true,
      });
      const response = await worker.fetch(
        new Request("https://internal/v1/environment-changes/receive", {
          method: "POST",
          headers: { authorization: "Bearer source-user-token" },
          body: JSON.stringify({
            source_request_id: "33333333-3333-4333-8333-333333333333",
            source_environment: "dev",
          }),
        }),
        pausedEnv,
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "environment_change_intake_paused" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("moves only an approved source package into the target inbox and records transport", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    const exported = {
      upstream_change_request_uid: "FVI-CR-20260909-ABC12345",
      upstream_manifest_hash: "a".repeat(64),
      source_request_status: "approved",
      source_project_ref: "YOUR_PROJECT_REF",
      source_tenant_id: "11111111-1111-4111-8111-111111111111",
      source_environment: "dev",
      target_project_ref: "YOUR_PROJECT_REF",
      target_tenant_id: "22222222-2222-4222-8222-222222222222",
      target_environment: "prod",
      direction: "dev_to_prod",
      title: "Promote reconciliation package",
      reason: "Approved source package for target review.",
      manifest: { package: {}, configuration: {}, settings: { access_grants: [] } },
      source_requester_email: "maker@example.invalid",
      source_requester_email_hash: "b".repeat(64),
      source_approver_email_hash: "c".repeat(64),
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      calls.push({ url, body, headers });
      if (url.includes("export_approved_environment_change_for_transport")) {
        return Response.json(exported);
      }
      if (url.includes("receive_environment_change_for_api")) {
        return Response.json([{ change_request_uid: "FVI-CR-20260909-TARGET01" }]);
      }
      if (url.includes("record_environment_change_transport")) {
        return Response.json("succeeded");
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });

    const response = await worker.fetch(
      new Request("https://internal/v1/environment-changes/receive", {
        method: "POST",
        headers: { authorization: "Bearer source-user-token" },
        body: JSON.stringify({
          source_request_id: "33333333-3333-4333-8333-333333333333",
          source_environment: "dev",
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      target_change_request_uid: "FVI-CR-20260909-TARGET01",
    });
    expect(calls).toHaveLength(3);
    expect(calls[1].body).toMatchObject({
      _requester_email: "maker@example.invalid",
      _target_importer_id: env.TARGET_INTAKE_ACTOR_ID,
      _request: {
        direction: "dev_to_prod",
        validation_results: expect.arrayContaining([
          { check: "source_maker_checker_separation", status: "pass" },
          { check: "access_mapping_prepared", status: "pass" },
        ]),
      },
    });
    expect(calls[0].headers.get("authorization")).toBe("Bearer source-user-token");
    expect(calls[1].headers.get("authorization")).toBe("Bearer test-service-key");
    expect(calls[2].body).toMatchObject({
      _succeeded: true,
      _target_change_request_uid: "FVI-CR-20260909-TARGET01",
    });
  });

  it("leaves a pending PROD-to-DEV source request unchanged when sent to the PROD Worker", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const exported = {
      upstream_change_request_uid: "FVI-CR-20260909-PENDING",
      upstream_manifest_hash: "a".repeat(64),
      source_request_status: "approved",
      source_project_ref: "YOUR_PROJECT_REF",
      source_tenant_id: "11111111-1111-4111-8111-111111111111",
      source_environment: "prod",
      target_project_ref: "YOUR_PROJECT_REF",
      target_tenant_id: "22222222-2222-4222-8222-222222222222",
      target_environment: "dev",
      direction: "prod_to_dev",
      title: "Pending PROD to DEV request",
      reason: "Wait for the separately staged DEV importer.",
      manifest: { package: {}, configuration: {}, settings: { access_grants: [] } },
      source_requester_email: "maker@example.invalid",
      source_requester_email_hash: "b".repeat(64),
      source_approver_email_hash: "c".repeat(64),
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.includes("export_approved_environment_change_for_transport")) {
        return Response.json(exported);
      }
      return Response.json({ error: "unexpected target attempt" }, { status: 500 });
    });

    const response = await worker.fetch(
      new Request("https://internal/v1/environment-changes/receive", {
        method: "POST",
        headers: { authorization: "Bearer source-user-token" },
        body: JSON.stringify({
          source_request_id: "33333333-3333-4333-8333-333333333333",
          source_environment: "prod",
        }),
      }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "transport_policy_failed" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("export_approved_environment_change_for_transport");
  });

  it("records transport failure only after the target receiver was actually attempted", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const exported = {
      upstream_change_request_uid: "FVI-CR-20260909-FAILED",
      upstream_manifest_hash: "a".repeat(64),
      source_request_status: "approved",
      source_project_ref: "YOUR_PROJECT_REF",
      source_tenant_id: "11111111-1111-4111-8111-111111111111",
      source_environment: "dev",
      target_project_ref: "YOUR_PROJECT_REF",
      target_tenant_id: "22222222-2222-4222-8222-222222222222",
      target_environment: "prod",
      direction: "dev_to_prod",
      title: "Approved source package",
      reason: "Target receive is attempted and returns an error.",
      manifest: { package: {}, configuration: {}, settings: { access_grants: [] } },
      source_requester_email: "maker@example.invalid",
      source_requester_email_hash: "b".repeat(64),
      source_approver_email_hash: "c".repeat(64),
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.includes("export_approved_environment_change_for_transport")) {
        return Response.json(exported);
      }
      if (url.includes("receive_environment_change_for_api")) {
        return Response.json({ error: "temporary target failure" }, { status: 503 });
      }
      if (url.includes("record_environment_change_transport")) return Response.json("failed");
      return Response.json({ error: "unexpected" }, { status: 500 });
    });

    const response = await worker.fetch(
      new Request("https://internal/v1/environment-changes/receive", {
        method: "POST",
        headers: { authorization: "Bearer source-user-token" },
        body: JSON.stringify({
          source_request_id: "33333333-3333-4333-8333-333333333333",
          source_environment: "dev",
        }),
      }),
      env,
    );

    expect(response.status).toBe(502);
    expect(calls.map((call) => call.url)).toHaveLength(3);
    expect(calls[1]?.url).toContain("receive_environment_change_for_api");
    expect(calls[2]?.url).toContain("record_environment_change_transport");
    expect(calls[2]?.body).toMatchObject({ _succeeded: false, _target_change_request_uid: null });
  });
});
