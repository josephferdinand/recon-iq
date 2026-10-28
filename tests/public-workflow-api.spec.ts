import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  extractWorkflowBearer,
  hasWorkflowScope,
  workflowScopeForJobKind,
  workflowApiCors,
} from "../src/lib/public-workflow-api.server";

describe("public workflow API boundary", () => {
  it("extracts bearer credentials without accepting other schemes", () => {
    expect(
      extractWorkflowBearer(
        new Request("https://app.reconiq.example", {
          headers: { authorization: "Bearer example-token" },
        }),
      ),
    ).toBe("example-token");
    expect(
      extractWorkflowBearer(
        new Request("https://app.reconiq.example", {
          headers: { authorization: "Basic example-token" },
        }),
      ),
    ).toBe("");
  });

  it("requires exact workflow scopes or the wildcard", () => {
    expect(hasWorkflowScope(["data-prep.run"], "data-prep.run")).toBe(true);
    expect(hasWorkflowScope(["recons.run"], "data-prep.run")).toBe(false);
    expect(hasWorkflowScope(["*"], "recons.run")).toBe(true);
  });

  it("maps every queued job kind to one exact API scope", () => {
    expect(workflowScopeForJobKind("data_prep_run")).toBe("data-prep.run");
    expect(workflowScopeForJobKind("recon_run")).toBe("recons.run");
    expect(workflowScopeForJobKind("connector_run")).toBe("connectors.run");
  });

  it("allows only canonical FVI origins and advertises idempotency", () => {
    const allowed = workflowApiCors(
      new Request("https://app.reconiq.example", {
        headers: { origin: "https://app.reconiq.example" },
      }),
      "POST",
    );
    expect(allowed["access-control-allow-origin"]).toBe("https://app.reconiq.example");
    expect(allowed["access-control-allow-headers"]).toContain("idempotency-key");

    const hostile = workflowApiCors(
      new Request("https://app.reconiq.example", {
        headers: { origin: "https://attacker.example" },
      }),
      "POST",
    );
    expect(hostile).not.toHaveProperty("access-control-allow-origin");
  });

  it("queues atomically with tenant/resource validation and service-only execution grants", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../supabase/migrations/20260905044000_create_workflow_api_job_queue.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(migration).toContain("UNIQUE (tenant_id, job_kind, resource_id, idempotency_key)");
    expect(migration).toContain("Data Prep pipeline not found");
    expect(migration).toContain("Reconciliation not found");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enqueue_workflow_api_job[\s\S]*authenticated/iu,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.claim_workflow_api_job[\s\S]*service_role/iu,
    );
  });

  it("extends the same queue to direct connector schedules only", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../supabase/migrations/20260905120000_extend_workflow_api_connector_runs.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(migration).toContain("'connector_run'");
    expect(migration).toContain("connector_type IN ('http', 'https', 'rest')");
    expect(migration).toContain("Direct connector schedule not found");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enqueue_workflow_api_job[\s\S]*authenticated/iu,
    );
  });

  it("publishes the connector queue in the API catalogue and reference", async () => {
    const [catalogue, reference] = await Promise.all([
      readFile(fileURLToPath(new URL("../src/lib/api-catalog.ts", import.meta.url)), "utf8"),
      readFile(fileURLToPath(new URL("../docs/04_api_reference.md", import.meta.url)), "utf8"),
    ]);
    expect(catalogue).toContain('path: "/connectors/{scheduleId}/runs"');
    expect(catalogue).toContain('scopes: ["connectors.run"]');
    expect(reference).toContain("/connectors/{scheduleId}/runs");
    expect(reference).toContain("execute through the private remote gateway");
    expect(reference).toContain("fail closed until an approved on-premises agent is paired");
  });

  it("returns the public reconciliation run UID alongside the UUID in completed jobs", async () => {
    const worker = await readFile(
      fileURLToPath(new URL("../src/lib/workflow-api-job-worker.server.ts", import.meta.url)),
      "utf8",
    );
    expect(worker).toContain('.select("id,run_uid").single()');
    expect(worker).toContain("run_id: run.id,");
    expect(worker).toContain("run_uid: run.run_uid,");
  });
});
