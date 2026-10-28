import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  classifyPublicBreakActionFailure,
  parsePublicBreakAction,
} from "../src/lib/public-break-api.server";
import { PUBLIC_REPORTS, rowsToCsv } from "../src/lib/public-report-api.server";
import {
  publicApiRequestHash,
  publicApiDeterministicUuid,
  requirePublicIdempotencyKey,
} from "../src/lib/public-resource-api.server";

describe("public break and report API contracts", () => {
  it("accepts the complete governed break action set and rejects malformed money", () => {
    const breakId = "11111111-1111-4111-8111-111111111111";
    const actions = [
      { action: "assign", assignee: breakId },
      { action: "classify", root_cause: "Counterparty fee", priority: "P2", tags: ["fee"] },
      { action: "comment", body: "Checked against custodian statement", internal: true },
      { action: "attach", filename: "evidence.csv", mime_type: "text/csv", size_bytes: 42 },
      { action: "resolve", resolution_note: "Booked verified adjustment" },
      {
        action: "write_off",
        reason: "Approved immaterial amount",
        amount: 2.5,
        currency: "USD",
        gl_account: "6999",
      },
      {
        action: "approve_write_off",
        request_id: breakId,
        decision: "approved",
        decision_note: "Independent evidence checked",
      },
      { action: "reopen", reason: "Counterparty supplied new evidence" },
      { action: "reprocess" },
    ];
    for (const action of actions) expect(parsePublicBreakAction(action).success).toBe(true);
    expect(
      parsePublicBreakAction({ action: "write_off", amount: Number.NaN, currency: "usd" }).success,
    ).toBe(false);
  });

  it("hashes exact requests and requires bounded idempotency keys", () => {
    const body = { action: "comment", body: "Evidence retained" };
    expect(publicApiRequestHash(body)).toMatch(/^[0-9a-f]{64}$/u);
    expect(publicApiRequestHash(body)).toBe(publicApiRequestHash(body));
    expect(publicApiRequestHash(body)).not.toBe(publicApiRequestHash({ ...body, body: "Changed" }));
    const deterministic = publicApiDeterministicUuid(
      "token",
      "comment",
      "key",
      publicApiRequestHash(body),
    );
    expect(deterministic).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(deterministic).toBe(
      publicApiDeterministicUuid("token", "comment", "key", publicApiRequestHash(body)),
    );
    expect(requirePublicIdempotencyKey(new Request("https://app.reconiq.example"), {}).ok).toBe(
      false,
    );
    expect(
      requirePublicIdempotencyKey(
        new Request("https://app.reconiq.example", {
          headers: { "idempotency-key": "break-action-001" },
        }),
        {},
      ).ok,
    ).toBe(true);
  });

  it("renders deterministic, escaped CSV and publishes only implemented formats", () => {
    expect(PUBLIC_REPORTS.map((report) => report.id)).toEqual([
      "standard-operations",
      "standard-break-risk",
      "standard-full",
    ]);
    expect(PUBLIC_REPORTS.every((report) => report.formats.join(",") === "json,csv")).toBe(true);
    expect(rowsToCsv([{ name: 'Fee "break"', amount: 25 }])).toBe(
      '"name","amount"\n"Fee ""break""","25"\n',
    );
    expect(rowsToCsv([{ name: '=HYPERLINK("https://attacker.example")' }])).toContain(
      "'=HYPERLINK",
    );
  });

  it("persists idempotency atomically and keeps functions service-only", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../supabase/migrations/20260905181500_create_public_api_idempotency.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(migration).toContain("UNIQUE (tenant_id, token_id, operation, idempotency_key)");
    expect(migration).toContain("existing.request_hash <> _request_hash");
    expect(migration).toContain("existing.state = 'completed'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_public_api_idempotency[\s\S]*authenticated/iu,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_public_api_idempotency[\s\S]*service_role/iu,
    );
  });

  it("enforces write-off maker-checker in the database", async () => {
    const [migration, manager, managerUi, lifecycleUi] = await Promise.all([
      readFile(
        fileURLToPath(
          new URL(
            "../supabase/migrations/20260905184500_enforce_break_write_off_four_eyes.sql",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
      readFile(
        fileURLToPath(new URL("../src/lib/break-manager.functions.ts", import.meta.url)),
        "utf8",
      ),
      readFile(
        fileURLToPath(new URL("../src/components/break-manager-tab.tsx", import.meta.url)),
        "utf8",
      ),
      readFile(
        fileURLToPath(
          new URL("../src/components/rekon/exception-lifecycle-dialog.tsx", import.meta.url),
        ),
        "utf8",
      ),
    ]);
    expect(migration).toContain("break_write_off_one_pending");
    expect(migration).toContain("Maker cannot approve or reject their own write-off request");
    expect(migration).toContain("tm.role = 'tenant_admin'");
    expect(migration).toContain("request_break_write_off");
    expect(migration).toContain("decide_break_write_off");
    const mutationLifecycleStates = Array.from(
      manager.matchAll(/patch:\s*z\.object\(\{\s*lifecycle_state:\s*z\.enum\(\[([^\]]*)\]/gu),
      ([, states]) => states,
    );
    expect(mutationLifecycleStates).toHaveLength(2);
    expect(mutationLifecycleStates.every((states) => !states.includes("written_off"))).toBe(true);
    expect(managerUi).not.toContain('moveLifecycle("written_off")');
    expect(managerUi).toContain("<ExceptionLifecycleDialog");
    expect(lifecycleUi).toContain("Request write-off");
    expect(lifecycleUi).toContain("different active tenant administrator");
  });

  it("stores a deterministic denial instead of leaving maker self-approval in progress", () => {
    const action = {
      action: "approve_write_off" as const,
      request_id: "11111111-1111-4111-8111-111111111111",
      decision: "approved" as const,
      decision_note: "self approval must fail",
    };
    expect(
      classifyPublicBreakActionFailure(
        action,
        new Error("Maker cannot approve or reject their own write-off request"),
      ),
    ).toEqual({ status: 403, body: { error: "independent_approval_required" } });
    expect(classifyPublicBreakActionFailure(action, new Error("database unavailable"))).toEqual({
      status: 503,
      body: { error: "break_action_unavailable" },
    });
  });

  it("registers concrete routes and accurate API documentation", async () => {
    const [tree, catalogue, reference] = await Promise.all([
      readFile(fileURLToPath(new URL("../src/routeTree.gen.ts", import.meta.url)), "utf8"),
      readFile(fileURLToPath(new URL("../src/lib/api-catalog.ts", import.meta.url)), "utf8"),
      readFile(fileURLToPath(new URL("../docs/04_api_reference.md", import.meta.url)), "utf8"),
    ]);
    for (const route of ["breaks/$breakId/actions", "reports/$reportId/run"])
      expect(tree).toContain(route);
    expect(catalogue).toContain('scopes: ["breaks.write"]');
    expect(catalogue).toContain('scopes: ["reports.read"]');
    expect(reference).toContain("durable request-hash replay protection");
  });
});
