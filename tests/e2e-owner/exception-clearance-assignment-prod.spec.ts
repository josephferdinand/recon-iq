import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Exact-ID assignment proof for the PROD Assurance Lab. Disabled by default.
 * This test never changes exception status or resolves a break. It fails on
 * changed counts, skipped IDs, missing audit rows, or API errors.
 * The database RPC also needs a stale/already-assigned guard before a full run.
 */
const origin = "https://app.reconiq.example";
const supabaseUrl = "https://YOUR_PROJECT_REF.supabase.co";
const tenantSlug = "reconiq-assurance-lab-prod";
const tenantId = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const makerId = "85d57a0a-846d-4a7e-ba94-e5452b9db66c";
const enabled = process.env.FVI_EXCEPTION_CLEARANCE === "YES";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const batchSize = 500;

type ExceptionRow = { id: string; assignee: string | null; status: string; lifecycle_state: string; tenant_id: string };
type AuditRow = { id: number; resource_id: string | null; actor_user_id: string | null; context: { rule_id?: string; assignee_id?: string } | null };
type Dashboard = { totals: { unassigned: number } };

test.describe.configure({ mode: "serial" });
test.use({ trace: "off", video: "off" });
test.skip(!enabled, "Requires FVI_EXCEPTION_CLEARANCE=YES and exact PROD QA configuration");
// Remove this fail-closed gate only after independent PROD migration-ledger AND
// function-definition readback proves 20260923140000 is hosted and active.
test.skip(enabled, "PROD assignment RPC guard deployment has not been verified");

function publicKey(): string {
  const file = process.env.FVI_VAULT_PATH ?? "";
  if (!path.isAbsolute(file) || path.basename(file) !== "Falcon-Veritas-Keys.md")
    throw new Error("Canonical protected FVI vault path is required");
  const vault = readFileSync(file, "utf8");
  const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (start < 0 || end <= start) throw new Error("Canonical credential section missing");
  const row = vault.slice(start, end).split(/\r?\n/u)
    .find((line) => line.startsWith("| `SUPABASE_PROD_ANON_KEY` |"));
  const value = (row?.split("|")[2] ?? "").trim().replace(/^[`<]+|[`>]+$/gu, "");
  if (value.length < 30) throw new Error("Canonical PROD public key missing");
  return value;
}

function makerSession(): string {
  const file = process.env.FVI_OWNER_STORAGE_STATE ?? "";
  if (!path.isAbsolute(file)) throw new Error("Absolute maker storage-state path is required");
  const state = JSON.parse(readFileSync(file, "utf8"));
  const stored = state.origins?.find((item: { origin?: string }) => item.origin === origin)
    ?.localStorage?.find((item: { name?: string }) => item.name === "sb-YOUR_PROJECT_REF-auth-token");
  const parsed = stored ? JSON.parse(stored.value) : null;
  const session = parsed?.access_token ? parsed : parsed?.currentSession;
  if (!session?.access_token || session.user?.id !== makerId)
    throw new Error("Protected PROD maker session is missing or has the wrong actor");
  return session.access_token;
}

function requireRunConfiguration(): { ruleId: string; expected: number } {
  if (process.env.FVI_E2E_BASE_URL !== origin ||
      process.env.FVI_E2E_TENANT_ID !== tenantId ||
      process.env.FVI_E2E_TENANT_SLUG !== tenantSlug)
    throw new Error("Exact PROD origin, tenant ID, and slug are required");
  const ruleId = process.env.FVI_EXCEPTION_RULE_ID ?? "";
  if (!uuidPattern.test(ruleId)) throw new Error("Explicit FVI_EXCEPTION_RULE_ID is required");
  const expectedText = process.env.FVI_EXCEPTION_EXPECTED_UNASSIGNED ?? "";
  if (!/^\d{1,5}$/u.test(expectedText))
    throw new Error("Explicit FVI_EXCEPTION_EXPECTED_UNASSIGNED baseline is required");
  const expected = Number(expectedText);
  if (expected < 1 || expected > 8_136)
    throw new Error("Expected unassigned count must be within the reviewed 8,136 ceiling");
  return { ruleId, expected };
}

