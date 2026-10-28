import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const enabled = process.env.FVI_RUN_MY_TEMPLATE_MAKER === "YES";
const origin = "https://app.reconiq.example";
const tenantId = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const makerId = "85d57a0a-846d-4a7e-ba94-e5452b9db66c";
const reconId = "c939558c-23cf-4ffe-bf48-558cbb2ef457";
const title = "Assurance Vostro Governance — 2026-09-15";
const checkerId = "2849df7a-f63c-4b3b-9b5f-1c01c3ae8a43";
function publicKey() {
  const file = process.env.FVI_VAULT_PATH ?? "";
  if (!path.isAbsolute(file) || path.basename(file) !== "Falcon-Veritas-Keys.md")
    throw new Error("The canonical protected vault is required");
  const vault = readFileSync(file, "utf8");
  const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (start < 0 || end <= start) throw new Error("Canonical credential section missing");
  const row = vault
    .slice(start, end)
    .split(/\r?\n/u)
    .find((line) => line.startsWith("| `SUPABASE_PROD_ANON_KEY` |"));
  const value = (row?.split("|")[2] ?? "").trim().replace(/^[`<]+|[`>]+$/gu, "");
  if (value.length < 30) throw new Error("Canonical PROD public key missing");
  return value;
}
if (enabled && process.env.FVI_E2E_BASE_URL !== origin)
  throw new Error("This proof is restricted to FVI PROD");
test.skip(!enabled, "Set FVI_RUN_MY_TEMPLATE_MAKER=YES with the protected maker session");
test.use({
  channel: "chrome",
  viewport: { width: 1440, height: 1000 },
  trace: "off",
  video: "off",
});
test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.locator(".driver-popover-close-btn"), async (close) =>
    close.click(),
  );
});

async function api(page: Page, path: string, actorId = makerId) {
  const state = await page.context().storageState();
  const stored = state.origins
    .find((item) => item.origin === origin)
    ?.localStorage.find((item) => item.name === "sb-YOUR_PROJECT_REF-auth-token");
  const parsed = stored ? JSON.parse(stored.value) : null;
  const session = parsed?.access_token ? parsed : parsed?.currentSession;
  const key = publicKey();
  if (!session?.access_token || !key)
    throw new Error("Protected maker session/public key required");
  expect(session.user?.id).toBe(actorId);
  const response = await fetch(`https://YOUR_PROJECT_REF.supabase.co/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${session.access_token}` },
    redirect: "error",
  });
  if (response.status !== 200) {
    const failure = await response.json().catch(() => ({}));
    const code = /^[A-Za-z0-9_]{1,60}$/u.test(failure.code ?? "") ? failure.code : "unknown";
    throw new Error(`Maker Data API readback failed: HTTP ${response.status}, code=${code}`);
  }
  return response.json();
}

test("maker creates a real immutable template, submits it, and cannot self-approve", async ({
  page,
}, info) => {
  await page.goto("/reconiq-assurance-lab-prod/tenant/templates");
  await page.getByRole("tab", { name: "Installed", exact: true }).click();
  const query = new URLSearchParams({
    select:
      "id,title,status,current_semver,created_by,submitted_by,approved_by,source_recon_definition_id",
    tenant_id: `eq.${tenantId}`,
    title: `eq.${title}`,
    limit: "2",
  });
  let rows = await api(page, `tenant_templates?${query}`);
  expect(rows.length).toBeLessThanOrEqual(1);
  const form = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Create or version My Template", { exact: true }) });
  await expect(form).toHaveCount(1);
  if (rows.length === 0) {
    await expect(form.getByRole("combobox")).toHaveCount(2);
    await form.getByRole("combobox").nth(1).click();
    await page
      .getByRole("option", {
        name: "FVI-GEN-2WAY-000009 · Assurance Starter Vostro — 2026-09-15 QA",
        exact: true,
      })
      .click();
    const inputs = form.getByRole("textbox");
    await expect(inputs).toHaveCount(3);
    await inputs.nth(0).fill(title);
    await inputs.nth(1).fill("1.0.0");
    await inputs
      .nth(2)
      .fill("Retained browser/API maker-checker proof from the real strict Vostro Starter.");
    await page.screenshot({ path: info.outputPath("my-template-before-create.png") });
    await form.getByRole("button", { name: "Create My Template", exact: true }).click();
    await expect(page.getByText("My Template created", { exact: true })).toBeVisible();
    rows = await api(page, `tenant_templates?${query}`);
  }
  expect(rows).toHaveLength(1);
  expect(rows[0].created_by).toBe(makerId);
  expect(rows[0].source_recon_definition_id).toBe(reconId);
  expect(rows[0].current_semver).toBe("1.0.0");
  expect(["draft", "review"]).toContain(rows[0].status);
  const repository = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Tenant repository", { exact: true }) });
  const row = repository
    .locator("div.p-2.border.rounded-md")
    .filter({ has: page.getByText(title, { exact: true }) });
  await expect(row).toHaveCount(1);
  if (rows[0].status === "draft") {
    await row.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByText("Template is now review", { exact: true })).toBeVisible();
  }
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByText("invalid lifecycle transition or dual-control violation", { exact: true }),
  ).toBeVisible();
  rows = await api(page, `tenant_templates?${query}`);
  expect(rows[0].status).toBe("review");
  expect(rows[0].submitted_by).toBe(makerId);
  expect(rows[0].approved_by).toBeNull();
  const versions = await api(
    page,
    `tenant_template_versions?${new URLSearchParams({
      select: "id,semver,created_by,source_recon_definition_id",
      tenant_id: `eq.${tenantId}`,
      tenant_template_id: `eq.${rows[0].id}`,
    })}`,
  );
  expect(versions).toHaveLength(1);
  expect(versions[0].semver).toBe("1.0.0");
  expect(versions[0].created_by).toBe(makerId);
  const audits = await api(
    page,
    `mkt_audit_log?${new URLSearchParams({
      select: "id,action,actor_id",
      tenant_id: `eq.${tenantId}`,
      entity_type: "eq.tenant_template",
      entity_id: `eq.${rows[0].id}`,
    })}`,
  );
  expect(audits.map((event: { action: string }) => event.action)).toContain("create");
  expect(audits.map((event: { action: string }) => event.action)).toContain("submit");
  expect(audits.some((event: { action: string }) => event.action === "approve")).toBe(false);
  await info.attach("maker-api-evidence", {
    body: JSON.stringify({ template: rows[0], versions, audits }, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("my-template-self-approval-denied.png") });
});

