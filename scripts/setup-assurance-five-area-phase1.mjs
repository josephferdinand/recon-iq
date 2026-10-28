// Idempotent, actor-bound synthetic QA BU/group setup. No resource ownership or grants.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const tenantId = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const rootId = "55aada23-06cb-4e8b-92f4-9deb93f1731c";
const fundId = "455966f6-9b66-40ac-a992-703769419112";
const actorId = "35c27858-e96d-48e3-8bad-1861826a33a7";
const project = "YOUR_PROJECT_REF";
const apply = process.env.FVI_APPLY_ASSURANCE_FIVE_AREA_PHASE1 === "YES";
const expected = [
  { area: "FA", code: "QA-FUND", name: "Fund Accounting — Synthetic QA", group: "Assurance QA — FA" },
  { area: "TA", code: "QA-TA", name: "Transfer Agency — Synthetic QA", group: "Assurance QA — TA" },
  { area: "IOO", code: "QA-IOO", name: "IOO — Synthetic QA", group: "Assurance QA — IOO" },
  { area: "PCA", code: "QA-PCA", name: "PCA — Synthetic QA", group: "Assurance QA — PCA" },
  { area: "HFS", code: "QA-HFS", name: "HFS — Synthetic QA", group: "Assurance QA — HFS" },
];
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const credentialPath = process.env.FVI_QA_CREDENTIAL_FILE ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md"
  || !path.isAbsolute(credentialPath)
  || path.basename(credentialPath) !== "FVI-QA-Access-PROD-maker-20260925.cred") {
  throw new Error("Exact protected FVI vault and QA maker credential paths are required");
}
const vault = await readFile(vaultPath, "utf8");
const begin = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
if (begin < 0 || end <= begin) throw new Error("Canonical vault section unavailable");
const row = vault.slice(begin, end).split(/\r?\n/u)
  .find((line) => line.startsWith("| `SUPABASE_PROD_ANON_KEY` |"));
const key = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!key) throw new Error("PROD publishable key unavailable");
const credential = await readFile(credentialPath, "utf8");
const field = (label) => credential.match(new RegExp(`^\\s*(?:-\\s*)?${label}:\\s*(.+)$`, "mu"))?.[1]
  ?.trim().replace(/^`|`$/gu, "") ?? "";
