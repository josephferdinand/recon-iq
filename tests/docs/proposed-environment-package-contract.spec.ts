import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const proposed = load(readFileSync("docs/openapi/proposed/environment-package-promotion.yaml", "utf8")) as any;
const published = load(readFileSync("docs/openapi/fvi-openapi.yaml", "utf8")) as any;
const methods = new Set(["get", "post", "put", "patch", "delete"]);
const operations = Object.entries(proposed.paths).flatMap(([path, item]) =>
  Object.entries(item as Record<string, any>)
    .filter(([method]) => methods.has(method))
    .map(([method, operation]) => ({ path, method, operation })),
);
function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : references(child),
  );
}

describe("queued dynamic environment package contract", () => {
  it("remains unpublished, without a server URL or enabled transport", () => {
    expect(proposed.openapi).toBe("3.1.0");
    expect(proposed["x-rq-status"]).toBe("proposed-not-implemented");
    expect(proposed["x-fvi-transport-enabled"]).toBe(false);
    expect(proposed.servers).toBeUndefined();
    expect(operations).toHaveLength(6);
    const ids = operations.map(({ operation }) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { path, operation } of operations) {
      expect(published.paths[path], `Proposed path accidentally published: ${path}`).toBeUndefined();
      expect(operation.operationId).toMatch(/^proposed/u);
      expect(operation.security).toEqual([{ userSession: [] }]);
    }
  });

  it("resolves every local reference in paths and composed schemas", () => {
    for (const reference of references(proposed)) {
      expect(reference).toMatch(/^#\/components\//u);
      const [kind, name] = reference.slice("#/components/".length).split("/");
      expect(proposed.components[kind]?.[name], reference).toBeTruthy();
    }
  });

  it("fences sensitive requests and destination decisions and refuses unproved availability", () => {
    const guarded = operations.filter(({ operation }) => [
      "proposedSubmitMigrationRequest", "proposedDecideDestinationMigrationRequest",
    ].includes(operation.operationId));
    expect(guarded).toHaveLength(2);
    for (const { operation } of guarded) {
      expect(operation["x-required-aal"]).toBe("aal2");
      expect(operation.parameters).toContainEqual({ $ref: "#/components/parameters/IdempotencyKey" });
      expect(operation.parameters).toContainEqual({ $ref: "#/components/parameters/IfMatch" });
    }
    expect(proposed.components.schemas.DecisionInput.oneOf).toHaveLength(2);
    const availability = proposed.components.schemas.Request.allOf[0];
    expect(availability.if.properties.status.const).toBe("available");
    expect(availability.then.required).toEqual(["receipt_id", "receipt"]);
    expect(proposed.components.schemas.AvailabilityReceipt.properties.target_readback_verified.const).toBe(true);
  });
});