test.describe("independent checker", () => {
  test.use({ storageState: process.env.FVI_CHECKER_STORAGE_STATE });
  test("approves and publishes the submitted version with a distinct audit actor", async ({
    page,
  }, info) => {
    test.skip(!process.env.FVI_CHECKER_STORAGE_STATE, "Protected checker session required");
    await page.goto("/reconiq-assurance-lab-prod/tenant/templates");
    await page.getByRole("tab", { name: "Installed", exact: true }).click();
    const query = new URLSearchParams({
      select: "id,status,current_semver,created_by,submitted_by,approved_by",
      tenant_id: `eq.${tenantId}`,
      title: `eq.${title}`,
      limit: "2",
    });
    let rows = await api(page, `tenant_templates?${query}`, checkerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].created_by).toBe(makerId);
    expect(rows[0].submitted_by).toBe(makerId);
    expect(rows[0].current_semver).toBe("1.0.0");
    expect(["review", "approved", "published"]).toContain(rows[0].status);
    const row = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("Tenant repository", { exact: true }) })
      .locator("div.p-2.border.rounded-md")
      .filter({ has: page.getByText(title, { exact: true }) });
    await expect(row).toHaveCount(1);
    if (rows[0].status === "review") {
      await row.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByText("Template is now approved", { exact: true })).toBeVisible();
    }
    if (rows[0].status !== "published") {
      await row.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(page.getByText("Template is now published", { exact: true })).toBeVisible();
    }
    rows = await api(page, `tenant_templates?${query}`, checkerId);
    expect(rows[0].status).toBe("published");
    expect(rows[0].approved_by).toBe(checkerId);
    const audits = await api(
      page,
      `mkt_audit_log?${new URLSearchParams({
        select: "id,action,actor_id",
        tenant_id: `eq.${tenantId}`,
        entity_type: "eq.tenant_template",
        entity_id: `eq.${rows[0].id}`,
      })}`,
      checkerId,
    );
    for (const action of ["approve", "publish"]) {
      const events = audits.filter((event: { action: string }) => event.action === action);
      expect(events).toHaveLength(1);
      expect(events[0].actor_id).toBe(checkerId);
    }
    await info.attach("checker-api-evidence", {
      body: JSON.stringify({ template: rows[0], audits }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("my-template-independent-checker-published.png"),
    });
  });
});