const email = field("Account");
const password = field("Temporary password");
if (!email || !password) throw new Error("QA maker credential incomplete");
const client = createClient(`https://${project}.supabase.co`, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data: login, error: loginError } = await client.auth.signInWithPassword({ email, password });
if (loginError || login.user?.id !== actorId) throw new Error(`Exact QA maker sign-in failed: ${loginError?.code ?? "actor_mismatch"}`);
async function rows(table, select, filters = []) {
  let query = client.from(table).select(select).eq("tenant_id", tenantId);
  for (const [column, value] of filters) query = query.eq(column, value);
  const { data, error } = await query;
  if (error) throw new Error(`${table} readback failed: ${error.code ?? "unknown"}`);
  return data ?? [];
}
async function audit(action, resourceType, resourceId, context) {
  const { error } = await client.from("audit_log").insert({
    actor_user_id: actorId, tenant_id: tenantId, scope: "tenant",
    action, resource_type: resourceType, resource_id: resourceId, context,
  });
  if (error) throw new Error(`Audit write failed for ${action}: ${error.code ?? "unknown"}`);
}
try {
  const { data: membership, error: membershipError } = await client.from("tenant_members")
    .select("role,active").eq("tenant_id", tenantId).eq("user_id", actorId).single();
  const units = await rows("business_units", "id,code,name,parent_id,is_archived");
  const groups = await rows("tenant_groups", "id,name,bu_id,is_system,preset_key");
  if (membershipError || membership?.active !== true || membership.role !== "tenant_admin"
    || units.find((unit) => unit.id === rootId)?.code !== "QA-ROOT"
    || units.find((unit) => unit.id === fundId)?.code !== "QA-FUND") {
    throw new Error("Exact Assurance QA tenant/admin/root/FA preflight failed");
  }
  for (const item of expected) {
    const codeMatches = units.filter((unit) => unit.code === item.code);
    const nameMatches = units.filter((unit) => unit.name === item.name);
    if (codeMatches.length > 1 || nameMatches.length > 1
      || (codeMatches[0] && nameMatches[0] && codeMatches[0].id !== nameMatches[0].id)
      || (codeMatches[0] && (codeMatches[0].name !== item.name
        || codeMatches[0].parent_id !== rootId || codeMatches[0].is_archived))) {
      throw new Error(`Conflicting BU state for ${item.area}`);
    }
    if (groups.filter((group) => group.name === item.group).length > 1) {
      throw new Error(`Duplicate QA group for ${item.area}`);
    }
  }
  if (!apply) {
    console.log(JSON.stringify({ dry_run: true, tenant_id: tenantId, actor_id: actorId,
      areas: expected.map((item) => ({ area: item.area, bu_code: item.code,
        bu_exists: units.some((unit) => unit.code === item.code),
        group: item.group, group_exists: groups.some((group) => group.name === item.group) })),
      resource_mapping_changed: false }));
    process.exit(0);
  }
  for (const item of expected) {
    let unit = (await rows("business_units", "id,code,name,parent_id,is_archived", [["code", item.code]]))[0];
    if (!unit) {
      const { data, error } = await client.from("business_units").insert({
        tenant_id: tenantId, parent_id: rootId, name: item.name, code: item.code,
        description: "Owner-authorized synthetic Assurance Lab QA area; no operational ownership claim",
        created_by: actorId,
      }).select("id").single();
      if (error || !data?.id) throw new Error(`BU create failed for ${item.area}: ${error?.code ?? "unknown"}`);
      await audit("bu.create", "business_units", data.id, { area: item.area, code: item.code, synthetic: true });
      unit = (await rows("business_units", "id,code,name,parent_id,is_archived", [["id", data.id]]))[0];
      console.log(JSON.stringify({ area: item.area, bu_created: data.id }));
    }
    if (unit?.code !== item.code || unit.name !== item.name || unit.parent_id !== rootId || unit.is_archived) {
      throw new Error(`BU readback failed for ${item.area}`);
    }
    let group = (await rows("tenant_groups", "id,name,bu_id,is_system,preset_key", [["name", item.group]]))[0];
    if (!group) {
      const { data, error } = await client.from("tenant_groups").insert({
        tenant_id: tenantId, name: item.group, bu_id: unit.id,
        description: `Synthetic ${item.area} QA group; no roles or members granted by setup`,
        created_by: actorId,
      }).select("id").single();
      if (error || !data?.id) throw new Error(`Group create failed for ${item.area}: ${error?.code ?? "unknown"}`);
      await audit("group.create", "tenant_groups", data.id, { area: item.area, bu_id: unit.id, synthetic: true });
      group = (await rows("tenant_groups", "id,name,bu_id,is_system,preset_key", [["id", data.id]]))[0];
      console.log(JSON.stringify({ area: item.area, group_created: data.id }));
    }
    if (group?.name !== item.group || group.bu_id !== unit.id || group.is_system || group.preset_key) {
      throw new Error(`Group readback failed for ${item.area}`);
    }
    const assignments = await rows("bu_group_assignments", "id,bu_id,group_id,role,inherit_descendants", [["group_id", group.id]]);
    if (assignments.length > 1 || (assignments[0] && (assignments[0].bu_id !== unit.id
      || assignments[0].role !== "bu_viewer" || assignments[0].inherit_descendants))) {
      throw new Error(`Unexpected QA group assignment for ${item.area}`);
    }
    if (!assignments.length) {
      const { data, error } = await client.from("bu_group_assignments").insert({
        tenant_id: tenantId, bu_id: unit.id, group_id: group.id,
        role: "bu_viewer", inherit_descendants: false, created_by: actorId,
      }).select("id").single();
      if (error || !data?.id) throw new Error(`Group-to-BU assignment failed for ${item.area}: ${error?.code ?? "unknown"}`);
      await audit("bu.assign_group", "business_units", unit.id,
        { area: item.area, group_id: group.id, role: "bu_viewer", synthetic: true });
      console.log(JSON.stringify({ area: item.area, assignment_created: data.id }));
    }
    const confirmed = await rows("bu_group_assignments", "id,bu_id,group_id,role,inherit_descendants", [["group_id", group.id]]);
    if (confirmed.length !== 1 || confirmed[0].bu_id !== unit.id
      || confirmed[0].role !== "bu_viewer" || confirmed[0].inherit_descendants) {
      throw new Error(`Persisted group assignment readback failed for ${item.area}`);
    }
    console.log(JSON.stringify({ area: item.area, bu_id: unit.id, group_id: group.id,
      assignment_id: confirmed[0].id, verified: true }));
  }
  const sharedName = "Assurance QA — FA + TA Shared";
  let sharedGroup = (await rows("tenant_groups", "id,name,bu_id,is_system,preset_key", [["name", sharedName]]))[0];
  if (!sharedGroup) {
    const { data, error } = await client.from("tenant_groups").insert({
      tenant_id: tenantId, name: sharedName, bu_id: null,
      description: "Synthetic many-to-many QA group for FA and TA; no roles or members granted by setup",
      created_by: actorId,
    }).select("id").single();
    if (error || !data?.id) throw new Error(`Shared group create failed: ${error?.code ?? "unknown"}`);
    await audit("group.create", "tenant_groups", data.id,
      { area: "FA+TA", synthetic: true, shared_business_units: [fundId,
        (await rows("business_units", "id", [["code", "QA-TA"]]))[0]?.id] });
    sharedGroup = (await rows("tenant_groups", "id,name,bu_id,is_system,preset_key", [["id", data.id]]))[0];
    console.log(JSON.stringify({ shared_group_created: data.id }));
  }
  if (sharedGroup?.name !== sharedName || sharedGroup.bu_id !== null
    || sharedGroup.is_system || sharedGroup.preset_key) throw new Error("Shared group readback failed");
  const taId = (await rows("business_units", "id", [["code", "QA-TA"]]))[0]?.id;
  if (!taId) throw new Error("TA business unit unavailable for shared group");
  for (const [area, buId] of [["FA", fundId], ["TA", taId]]) {
    const assignmentRows = await rows("bu_group_assignments", "id,bu_id,group_id,role,inherit_descendants", [["group_id", sharedGroup.id], ["bu_id", buId]]);
    if (assignmentRows.length > 1 || (assignmentRows[0] && (assignmentRows[0].role !== "bu_viewer" || assignmentRows[0].inherit_descendants))) {
      throw new Error(`Conflicting shared group assignment for ${area}`);
    }
    if (!assignmentRows.length) {
      const { data, error } = await client.from("bu_group_assignments").insert({
        tenant_id: tenantId, bu_id: buId, group_id: sharedGroup.id,
        role: "bu_viewer", inherit_descendants: false, created_by: actorId,
      }).select("id").single();
      if (error || !data?.id) throw new Error(`Shared ${area} assignment failed: ${error?.code ?? "unknown"}`);
      await audit("bu.assign_group", "business_units", buId,
        { area: "FA+TA", group_id: sharedGroup.id, role: "bu_viewer", synthetic: true });
      console.log(JSON.stringify({ shared_area: area, assignment_created: data.id }));
    }
  }
  const sharedAssignments = await rows("bu_group_assignments", "id,bu_id,group_id,role,inherit_descendants", [["group_id", sharedGroup.id]]);
  if (sharedAssignments.length !== 2 || ![fundId, taId].every((buId) =>
    sharedAssignments.some((row) => row.bu_id === buId && row.role === "bu_viewer" && !row.inherit_descendants))) {
    throw new Error("Persisted FA + TA many-to-many group readback failed");
  }
  console.log(JSON.stringify({ shared_group_id: sharedGroup.id, linked_business_units: ["FA", "TA"],
    assignment_ids: sharedAssignments.map((row) => row.id), verified: true }));
  console.log(JSON.stringify({ ok: true, tenant_id: tenantId, areas: expected.map((item) => item.area),
    resource_mapping_changed: false, group_members_added: 0, group_roles_added: 0 }));
} finally {
  await client.auth.signOut();
}
