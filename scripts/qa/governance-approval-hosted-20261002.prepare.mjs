import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { actorSession, currentSourceHashes, expectedSupplementHashes, verifyReleaseAck } from "./governance-approval-hosted-20261002.mjs";
const root = path.join(process.env.LOCALAPPDATA, "FVI-QA-Private-20260925");
const ownRoot = path.join(root, "governance-approval-hosted-20261002");
const receiptFile = process.env.FVI_GOVERNANCE_SESSION_READINESS_FILE;
if (!receiptFile) throw new Error("Exact current private QA session-readiness receipt is required");
const readiness = JSON.parse(await readFile(receiptFile, "utf8"));
const transport = JSON.parse(await readFile(path.join(root, "FVI-QA-TRANSPORT-PROD-20261001.json"), "utf8"));
const applyPath = path.join(root, "FVI-COMBINED-PROD-WORKFLOW-20261002-APPLY-RECEIPT.json");
const applyBytes = await readFile(applyPath); const apply = JSON.parse(applyBytes);
const prepared = JSON.parse(await readFile(path.join(root, "FVI-COMBINED-PROD-WORKFLOW-20261002-PREPARED.json"), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
if (apply.environment !== "PROD" || apply.phase !== "apply" || apply.ref !== transport.projectRef || apply.after?.[0]?.ledger !== 448 || apply.after[0].latest !== "20261002133100" || apply.after[0].engine !== 170006 || apply.packetSha256 !== prepared.applySha256) throw new Error("Authoritative current PROD combined apply receipt mismatch");
const artifacts = async origin => {
  const response = await fetch(`${origin}/auth`, { redirect: "error" }); if (!response.ok) throw new Error("Application auth readback failed");
  const html = await response.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))"/gu)].map(match => match[1]))].sort();
  if (!assets.length) throw new Error("No hosted application asset fingerprints found");
  return Object.fromEntries(await Promise.all(assets.map(async asset => { const result = await fetch(new URL(asset, origin)); if (!result.ok) throw new Error("Hosted asset readback failed"); return [asset, sha(Buffer.from(await result.arrayBuffer()))]; })));
};
const targetAssets = await artifacts("https://YOUR_PROJECT.pages.dev");
const canonicalAssets = await artifacts("https://app.reconiq.example");
if (JSON.stringify(targetAssets) !== JSON.stringify(canonicalAssets)) throw new Error("Canonical PROD does not serve the acknowledged 5fbb724d asset set");
const ack = { status: "verified", release_kind: "governance", governance_ready: true, parent_explicit_ack: true, production_host: "https://app.reconiq.example", production_deployment_id: "5fbb724d", previous_production_deployment: "cef2c7e7-bed2-4f51-998a-9e978be6a489", production_hosted_readback: true, sql_verified: true,
  parent_ack: "Direct owner/parent message authorized canonical PROD bounded governance QA after matching prefix 5fbb724d and applied migrations; full Cloudflare UUID is being obtained by Primary", applied_migrations: prepared.migrations.map(row => row.version), combined_apply_receipt: applyPath, combined_apply_receipt_sha256: sha(applyBytes), combined_apply: apply, hosted_asset_sha256: canonicalAssets,
  source_sha256: await currentSourceHashes(), supplemental_catalog_sha256: expectedSupplementHashes };