test("version 1.1 requires renewed approval and instantiates the real configuration", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const checkerState = process.env.FVI_CHECKER_STORAGE_STATE;
  test.skip(!checkerState, "Protected checker session required");
  const query = new URLSearchParams({
    select: "id,status,current_semver,spec,submitted_by,approved_by",
    tenant_id: `eq.${tenantId}`,
    title: `eq.${title}`,
    limit: "2",
  });
  const read = async (activePage = page, actor = makerId) => {
    const rows = await api(activePage, `tenant_templates?${query}`, actor);
    expect(rows).toHaveLength(1);
    return rows[0];
  };
  const repositoryRow = (activePage: Page) =>
    activePage
      .locator('[data-slot="card"]')
      .filter({ has: activePage.getByText("Tenant repository", { exact: true }) })
      .locator("div.p-2.border.rounded-md")
      .filter({ has: activePage.getByText(title, { exact: true }) });
  await page.goto("/reconiq-assurance-lab-prod/tenant/templates");
  await page.getByRole("tab", { name: "Installed", exact: true }).click();
  let template = await read();
  const versionsQuery = new URLSearchParams({
    select: "id,semver,spec,created_by",
    tenant_id: `eq.${tenantId}`,
    tenant_template_id: `eq.${template.id}`,
    order: "semver.asc",
  });
  const beforeVersions = await api(page, `tenant_template_versions?${versionsQuery}`);
  const original = beforeVersions.find((version: { semver: string }) => version.semver === "1.0.0");
  expect(original).toBeTruthy();
  if (template.current_semver === "1.0.0") {
    expect(template.status).toBe("published");
    expect(template.approved_by).toBe(checkerId);
    const form = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("Create or version My Template", { exact: true }) });
    await form.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: title, exact: true }).click();
    await form.getByRole("combobox").nth(1).click();
    await page
      .getByRole("option", {
        name: "FVI-GEN-2WAY-000009 · Assurance Starter Vostro — 2026-09-15 QA",
        exact: true,
      })
      .click();
    await form.getByRole("textbox").nth(1).fill("1.1.0");
    await form
      .getByRole("textbox")
      .nth(2)
      .fill("Version-bound approval proof; preserve the exact strict Vostro source configuration.");
    await form.getByRole("button", { name: "Save immutable version", exact: true }).click();
    await expect(page.getByText("Immutable template version saved", { exact: true })).toBeVisible();
    template = await read();
    expect(template.status).toBe("draft");
    expect(template.approved_by).toBeNull();
    expect(template.submitted_by).toBeNull();
    await info.attach("approval-reset-evidence", {
      body: JSON.stringify({
        id: template.id,
        version: template.current_semver,
        status: template.status,
        approved_by: template.approved_by,
        submitted_by: template.submitted_by,
      }),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("my-template-v11-approval-reset.png") });
  }
  expect(template.current_semver).toBe("1.1.0");
  if (template.status === "draft") {
    await repositoryRow(page).getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByText("Template is now review", { exact: true })).toBeVisible();
    template = await read();
  }
  if (template.status === "review") {
    await repositoryRow(page).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(
      page.getByText("invalid lifecycle transition or dual-control violation", { exact: true }),
    ).toBeVisible();
    expect((await read()).approved_by).toBeNull();
  }
  const checkerContext = await browser.newContext({
    baseURL: origin,
    storageState: checkerState,
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const checker = await checkerContext.newPage();
    await checker.addLocatorHandler(checker.locator(".driver-popover-close-btn"), (close) =>
      close.click(),
    );
    await checker.goto("/reconiq-assurance-lab-prod/tenant/templates");
    await checker.getByRole("tab", { name: "Installed", exact: true }).click();
    template = await read(checker, checkerId);
    if (template.status === "review") {
      await repositoryRow(checker).getByRole("button", { name: "Approve", exact: true }).click();
      await expect(checker.getByText("Template is now approved", { exact: true })).toBeVisible();
      template = await read(checker, checkerId);
    }
    if (template.status === "approved") {
      await repositoryRow(checker).getByRole("button", { name: "Publish", exact: true }).click();
      await expect(checker.getByText("Template is now published", { exact: true })).toBeVisible();
    }
    template = await read(checker, checkerId);
    expect(template.status).toBe("published");
    expect(template.approved_by).toBe(checkerId);
    await repositoryRow(checker).getByRole("button", { name: "Unpublish", exact: true }).click();
    await expect(checker.getByText("Template is now approved", { exact: true })).toBeVisible();
    expect((await read(checker, checkerId)).status).toBe("approved");
    await repositoryRow(checker).getByRole("button", { name: "Publish", exact: true }).click();
    await expect(checker.getByText("Template is now published", { exact: true })).toBeVisible();
    await checker.screenshot({
      path: info.outputPath("my-template-v11-independent-publication.png"),
    });
  } finally {
    await checkerContext.close();
  }
  const versions = await api(page, `tenant_template_versions?${versionsQuery}`);
  expect(versions).toHaveLength(2);
  expect(versions[0]).toEqual(original);
  expect(versions[1].semver).toBe("1.1.0");
  expect(versions[1].created_by).toBe(makerId);
  const definitionsQuery = new URLSearchParams({
    select: "id,name,recon_code,recon_type,sides,rules,status,tenant_template_id",
    tenant_id: `eq.${tenantId}`,
    tenant_template_id: `eq.${template.id}`,
    limit: "2",
  });
  let definitions = await api(page, `recon_definitions?${definitionsQuery}`);
  expect(definitions.length).toBeLessThanOrEqual(1);
  if (definitions.length === 0) {
    await page.reload();
    await page.getByRole("tab", { name: "Installed", exact: true }).click();
    await repositoryRow(page)
      .getByRole("button", { name: "Create reconciliation", exact: true })
      .click();
    await expect(page.getByText(/^Created runnable draft FVI-/u)).toBeVisible();
    definitions = await api(page, `recon_definitions?${definitionsQuery}`);
  }
  expect(definitions).toHaveLength(1);
  expect(definitions[0].sides).toEqual(versions[1].spec.sides);
  expect(definitions[0].rules).toEqual(versions[1].spec.rules);
  expect(definitions[0].recon_type).toBe(versions[1].spec.recon_type);
  const audits = await api(
    page,
    `mkt_audit_log?${new URLSearchParams({ select: "id,action,actor_id,after", tenant_id: `eq.${tenantId}`, entity_type: "eq.tenant_template", entity_id: `eq.${template.id}`, order: "id.asc" })}`,
  );
  expect(audits.some((event: { action: string }) => event.action === "unpublish")).toBe(true);
  expect(
    audits
      .filter((event: { action: string }) => event.action === "approve")
      .every((event: { actor_id: string }) => event.actor_id === checkerId),
  ).toBe(true);
  await info.attach("v11-api-evidence", {
    body: JSON.stringify({ template: await read(), versions, definitions, audits }),
    contentType: "application/json",
  });
});

