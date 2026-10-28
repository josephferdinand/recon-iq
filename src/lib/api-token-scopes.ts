import { z } from "zod";

/**
 * Least-privilege scopes currently enforced by the public API handlers.
 * Keep this list aligned with `x-required-scope` in docs/openapi/fvi-openapi.yaml
 * and the `requiredScope` checks in the public API server modules.
 *
 * Legacy scope strings remain valid on already-issued rows; this schema only
 * controls newly-issued tokens and intentionally does not alias old scopes.
 */
export const API_TOKEN_SCOPE_GROUPS = [
  {
    label: "Reconciliations",
    scopes: [
      { id: "recons.read", description: "Read reconciliation definitions and run summaries." },
      { id: "recons.run", description: "Queue reconciliation runs and poll run jobs." },
      { id: "breaks.write", description: "Request governed break write-offs." },
    ],
  },
  {
    label: "Connectors",
    scopes: [
      { id: "connectors.read", description: "Read connector schedules and run history." },
      { id: "connectors.run", description: "Queue a connector run." },
      { id: "connectors.agent", description: "Lease and complete/fail connector-agent jobs." },
    ],
  },
  {
    label: "Watchers",
    scopes: [
      { id: "watchers.read", description: "Read watcher configuration and status." },
      { id: "watchers.write", description: "Create, update, evaluate, or disable watchers." },
    ],
  },
  {
    label: "Data Prep",
    scopes: [
      { id: "data-prep.read", description: "Read pipeline definitions and runs." },
      { id: "data-prep.write", description: "Create, edit, or request governed lifecycle changes." },
      { id: "data-prep.run", description: "Queue pipeline runs and poll run jobs." },
      { id: "data-prep.approve", description: "Approve or reject a submitted pipeline change." },
      { id: "data-prep.promote", description: "Promote an approved pipeline version." },
    ],
  },
  {
    label: "Reference data",
    scopes: [
      { id: "reference-data.read", description: "Read reference sets, versions, and exports." },
      { id: "reference-data.write", description: "Create, stage, submit, or roll back a draft." },
      { id: "reference-data.approve", description: "Approve or reject a submitted reference-data change." },
    ],
  },
  {
    label: "Reports and environment changes",
    scopes: [
      { id: "reports.read", description: "Read or generate supported reports." },
      { id: "environment-changes.read", description: "Read environment-change requests and history." },
      { id: "environment-changes.write", description: "Submit an environment-change request." },
      { id: "environment-changes.approve", description: "Approve or reject an environment-change request." },
    ],
  },
  {
    label: "Separate API services",
    scopes: [
      { id: "ai.inference", description: "Call the supported public inference endpoint." },
      { id: "aidp:extract", description: "Submit or poll AIDP extraction jobs." },
    ],
  },
] as const;

export type ApiTokenScopeId = (typeof API_TOKEN_SCOPE_GROUPS)[number]["scopes"][number]["id"];

export const API_TOKEN_SCOPE_IDS = API_TOKEN_SCOPE_GROUPS.flatMap((group) =>
  group.scopes.map((scope) => scope.id),
) as [ApiTokenScopeId, ...ApiTokenScopeId[]];

export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPE_IDS);

export const newApiTokenScopesSchema = z
  .array(apiTokenScopeSchema)
  .min(1, "Select at least one supported API scope.")
  .max(API_TOKEN_SCOPE_IDS.length)
  .refine((scopes) => new Set(scopes).size === scopes.length, "Duplicate API scopes are not allowed.");
