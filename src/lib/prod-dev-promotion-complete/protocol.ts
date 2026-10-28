import { z } from "zod";
export const kinds = [
  "reconciliation",
  "source",
  "data_prep",
  "business_unit",
  "group",
  "report",
  "settings",
  "connector",
  "watcher",
  "reference_table",
] as const;
export type Kind = (typeof kinds)[number];
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValue),
    z.record(jsonValue),
  ]),
);
export const uuid = z.string().uuid();
export const addressSchema = z
  .object({
    environment: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/),
    projectRef: z.string().regex(/^[a-z]{20}$/),
    tenantId: uuid,
    identity: z.object({
      release_identity_uid: uuid,
      legal_identity_hash: z.string().regex(/^[a-f0-9]{64}$/),
      domain_identity_hash: z.string().regex(/^[a-f0-9]{64}$/),
      verified_organization_domain: z.string().min(1),
    }),
  })
  .strict();
export type Address = z.infer<typeof addressSchema>;
export const resourceSchema = z
  .object({
    key: z.string().min(3).max(128),
    id: uuid,
    kind: z.enum(kinds),
    tenantId: uuid,
    name: z.string().min(1).max(160),
    revision: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{32}$/),
    dependencies: z.array(z.string()).max(250),
    configuration: z.record(jsonValue),
  })
  .strict();