test("the instantiated version 1.1 reconciliation executes with retained match and audit evidence", async ({
  page,
}, info) => {
  await page.goto("/reconiq-assurance-lab-prod/workspace?page=recons");
  const templates = await api(
    page,
    `tenant_templates?${new URLSearchParams({ select: "id,current_semver,status", tenant_id: `eq.${tenantId}`, title: `eq.${title}` })}`,
  );
  expect(templates).toHaveLength(1);
  expect(templates[0].current_semver).toBe("1.1.0");
  expect(templates[0].status).toBe("published");
  const definitions = await api(
    page,
    `recon_definitions?${new URLSearchParams({ select: "id,name,recon_code", tenant_id: `eq.${tenantId}`, tenant_template_id: `eq.${templates[0].id}` })}`,
  );
  expect(definitions).toHaveLength(1);
  const definition = definitions[0];
  const runsQuery = new URLSearchParams({
    select: "id,definition_id,matched_count,exception_count,total_rows,completed_at,error,run_by",
    tenant_id: `eq.${tenantId}`,
    definition_id: `eq.${definition.id}`,
  });
  let runs = await api(page, `recon_runs?${runsQuery}`);
  expect(runs.length).toBeLessThanOrEqual(1);
  const heading = page.getByRole("heading", { name: definition.name, exact: true });
  const card = page.locator("div.rounded-lg.border.p-4").filter({ has: heading });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("2 side(s) · 7 rule(s)");
  if (runs.length === 0) {
    await card.getByRole("button", { name: "Run", exact: true }).click();
    await expect(
      page.getByText("Run complete · 6 matched, 5 exceptions", { exact: true }),
    ).toBeVisible();
    runs = await api(page, `recon_runs?${runsQuery}`);
  }
  expect(runs).toHaveLength(1);
  expect(runs[0].total_rows).toBe(12);
  expect(runs[0].matched_count).toBe(3);
  expect(runs[0].exception_count).toBe(5);
  expect(runs[0].completed_at).toBeTruthy();
  expect(runs[0].error).toBeNull();
  expect(runs[0].run_by).toBe(makerId);
  const runRowsQuery = new URLSearchParams({
    select: "id",
    tenant_id: `eq.${tenantId}`,
    run_id: `eq.${runs[0].id}`,
  });
  const matches = await api(page, `recon_matches?${runRowsQuery}`);
  const exceptions = await api(page, `recon_exceptions?${runRowsQuery}`);
  expect(matches).toHaveLength(3);
  expect(exceptions).toHaveLength(5);
  const audits = await api(
    page,
    `audit_log?${new URLSearchParams({ select: "id,action,actor_user_id,resource_id", tenant_id: `eq.${tenantId}`, resource_id: `eq.${runs[0].id}`, action: "eq.recon.run.complete" })}`,
  );
  expect(audits).toHaveLength(1);
  expect(audits[0].actor_user_id).toBe(makerId);
  await info.attach("instantiated-run-api-evidence", {
    body: JSON.stringify({
      template_id: templates[0].id,
      definition,
      runs,
      match_ids: matches,
      exception_ids: exceptions,
      audits,
    }),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("my-template-v11-completed-reconciliation.png") });
});
