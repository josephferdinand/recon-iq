import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

if (process.env.FVI_ALLOW_DEV_FIXTURE_PROVISIONING !== "YES") {
  throw new Error("Set FVI_ALLOW_DEV_FIXTURE_PROVISIONING=YES for this controlled DEV mutation");
}

const projectRef = process.env.SUPABASE_PROJECT_REF ?? "";
const expectedRef = process.env.FVI_EXPECTED_SUPABASE_REF ?? "";
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!expectedRef || projectRef !== expectedRef) throw new Error("Selected project is not the expected DEV project");
if (new URL(supabaseUrl).hostname !== `${expectedRef}.supabase.co`) {
  throw new Error("Supabase URL does not match the expected DEV project");
}
if (serviceKey.length < 40) throw new Error("A protected DEV service-role key is required");

const tenantSlug = process.env.FVI_TEST_TENANT_SLUG ?? "fvi-validation-lab-20260904";
const pdfPath = path.resolve(
  process.env.FVI_TEST_PDF_PATH ?? "output/pdf/fvi-validation-bank-statement.pdf",
);
const evidencePath = path.resolve(
  process.env.FVI_FIXTURE_EVIDENCE_PATH ?? "_e2e_run/owner-session/dev-validation-fixtures.json",
);
const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function one(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const tenants = await one(
  client.from("tenants").select("id,slug,name").eq("slug", tenantSlug),
  "tenant lookup",
);
if (tenants.length !== 1) throw new Error("Expected exactly one dedicated validation tenant");
const tenant = tenants[0];

const { data: buckets, error: bucketListError } = await client.storage.listBuckets();
if (bucketListError) throw new Error(`Storage bucket lookup: ${bucketListError.message}`);
const aidpBucket = buckets.find((bucket) => bucket.id === "aidp");
if (!aidpBucket) {
  const { error: bucketCreateError } = await client.storage.createBucket("aidp", {
    public: false,
    fileSizeLimit: 52_428_800,
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
  });
  if (bucketCreateError) throw new Error(`AIDP bucket creation: ${bucketCreateError.message}`);
} else if (aidpBucket.public) {
  throw new Error("The existing AIDP bucket is public; refuse fixture upload until corrected");
}

const documentKey = `fvi-validation:${tenant.id}:bank-statement:20260904`;
let document = await one(
  client
    .from("aidp_documents")
    .select("id,tenant_id,original_filename,status")
    .eq("idempotency_key", documentKey)
    .maybeSingle(),
  "AIDP document lookup",
);
if (!document) {
  document = await one(
    client
      .from("aidp_documents")
      .insert({
        id: randomUUID(),
        tenant_id: tenant.id,
        original_filename: "fvi-validation-bank-statement.pdf",
        mime: "application/pdf",
        bytes: (await readFile(pdfPath)).byteLength,
        page_count: 1,
        status: "queued",
        extraction: { synthetic: true, purpose: "FVI DEV end-to-end validation" },
        idempotency_key: documentKey,
      })
      .select("id,tenant_id,original_filename,status")
      .single(),
    "AIDP document insert",
  );
}

const pdfBytes = await readFile(pdfPath);
const storagePath = `${tenant.id}/${document.id}/source.pdf`;
const { error: uploadError } = await client.storage.from("aidp").upload(storagePath, pdfBytes, {
  contentType: "application/pdf",
  upsert: true,
});
if (uploadError) throw new Error(`AIDP PDF upload: ${uploadError.message}`);

const article = await one(
  client
    .from("kb_articles")
    .select("id,status,title")
    .eq("status", "published")
    .order("created_at", { ascending: true })
    .limit(1)
    .single(),
  "knowledge article lookup",
);

const pack = await one(
  client
    .from("regulatory_template_packs")
    .select("id,title,version,status")
    .eq("status", "published")
    .order("published_at", { ascending: true })
    .limit(1)
    .single(),
  "regulatory pack lookup",
);
let install = await one(
  client
    .from("regulatory_pack_installs")
    .select("id,tenant_id,pack_id,status")
    .eq("tenant_id", tenant.id)
    .eq("pack_id", pack.id)
    .maybeSingle(),
  "regulatory installation lookup",
);
if (!install) {
  install = await one(
    client
      .from("regulatory_pack_installs")
      .insert({
        tenant_id: tenant.id,
        pack_id: pack.id,
        installed_version: pack.version,
        status: "ready",
        completed_at: new Date().toISOString(),
        materialized_artifacts: {
          synthetic: true,
          folder: "FVI DEV Regulatory Validation",
          pipeline_ids: [],
        },
      })
      .select("id,tenant_id,pack_id,status")
      .single(),
    "regulatory installation insert",
  );
}

const leadEmail = "fvi.validation.20260904@example.invalid";
let lead = await one(
  client.from("mkt_leads").select("id,email,stage").eq("email", leadEmail).maybeSingle(),
  "marketing lead lookup",
);
if (!lead) {
  lead = await one(
    client
      .from("mkt_leads")
      .insert({
        first_name: "Avery",
        last_name: "Validation",
        company: "FVI Synthetic Clearing Bank",
        email: leadEmail,
        job_title: "Reconciliation Operations Lead",
        country: "GB",
        industry: "Banking",
        company_size: "1,000-5,000",
        monthly_txn_volume: "1,000,000",
        current_recon_tool: "Synthetic legacy platform",
        erp_platform: "Synthetic ERP",
        areas_of_interest: ["cash-reconciliation", "exception-management", "regulatory-reporting"],
        message: "Synthetic DEV lead retained for authorised FVI end-to-end validation.",
        category: "sales",
        source: "import",
        stage: "qualified",
        temperature: "hot",
        score: 92,
        consent_at: new Date().toISOString(),
        metadata: { synthetic: true, purpose: "FVI DEV end-to-end validation" },
      })
      .select("id,email,stage")
      .single(),
    "marketing lead insert",
  );
}

const evidence = {
  generated_at: new Date().toISOString(),
  environment: "DEV",
  synthetic_only: true,
  tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
  document: { id: document.id, storage_path: storagePath, filename: document.original_filename },
  knowledge_article: { id: article.id, title: article.title },
  regulatory_install: { id: install.id, pack_id: pack.id, title: pack.title, status: install.status },
  marketing_lead: { id: lead.id, stage: lead.stage },
};
await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  environment: evidence.environment,
  tenant_slug: tenant.slug,
  fixtures: ["tenant", "document", "knowledge_article", "regulatory_install", "marketing_lead"],
  evidence_path: path.relative(process.cwd(), evidencePath),
}));
