import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const makerStatePath = process.env.FVI_REFERENCE_MAKER_STATE ?? "";
const checkerStatePath = process.env.FVI_REFERENCE_CHECKER_STATE ?? "";
const anonPath = process.env.FVI_PROD_ANON_KEY_FILE ?? "";
for (const value of [makerStatePath, checkerStatePath, anonPath]) {
  if (!path.isAbsolute(value)) throw new Error("All protected input paths must be absolute");
}
if (process.env.FVI_ALLOW_REFERENCE_RECON_ASSURANCE !== "YES") {
  throw new Error("Set FVI_ALLOW_REFERENCE_RECON_ASSURANCE=YES for retained PROD test data");
}

function extractSession(state) {
  for (const item of (state.origins ?? []).flatMap((origin) => origin.localStorage ?? [])) {
    try {
      const parsed = JSON.parse(item.value);
      const candidate = parsed?.access_token ? parsed : parsed?.currentSession ?? null;
      if (candidate?.access_token && candidate?.refresh_token) return candidate;
    } catch { /* unrelated local-storage value */ }
  }
  throw new Error("No Supabase session exists in protected browser state");
}

async function clientFromState(statePath, anon) {
  const session = extractSession(JSON.parse(await readFile(statePath, "utf8")));
  const client = createClient("https://YOUR_PROJECT_REF.supabase.co", anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const established = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (established.error || !established.data.user) throw new Error("Protected session could not be established");
  return { client, userId: established.data.user.id };
}

const anon = (await readFile(anonPath, "utf8")).trim();
const maker = await clientFromState(makerStatePath, anon);
const checker = await clientFromState(checkerStatePath, anon);
if (maker.userId === checker.userId) throw new Error("Maker and checker identities must differ");

const { data: tenant, error: tenantError } = await maker.client
  .from("tenants").select("id,environment").eq("slug", "reconiq-assurance-lab-prod").single();
if (tenantError || !tenant || tenant.environment !== "prod") throw new Error("Assurance Lab PROD tenant guard failed");
const { data: memberships, error: membershipError } = await maker.client
  .from("tenant_members").select("user_id,role,active").eq("tenant_id", tenant.id)
  .in("user_id", [maker.userId, checker.userId]);
if (membershipError || memberships?.length !== 2
    || memberships.some((row) => row.role !== "tenant_admin" || !row.active)) {
  throw new Error("Active maker/checker tenant administrators are required");
}

const tableName = "Assurance | PROD | Currency Alias Master | 2026-09-08";
let { data: referenceTable, error: tableError } = await maker.client
  .from("reference_data_tables").select("id,key_columns,value_columns,published_version_id")
  .eq("tenant_id", tenant.id).eq("name", tableName).maybeSingle();
if (tableError) throw tableError;
if (!referenceTable) {
  const created = await maker.client.from("reference_data_tables").insert({
    tenant_id: tenant.id,
    name: tableName,
    description: "Retained ISO currency-alias master for managed Reference Data reconciliation assurance.",
    key_columns: ["alias"],
    value_columns: ["canonical"],
    created_by: maker.userId,
  }).select("id,key_columns,value_columns,published_version_id").single();
  if (created.error || !created.data) throw created.error ?? new Error("Reference table creation failed");
  referenceTable = created.data;
}
if (referenceTable.key_columns.join(",") !== "alias"
    || referenceTable.value_columns.join(",") !== "canonical") {
  throw new Error("Existing assurance reference table schema differs");
}

const aliasRows = [
  { alias: "US DOLLAR", canonical: "USD" },
  { alias: "USD", canonical: "USD" },
  { alias: "EURO", canonical: "EUR" },
  { alias: "EUR", canonical: "EUR" },
];
let { data: versions, error: versionsError } = await maker.client
  .from("reference_data_versions").select("id,status,version_number,content_sha256,row_count")
  .eq("tenant_id", tenant.id).eq("table_id", referenceTable.id)
  .order("version_number", { ascending: false }).limit(1);
if (versionsError) throw versionsError;
let version = versions?.[0];
if (!version) {
  const staged = await maker.client.rpc("stage_reference_data_version", {
    _tenant_id: tenant.id,
    _table_id: referenceTable.id,
    _rows: aliasRows,
    _effective_from: new Date().toISOString().slice(0, 10),
    _effective_to: null,
    _change_note: "Initial ISO currency aliases for retained reconciliation assurance",
  });
  if (staged.error || !staged.data?.[0]) throw staged.error ?? new Error("Reference version stage failed");
  version = { ...staged.data[0], status: "draft" };
}
if (version.status === "draft") {
  const submitted = await maker.client.rpc("submit_reference_data_version", {
    _tenant_id: tenant.id, _version_id: version.id ?? version.version_id,
  });
  if (submitted.error || submitted.data !== "pending_approval") throw submitted.error ?? new Error("Reference submit failed");
  version.status = "pending_approval";
}
if (version.status === "pending_approval") {
  const decided = await checker.client.rpc("decide_reference_data_version", {
    _tenant_id: tenant.id,
    _version_id: version.id ?? version.version_id,
    _approve: true,
    _reason: "Independent review of ISO currency aliases and retained test evidence",
  });
  if (decided.error || decided.data !== "published") throw decided.error ?? new Error("Reference approval failed");
  version.status = "published";
}
if (version.status !== "published") throw new Error("Assurance reference version is not published");
const versionId = version.id ?? version.version_id;

const sourceDefinitions = [
  {
    name: "Assurance | PROD | Broker Currency Aliases | 2026-09-08",
    filename: "broker-currency-aliases-20260908.json",
    rows: [
      { transaction_id: "FX-001", currency_label: "US DOLLAR", amount: "100.00" },
      { transaction_id: "FX-002", currency_label: "EURO", amount: "200.00" },
    ],
  },
  {
    name: "Assurance | PROD | Custodian ISO Currency | 2026-09-08",
    filename: "custodian-iso-currency-20260908.json",
    rows: [
      { transaction_id: "FX-001", currency_label: "USD", amount: "100.00" },
      { transaction_id: "FX-002", currency_label: "EUR", amount: "200.00" },
    ],
  },
];
const sources = [];
for (const definition of sourceDefinitions) {
  let { data: source, error: sourceError } = await maker.client.from("workspace_data_sources")
    .select("id,name").eq("tenant_id", tenant.id).eq("name", definition.name).maybeSingle();
  if (sourceError) throw sourceError;
  const columns = [
    { name: "transaction_id", type: "string", nullable: false },
    { name: "currency_label", type: "string", nullable: false },
    { name: "amount", type: "number", nullable: false },
  ];
  if (!source) {
    const created = await maker.client.from("workspace_data_sources").insert({
      tenant_id: tenant.id,
      name: definition.name,
      description: "Retained realistic synthetic currency-alias reconciliation source.",
      source_type: "json",
      status: "ready",
      inferred_schema: columns,
      sample_rows: definition.rows,
      row_count: definition.rows.length,
      created_by: maker.userId,
    }).select("id,name").single();
    if (created.error || !created.data) throw created.error ?? new Error("Assurance source creation failed");
    source = created.data;
  }
  const { data: existingUpload, error: uploadLookupError } = await maker.client
    .from("workspace_data_source_uploads").select("id,content_sha256,row_count")
    .eq("tenant_id", tenant.id).eq("data_source_id", source.id).eq("filename", definition.filename)
    .maybeSingle();
  if (uploadLookupError) throw uploadLookupError;
  const serialized = JSON.stringify(definition.rows);
  const hash = createHash("sha256").update(serialized).digest("hex");
  if (existingUpload) {
    if (existingUpload.content_sha256 !== hash || existingUpload.row_count !== definition.rows.length) {
      throw new Error("Existing assurance upload differs; refusing replacement");
    }
  } else {
    const inserted = await maker.client.from("workspace_data_source_uploads").insert({
      tenant_id: tenant.id,
      data_source_id: source.id,
      filename: definition.filename,
      mime_type: "application/json",
      size_bytes: Buffer.byteLength(serialized),
      row_count: definition.rows.length,
      columns,
      sample_rows: definition.rows,
      rows: definition.rows,
      content_sha256: hash,
      uploaded_by: maker.userId,
    });
    if (inserted.error) throw inserted.error;
  }
  sources.push(source);
}

const reconName = "Assurance | PROD | Governed Currency Alias Recon | 2026-09-08";
const rules = [
  {
    id: "currency-alias",
    kind: "reference_lookup",
    description: "Canonicalize broker and custodian currency labels through published Reference Data.",
    fields: { A: "currency_label", B: "currency_label" },
    is_key: true,
    params: {
      reference_table_id: referenceTable.id,
      reference_value_column: "canonical",
      reference_as_of: new Date().toISOString().slice(0, 10),
    },
  },
  {
    id: "transaction-id",
    kind: "exact_match",
    description: "Match transaction identity.",
    fields: { A: "transaction_id", B: "transaction_id" },
    is_key: true,
    params: {},
  },
  {
    id: "amount",
    kind: "numeric_equals",
    description: "Confirm equal settlement amount.",
    fields: { A: "amount", B: "amount" },
    is_key: false,
    params: {},
  },
];
const sides = [
  { side_id: "A", label: "Broker", data_source_id: sources[0].id },
  { side_id: "B", label: "Custodian", data_source_id: sources[1].id },
];
let { data: recon, error: reconError } = await maker.client.from("recon_definitions")
  .select("id").eq("tenant_id", tenant.id).eq("name", reconName).maybeSingle();
if (reconError) throw reconError;
if (!recon) {
  const created = await maker.client.from("recon_definitions").insert({
    tenant_id: tenant.id,
    name: reconName,
    description: "Retained two-sided proof that governed currency aliases increase matching accuracy.",
    recon_type: "two_sided",
    sides,
    rules,
    status: "active",
    created_by: maker.userId,
  }).select("id").single();
  if (created.error || !created.data) throw created.error ?? new Error("Assurance reconciliation creation failed");
  recon = created.data;
}
await maker.client.from("audit_log").insert({
  actor_user_id: maker.userId,
  tenant_id: tenant.id,
  scope: "workspace",
  action: "test.reference_reconciliation.provisioned",
  resource_type: "recon_definition",
  resource_id: recon.id,
  context: { synthetic: true, reference_table_id: referenceTable.id, reference_version_id: versionId, rows_per_side: 2 },
});

console.log(JSON.stringify({
  ok: true,
  tenant_id: tenant.id,
  table_id: referenceTable.id,
  version_id: versionId,
  version_status: version.status,
  content_sha256: version.content_sha256,
  source_ids: sources.map((source) => source.id),
  recon_id: recon.id,
  rows_per_side: 2,
  credentials_changed: false,
}));