async function rest<T>(request: APIRequestContext, token: string, key: string, resource: string, params: URLSearchParams): Promise<T> {
  const response = await request.get(`${supabaseUrl}/rest/v1/${resource}?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    const error = await response.json().catch(() => ({}));
    const code = /^[A-Za-z0-9_]{1,60}$/u.test(error?.code ?? "") ? error.code : "unknown";
    throw new Error(`${resource} read failed: HTTP ${response.status()}, code=${code}`);
  }
  return response.json() as Promise<T>;
}

function openUnassignedQuery(): URLSearchParams {
  return new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    assignee: "is.null",
    status: "eq.open",
    lifecycle_state: "not.in.(resolved,written_off)",
  });
}

async function unassignedIds(request: APIRequestContext, token: string, key: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  while (true) {
    const params = openUnassignedQuery();
    params.set("select", "id");
    params.set("order", "id.asc");
    params.set("limit", String(batchSize));
    if (cursor) params.set("id", `gt.${cursor}`);
    const rows = await rest<Array<{ id: string }>>(request, token, key, "recon_exceptions", params);
    for (const row of rows) {
      if (!uuidPattern.test(row.id) || (cursor && row.id <= cursor))
        throw new Error("Unassigned cursor did not advance over distinct UUIDs");
      ids.push(row.id);
      cursor = row.id;
    }
    if (ids.length > 8_136) throw new Error("Unassigned list exceeds reviewed clearance ceiling");
    if (rows.length < batchSize) break;
  }
  if (new Set(ids).size !== ids.length) throw new Error("Unassigned baseline contains duplicate IDs");
  return ids;
}

async function dashboard(request: APIRequestContext, token: string, key: string): Promise<number> {
  const response = await request.post(`${supabaseUrl}/rest/v1/rpc/get_exception_dashboard`, {
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { _tenant_id: tenantId, _days: 30 },
  });
  if (!response.ok()) throw new Error(`Dashboard RPC failed: HTTP ${response.status()}`);
  const data = await response.json() as Dashboard;
  if (!Number.isSafeInteger(data?.totals?.unassigned) || data.totals.unassigned < 0)
    throw new Error("Dashboard RPC returned an invalid unassigned count");
  return data.totals.unassigned;
}

async function exactRows(request: APIRequestContext, token: string, key: string, ids: string[]): Promise<ExceptionRow[]> {
  const rows: ExceptionRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const slice = ids.slice(offset, offset + 100);
    const params = new URLSearchParams({
      select: "id,assignee,status,lifecycle_state,tenant_id",
      tenant_id: `eq.${tenantId}`, id: `in.(${slice.join(",")})`, limit: String(slice.length),
    });
    rows.push(...await rest<ExceptionRow[]>(request, token, key, "recon_exceptions", params));
  }
  if (rows.length !== ids.length || new Set(rows.map((row) => row.id)).size !== ids.length ||
      rows.some((row) => !ids.includes(row.id) || row.tenant_id !== tenantId))
    throw new Error("Exact tenant-scoped record readback is incomplete");
  return rows;
}

async function latestAuditId(request: APIRequestContext, token: string, key: string): Promise<number> {
  const params = new URLSearchParams({ select: "id", tenant_id: `eq.${tenantId}`, order: "id.desc", limit: "1" });
  const rows = await rest<Array<{ id: number }>>(request, token, key, "audit_log", params);
  return rows[0]?.id ?? 0;
}

async function batchAudits(request: APIRequestContext, token: string, key: string, ids: string[], sinceId: number): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const slice = ids.slice(offset, offset + 100);
    const params = new URLSearchParams({
      select: "id,resource_id,actor_user_id,context",
      tenant_id: `eq.${tenantId}`, action: "eq.exception.auto_assigned",
      actor_user_id: `eq.${makerId}`, resource_id: `in.(${slice.join(",")})`,
      id: `gt.${sinceId}`, limit: String(slice.length),
    });
    rows.push(...await rest<AuditRow[]>(request, token, key, "audit_log", params));
  }
  return rows;
}

async function browserDashboard(page: Page, expected: number, screenshotPath: string) {
  await page.goto(`/${tenantSlug}/workspace?page=exception-dashboard`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Exception dashboard" })).toBeVisible();
  const tile = page.locator('[data-slot="card"]').filter({ has: page.getByText("Unassigned", { exact: true }) });
  await expect(tile).toHaveCount(1);
  await expect(tile.getByText(expected.toLocaleString("en-US"), { exact: true })).toBeVisible();
  await page.screenshot({ path: screenshotPath, fullPage: true });
}

test("assign exact unassigned PROD exceptions in audited, nonoverlapping batches", async ({ page, request }, info) => {
  test.setTimeout(20 * 60_000);
  const { ruleId, expected } = requireRunConfiguration();
  const token = makerSession();
  const key = publicKey();
  const ruleParams = new URLSearchParams({
    select: "id,enabled,recon_id,strategy,assignee_pool,tenant_id",
    tenant_id: `eq.${tenantId}`, id: `eq.${ruleId}`, limit: "1",
  });
  const [rule] = await rest<Array<{ id: string; enabled: boolean; recon_id: string | null; strategy: string; assignee_pool: string[]; tenant_id: string }>>(
    request, token, key, "exception_assignment_rules", ruleParams,
  );
  if (!rule || !rule.enabled || rule.recon_id !== null ||
      !["round_robin", "load_balanced"].includes(rule.strategy) ||
      rule.assignee_pool.length === 0 || rule.assignee_pool.length > 20 ||
      new Set(rule.assignee_pool).size !== rule.assignee_pool.length)
    throw new Error("Explicit rule must be enabled, tenant-global, supported, and have a distinct assignee pool");
  const members = await rest<Array<{ user_id: string }>>(request, token, key, "tenant_members",
    new URLSearchParams({ select: "user_id", tenant_id: `eq.${tenantId}`, active: "eq.true",
      user_id: `in.(${rule.assignee_pool.join(",")})`, limit: "20" }));
  if (new Set(members.map((member) => member.user_id)).size !== rule.assignee_pool.length)
    throw new Error("Every rule assignee must be an active member of the target tenant");

  const baseline = await unassignedIds(request, token, key);
  if (baseline.length !== expected || await dashboard(request, token, key) !== expected)
    throw new Error("Exact baseline IDs and dashboard count differ from the approved expected count");
  await browserDashboard(page, expected, info.outputPath("exception-assignment-before.png"));
  const processed = new Set<string>();
  let auditCursor = await latestAuditId(request, token, key);

  for (let offset = 0; offset < baseline.length; offset += batchSize) {
    const ids = baseline.slice(offset, offset + batchSize);
    if (ids.some((id) => processed.has(id))) throw new Error("Assignment batch overlaps a prior batch");
    const before = await exactRows(request, token, key, ids);
    if (before.some((row) => row.assignee !== null || row.status !== "open" ||
        ["resolved", "written_off"].includes(row.lifecycle_state)))
      throw new Error("Batch contains an assigned or closed exception; aborting before mutation");

    const response = await request.post(`${supabaseUrl}/rest/v1/rpc/assign_exceptions_from_rule`, {
      headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { _tenant_id: tenantId, _rule_id: ruleId, _exception_ids: ids },
    });
    if (!response.ok()) throw new Error(`Governed assignment RPC failed: HTTP ${response.status()}`);
    const result = await response.json() as { assigned?: number; skipped?: number };
    if (result.assigned !== ids.length || result.skipped !== 0)
      throw new Error(`Assignment did not make complete progress in batch ${offset / batchSize + 1}`);

    const after = await exactRows(request, token, key, ids);
    const pool = new Set(rule.assignee_pool);
    if (after.some((row) => !row.assignee || !pool.has(row.assignee) || row.status !== "open" ||
        ["resolved", "written_off"].includes(row.lifecycle_state)))
      throw new Error("Assigned record readback failed or exception status changed");
    const audits = await batchAudits(request, token, key, ids, auditCursor);
    const byId = new Map(audits.map((row) => [row.resource_id, row]));
    if (audits.length !== ids.length || byId.size !== ids.length ||
        after.some((row) => byId.get(row.id)?.context?.rule_id !== ruleId ||
          byId.get(row.id)?.context?.assignee_id !== row.assignee))
      throw new Error("Per-exception assignment audit readback is incomplete or inconsistent");
    auditCursor = Math.max(auditCursor, ...audits.map((row) => row.id));
    ids.forEach((id) => processed.add(id));
    const remaining = expected - processed.size;
    if (await dashboard(request, token, key) !== remaining)
      throw new Error("Dashboard unassigned count did not decrease by the exact assigned batch");
    await info.attach(`batch-${offset / batchSize + 1}`, {
      body: JSON.stringify({ tenant_id: tenantId, rule_id: ruleId, ids, assigned: ids.length,
        skipped: 0, remaining, audit_ids: audits.map((row) => row.id) }),
      contentType: "application/json",
    });
  }

  if (processed.size !== expected || (await unassignedIds(request, token, key)).length !== 0 ||
      await dashboard(request, token, key) !== 0)
    throw new Error("Terminal distinct-ID, source record, and dashboard counts disagree");
  await browserDashboard(page, 0, info.outputPath("exception-assignment-after.png"));
});