await mkdir(ownRoot, { recursive: true });
const ackPath = path.join(ownRoot, "PROD-5fbb724d-PARENT-ACK-READBACK.json");
try { await writeFile(ackPath, JSON.stringify(ack, null, 2), { flag: "wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; }
const actors = Object.fromEntries(readiness.actors.filter(actor => actor.real_aal2).map(actor => [actor.kind, actor]));
const auth = {};
for (const kind of ["requester", "maker", "checker"]) auth[kind] = (await actorSession(actors[kind], transport.apiUrl)).token;
async function call(kind, endpoint, { method = "GET", body } = {}) {
  const response = await fetch(`${transport.apiUrl}/rest/v1/${endpoint}`, { method, headers: { apikey: transport.anonKey, Authorization: `Bearer ${auth[kind]}`, "Content-Type": "application/json", Prefer: "return=representation" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) { const error = new Error(`Ordinary QA ${endpoint.split('?')[0]} HTTP ${response.status}, code ${data.code ?? "unknown"}`); throw error; } return data;
}
const tenantId = actors.requester.tenant_id;
const buOptions = await call("requester", "rpc/list_governance_membership_options", { method: "POST", body: { _tenant_id: tenantId, _kind: "bu", _page: 1, _page_size: 25, _search: "", _bu_id: null, _workspace_id: null, _environment: null } });
const environmentOptions = await call("requester", "rpc/list_governance_membership_options", { method: "POST", body: { _tenant_id: tenantId, _kind: "environment", _page: 1, _page_size: 25, _search: "", _bu_id: null, _workspace_id: null, _environment: null } });
const bu = buOptions.rows?.[0]; if (!bu) throw new Error("Ordinary QA requester has no current eligible BU");
const environment = environmentOptions.rows.find(row => row.environment === "prod")?.environment ?? environmentOptions.rows?.[0]?.environment;
const workspaceOptions = await call("requester", "rpc/list_governance_membership_options", { method: "POST", body: { _tenant_id: tenantId, _kind: "workspace", _page: 1, _page_size: 25, _search: "", _bu_id: bu.id, _workspace_id: null, _environment: environment } });
const permission = await call("requester", "rpc/user_has_permission", { method: "POST", body: { _user_id: actors.requester.user_id, _tenant_id: tenantId, _permission_id: "audit.log.read", _bu_id: bu.id } });
const output = { ack: ackPath, ledger: apply.after[0].ledger, current_assets_match: true, tenant_id: tenantId, bu, environment, workspaces: workspaceOptions, audit_read_permission_before: permission };
try { await writeFile(path.join(ownRoot, "PROD-5fbb724d-SETUP-PREFLIGHT.json"), JSON.stringify(output, null, 2), { flag: "wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; }
if (process.argv.includes("--fixtures")) {
  process.env.FVI_GOVERNANCE_RELEASE_ACK = ackPath;
  await verifyReleaseAck(ackPath, "PROD");
  const runId = randomUUID(), short = runId.slice(0, 8);
  const manifestPath = path.join(ownRoot, `FIXTURE-PROD-${runId}.json`);
  const manifest = { run_id: runId, tenant_id: tenantId, bu_id: bu.id, own_new_entities: {}, steps: [] };
  const save = async () => writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await save();
  const mutate = async (endpoint, body) => {
    await verifyReleaseAck(ackPath, "PROD");
    manifest.steps.push({ endpoint, stage: "before", at: new Date().toISOString(), body }); await save();
    const result = await call("maker", endpoint, { method: "POST", body });
    manifest.steps.push({ endpoint, stage: "committed", at: new Date().toISOString(), result }); await save();
    return result;
  };
  const audit = async (action, resource_type, resource_id, context) => mutate("audit_log", { actor_user_id: actors.maker.user_id, tenant_id: tenantId, scope: "tenant", action, resource_type, resource_id, context });
  const workspace = (await mutate("workspaces", { tenant_id: tenantId, name: `Zeno Governance QA ${short}`, slug: `zeno-governance-${short}`, description: "New bounded hosted QA workspace; no historical workspace changes", business_unit_id: bu.id, owner_id: actors.maker.user_id, created_by: actors.maker.user_id, status: "active" }))[0];
  manifest.own_new_entities.workspace_id = workspace.id; await save();
  await mutate("workspace_members", { tenant_id: tenantId, workspace_id: workspace.id, user_id: actors.requester.user_id, role: "member", added_by: actors.maker.user_id });
  const group = (await mutate("tenant_groups", { tenant_id: tenantId, name: `Zeno Governance Read ${short}`, description: "New QA-only read group; membership must pass independent governance approval", bu_id: bu.id, created_by: actors.maker.user_id }))[0];
  manifest.own_new_entities.group_id = group.id; await save();
  await audit("group.create", "tenant_groups", group.id, { name: group.name, bu_id: bu.id });
  if (permission !== false) throw new Error("QA requester already has audit.log.read; do not fabricate a denied permission baseline");
  const role = (await mutate("rbac_roles", { tenant_id: tenantId, key: `custom_zeno_${short}`, name: `Zeno QA Read ${short}`, description: "Bounded QA-only read permission; no administrative action", is_system: false, is_assignable: true, created_by: actors.maker.user_id }))[0];
  manifest.own_new_entities.role_id = role.id; await save();
  await mutate("rbac_role_permissions", { role_id: role.id, permission_id: "audit.log.read" });
  await audit("rbac.role.create", "rbac_roles", role.id, { name: role.name, perm_count: 1 });
  await mutate("tenant_group_roles", { group_id: group.id, role_id: role.id, granted_by: actors.maker.user_id });
  await audit("group.roles.set", "tenant_groups", group.id, { role_ids: [role.id] });
  const sources = await call("maker", `workspace_data_sources?${new URLSearchParams({ select: "id,name", tenant_id: `eq.${tenantId}`, limit: "100" })}`);
  const source = sources.find(row => /QA|synthetic|codex/i.test(row.name));
  if (!source) throw new Error("No explicitly named existing synthetic QA source available for a new draft probe");
  const name = `Zeno Governance RLS Probe ${short}`;
  await mutate("rpc/import_recon_definitions_with_owners", { _tenant_id: tenantId, _definitions: [{ name, description: "New synthetic QA draft only; no reconciliation execution or source-row copy", recon_type: "one_sided", sides: [{ data_source_id: source.id }], rules: [] }], _owner_bu_ids: [bu.id], _mode: "skip" });
  const definitions = await call("maker", `recon_definitions?${new URLSearchParams({ select: "id,name,environment", tenant_id: `eq.${tenantId}`, name: `eq.${name}` })}`);
  if (definitions.length !== 1) throw new Error("New QA draft probe readback is not exact");
  manifest.own_new_entities.recon_id = definitions[0].id; await save();
  await mutate("rpc/grant_recon_bu_action", { _recon_id: definitions[0].id, _bu_id: bu.id, _principal_type: "group", _principal_id: group.id, _action: "view", _reason: "New QA-only group grant for actual RLS approval/revocation proof" });
  const input = { environment: "PROD", app_origin: "https://app.reconiq.example/", supabase_url: transport.apiUrl, publishable_key: transport.anonKey, tenant_id: tenantId, tenant_slug: "reconiq-assurance-lab-prod", bu_id: bu.id, workspace_id: workspace.id, group_id: group.id, membership_environment: environment, permission_id: "audit.log.read", resource_probe: { table: "recon_definitions", id: definitions[0].id }, actors: { requester: actors.requester, maker: actors.maker, checker: actors.checker, observer: actors.requester, lapsed: { ...actors.requester, storage_state: actors.requester.lapsed_state } } };
  if (!input.actors.lapsed.storage_state) throw new Error("Actual expired requester state is missing");
  const inputPath = path.join(ownRoot, `INPUT-PROD-${runId}.json`); await writeFile(inputPath, JSON.stringify(input, null, 2), { flag: "wx" });
  manifest.input_file = inputPath; manifest.status = "READY"; await save();
  output.fixture_manifest = manifestPath; output.input_file = inputPath; output.probe_environment = definitions[0].environment;
}
process.stdout.write(`${JSON.stringify(output)}\n`);
