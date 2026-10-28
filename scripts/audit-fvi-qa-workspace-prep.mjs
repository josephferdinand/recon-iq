import { readFile } from "node:fs/promises";

const tenantId = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const expectedName = "Assurance Template Lifecycle QA — 2026-10-01";
const expectedSlug = "assurance-template-lifecycle-qa-20261001";
const comparedFields = [
  "id",
  "tenant_id",
  "name",
  "slug",
  "description",
  "owner_id",
  "department",
  "business_unit_id",
  "region",
  "data_residency",
  "template_id",
  "status",
  "metadata",
  "created_by",
  "created_at",
  "updated_at",
];
const packetPath = process.argv[2];

if (!packetPath) {
  console.error("Usage: node scripts/audit-fvi-qa-workspace-prep.mjs <sanitized-readback.json>");
  process.exit(2);
}

const packet = JSON.parse(await readFile(packetPath, "utf8"));
const before = packet.before;
const after = packet.after;
const actorId = packet.authenticated_actor_id;
const fail = (reason) => {
  console.error(JSON.stringify({ ok: false, reason }));
  process.exit(1);
};

if (!Array.isArray(before) || !Array.isArray(after) || !actorId) {
  fail("packet_requires_before_after_rows_and_authenticated_actor_id");
}

const priorById = new Map(before.map((row) => [row.id, row]));
if (priorById.size !== before.length) fail("duplicate_id_in_preflight_rows");
if (after.length !== before.length + 1) fail("workspace_count_delta_not_exactly_one");

for (const row of before) {
  const current = after.find((candidate) => candidate.id === row.id);
  if (!current) fail("preexisting_workspace_missing");
  for (const field of comparedFields) {
    if (JSON.stringify(current[field]) !== JSON.stringify(row[field])) {
      fail("preexisting_workspace_field_changed");
    }
  }
}

const added = after.filter((row) => !priorById.has(row.id));
if (added.length !== 1) fail("expected_exactly_one_new_workspace_id");
const [workspace] = added;
if (
  workspace.tenant_id !== tenantId ||
  workspace.name !== expectedName ||
  workspace.slug !== expectedSlug ||
  workspace.status !== "active" ||
  workspace.owner_id !== actorId ||
  workspace.created_by !== actorId
) {
  fail("new_workspace_fields_or_actor_binding_mismatch");
}

console.log(JSON.stringify({ ok: true, added_workspaces: 1, preserved_existing_workspaces: before.length }));