export type Resource = z.infer<typeof resourceSchema>;
export const snapshotSchema = z
  .object({
    protocol: z.literal("fvi-pdc-1"),
    source: addressSchema,
    destination: addressSchema,
    root: z.string(),
    group: z.string(),
    resources: z.array(resourceSchema).min(2).max(250),
    name: z.string().trim().min(3).max(120),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export const mappingSchema = z
  .object({
    sourceKey: z.string(),
    mode: z.enum(["reuse", "create"]),
    targetId: uuid.optional(),
    revision: z.string().optional(),
    digest: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type Mapping = z.infer<typeof mappingSchema>;
export const movementSchema = z.object({
  id: uuid,
  revision: z.number().int().positive(),
  stage: z.enum([
    "requested",
    "source_approved",
    "received",
    "approved",
    "accepted",
    "applied",
    "rejected",
    "withdrawn",
  ]),
  requester: uuid,
  approver: uuid.nullable(),
  recipient: uuid.nullable(),
  snapshot: snapshotSchema,
  mappings: z.array(mappingSchema),
  installed: z.record(uuid),
  hash: z.string(),
  controlTenant: uuid,
});
export type Movement = z.infer<typeof movementSchema>;
export const commandSchema = z
  .object({
    operation: z.enum(["request", "receive", "approve", "accept", "apply", "reject", "withdraw"]),
    tenantId: uuid,
    key: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
    id: uuid.optional(),
    expectedRevision: z.number().int().positive().optional(),
    snapshot: snapshotSchema.optional(),
    movement: movementSchema.optional(),
    mappings: z.array(mappingSchema).max(250).optional(),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  throw Error("Unsupported package value");
}
export function secretFree(value: unknown): void {
  const denied =
    /^(?:password|passwd|secret|token|api_key|apikey|authorization|credentials?|connection_config|sample_rows|row_count|private_key|user_id|memberships?|roles?|grants?|retention.*|ai_enabled|agent_max_actions|agent_max_distinct_tables)$/i;
  const walk = (v: unknown, depth = 0) => {
    if (depth > 40) throw Error("Configuration nesting exceeds limit");
    if (
      typeof v === "string" &&
      (/(?:sbp_|sb_secret_|sk-[A-Za-z0-9]|Bearer\s|-----BEGIN .*PRIVATE KEY)/.test(v) ||
        /^[\w-]+\.[\w-]+\.[\w-]+$/.test(v))
    )
      throw Error("Credential-like content is excluded");
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (denied.test(k) || /auth|sso|scim|copilot|retention|permission|privilege/i.test(k))
          throw Error("Protected configuration is excluded: " + k);
        walk(x, depth + 1);
      }
  };
  walk(value);
  if (new TextEncoder().encode(canonical(value)).length > 1_500_000)
    throw Error("Package exceeds 1.5 MB");
}
export function closure(
  root: string,
  group: string,
  optional: string[],
  inventory: Resource[],
): Resource[] {
  const byKey = new Map(inventory.map((r) => [r.key, r]));
  if (byKey.size !== inventory.length) throw Error("Duplicate inventory keys");
  const tenant = byKey.get(root)?.tenantId;
  if (byKey.get(root)?.kind !== "reconciliation" || byKey.get(group)?.kind !== "group")
    throw Error("Select a reconciliation and requesting group");
  const done = new Map<string, Resource>(),
    visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw Error("Dependency cycle");
    if (done.has(key)) return;
    const r = byKey.get(key);
    if (!r || r.tenantId !== tenant) throw Error("Required dependency is inaccessible");
    resourceSchema.parse(r);
    if (r.key !== r.kind + ":" + r.id) throw Error("Invalid resource identity");
    visiting.add(key);
    r.dependencies.forEach(visit);
    visiting.delete(key);
    secretFree(r.configuration);
    done.set(key, r);
    if (done.size > 250) throw Error("Package exceeds 250 dependencies");
  };
  [root, group, ...optional].forEach(visit);
  return [...done.values()];
}
export function validateSnapshot(input: unknown): Snapshot {
  const s = snapshotSchema.parse(input);
  if (
    s.source.projectRef === s.destination.projectRef &&
    s.source.tenantId === s.destination.tenantId
  )
    throw Error("Select a different destination");
  if (s.source.environment === s.destination.environment)
    throw Error("Select a different registered environment");
  for (const k of [
    "release_identity_uid",
    "legal_identity_hash",
    "domain_identity_hash",
    "verified_organization_domain",
  ] as const)
    if (!s.source.identity[k] || s.source.identity[k] !== s.destination.identity[k])
      throw Error("Registered organization identity mismatch");
  const graph = closure(
    s.root,
    s.group,
    s.resources.map((r) => r.key),
    s.resources,
  );
  if (graph.length !== s.resources.length) throw Error("Incomplete package");
  secretFree(s.resources.map((r) => r.configuration));
  return s;
}
export function validateMappings(s: Snapshot, m: Mapping[], targets: Resource[]): void {
  if (m.length !== s.resources.length || new Set(m.map((x) => x.sourceKey)).size !== m.length)
    throw Error("Map each dependency exactly once");
  const used = new Set<string>(),
    byKey = new Map(m.map((x) => [x.sourceKey, x]));
  for (const r of s.resources) {
    const x = byKey.get(r.key);
    if (!x) throw Error("Missing dependency mapping");
    mappingSchema.parse(x);
    if (x.mode === "create") {
      if (
        !["reconciliation", "source", "data_prep", "report", "settings"].includes(r.kind) ||
        !x.name ||
        x.targetId
      )
        throw Error("This dependency requires an existing target binding");
      if (
        r.kind === "settings" &&
        /auth|sso|scim|ai|copilot|retention|role|permission/i.test(
          String(r.configuration.feature_key),
        )
      )
        throw Error("Protected setting");
      if (targets.some((t) => t.kind === r.kind && t.name.toLowerCase() === x.name!.toLowerCase()))
        throw Error("Target name collision");
      const name = r.kind + ":" + x.name.toLowerCase();
      if (used.has(name)) throw Error("Duplicate target name");
      used.add(name);
    } else {
      const t = targets.find(
        (t) => t.kind === r.kind && t.id === x.targetId && t.tenantId === s.destination.tenantId,
      );
      if (!t || t.revision !== x.revision || t.digest !== x.digest)
        throw Error("Target binding changed; refresh");
      if (used.has(t.key)) throw Error("Duplicate target binding");
      used.add(t.key);
    }
  }
  const group = s.resources.find((r) => r.key === s.group)!;
  const owner = group.dependencies.find((k) => k.startsWith("business_unit:"));
  const gm = byKey.get(group.key),
    bu = owner ? byKey.get(owner) : null;
  const targetGroup = targets.find((t) => t.id === gm?.targetId && t.kind === "group");
  if (
    !owner ||
    !bu?.targetId ||
    !targetGroup?.dependencies.includes("business_unit:" + bu.targetId)
  )
    throw Error("Target group must belong to the mapped business unit");
  if (byKey.get(s.root)?.mode !== "create")
    throw Error("Reconciliation must be installed as a new reviewed definition");
}
const refKinds: Record<string, Kind> = {
  bu_id: "business_unit",
  parent_id: "business_unit",
  data_source_id: "source",
  data_source_ids: "source",
  dataSourceId: "source",
  source_id: "source",
  source_data_source_id: "source",
  output_data_source_id: "source",
  sourceDataSourceId: "source",
  pipeline_id: "data_prep",
  pipeline_ids: "data_prep",
  pipelineId: "data_prep",
  data_prep_pipeline_id: "data_prep",
  recon_id: "reconciliation",
  reconciliation_id: "reconciliation",
  definition_id: "reconciliation",
  reconciliationId: "reconciliation",
  definitionId: "reconciliation",
  reference_table_id: "reference_table",
  referenceTableId: "reference_table",
};
export function references(value: unknown): string[] {
  const result = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (refKinds[k] && x !== null)
          for (const id of Array.isArray(x) ? x : [x]) {
            uuid.parse(id);
            result.add(refKinds[k] + ":" + id);
          }
        walk(x);
      }
  };
  walk(value);
  return [...result];
}
export function rewrite(value: unknown, ids: Record<string, string>, field = ""): unknown {
  if (refKinds[field] && typeof value === "string") {
    const mapped = ids[refKinds[field] + ":" + value];
    if (!mapped) throw Error("Missing target dependency");
    return mapped;
  }
  if (Array.isArray(value)) return value.map((v) => rewrite(v, ids, field));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, ids, k)]));
  return value;
}
