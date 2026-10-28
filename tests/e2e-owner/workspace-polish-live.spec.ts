import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const enabled = process.env.FVI_RUN_WORKSPACE_POLISH === "YES";
const slug = "reconiq-assurance-lab-prod";
const workspace = `/${slug}/workspace`;
const origin = process.env.FVI_E2E_BASE_URL ?? "";
if (enabled && new URL(origin).hostname !== "app.reconiq.example") {
  throw new Error("Workspace polish proof is scoped to canonical FVI PROD");
}
test.skip(!enabled, "Set FVI_RUN_WORKSPACE_POLISH=YES with the protected PROD QA session");
test.use({ channel: "chrome", viewport: { width: 1440, height: 960 }, trace: "off", video: "off" });

test.beforeEach(async ({ page }) => {
  // Dismiss only the real first-visit guide in this isolated QA browser.
  await page.addLocatorHandler(page.locator(".driver-popover-close-btn"), async (close) => {
    await close.click();
  });
});

async function openPage(page: Page, key = "dashboard") {
  await page.goto(`${workspace}?page=${key}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('nav[aria-label="Workspace navigation"]')).toBeVisible();
}

test("workspace submenus navigate, highlight gold and preserve the My Templates route", async ({
  page,
}, testInfo) => {
  await openPage(page);
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  const samples = [
    ["Ingestion", "File uploads", "data"],
    ["Data Prep", "Data Prep pipelines", "prep"],
    ["Reconciliations", "Starter Kits", "templates"],
    ["Exceptions", "Exceptions dashboard", "exception-dashboard"],
    ["Insights", "Ageing", "ageing"],
    ["Reports", "Regulatory packs", "regulatory"],
    ["Tasks & Approvals", "EOD sign-off", "eod"],
    ["Support", "Knowledge", "kb"],
  ];
  for (const [section, child, key] of samples) {
    const toggle = nav.getByRole("button", { name: `Toggle ${section}`, exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const link = nav.getByRole("link", { name: child, exact: true });
    await link.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe(key);
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(link).toHaveCSS("background-color", "rgb(201, 164, 76)");
    await expect(link).toHaveCSS("color", "rgb(14, 26, 48)");
    await expect(nav.locator('button[aria-expanded="true"]')).toHaveCount(1);
  }
  await nav.getByRole("button", { name: "Toggle Reconciliations", exact: true }).click();
  const templates = nav.getByRole("link", { name: "My Templates", exact: true });
  await templates.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`${workspace}/templates`);
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  await expect(templates).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("dashboard");
  const prep = nav.getByRole("button", { name: "Toggle Data Prep", exact: true });
  await prep.focus();
  await prep.press("Space");
  await expect(prep).toHaveAttribute("aria-expanded", "true");
  await prep.press("Enter");
  await expect(prep).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Data Prep pipelines", exact: true })).toBeHidden();
  await nav.getByRole("link", { name: "Exceptions", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("workspace-submenus-gold.png") });
});

test("invalid workspace page returns to the canonical Dashboard URL", async ({ page }) => {
  await openPage(page, "unknown-page-for-assurance");
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("dashboard");
  await expect(
    page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("notifications wrap full content and scroll inside desktop and mobile viewports", async ({
  page,
}, testInfo) => {
  // The stable Reference Data page uses the same header without the unrelated
  // delayed Home onboarding tour, whose outside click can dismiss a popover.
  await openPage(page, "reference");
  const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
  const history = panel.getByRole("region", { name: "Notification history" });
  for (const width of [1440, 420]) {
    await page.setViewportSize({ width, height: 760 });
    const trigger = page.getByRole("button", { name: /^Notifications/ });
    await expect(trigger).toBeInViewport();
    await trigger.click();
    await expect(history.locator("li").first()).toBeVisible();
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return Boolean(
          box &&
          box.x >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y >= 0 &&
          box.y + box.height <= 761,
        );
      })
      .toBe(true);
    const titles = await history.locator("li span.whitespace-normal").evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent ?? "",
        width: node.clientWidth,
        scroll: node.scrollWidth,
        height: node.clientHeight,
        scrollHeight: node.scrollHeight,
      })),
    );
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.some((title) => title.text.length > 45)).toBe(true);
    for (const title of titles) {
      expect(title.scroll).toBeLessThanOrEqual(title.width + 1);
      expect(title.scrollHeight).toBeLessThanOrEqual(title.height + 1);
    }
    await history.focus();
    await history.press("End");
    await expect
      .poll(() =>
        history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
      )
      .toBeLessThanOrEqual(1);
    const scroll = await history.evaluate((node) => ({
      top: node.scrollTop,
      height: node.clientHeight,
      total: node.scrollHeight,
    }));
    if (scroll.total > scroll.height) expect(scroll.top).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath(`notifications-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  }
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const mobileNavigation = page.getByRole("complementary", {
    name: "Mobile primary navigation",
    exact: true,
  });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole("link", { name: "Exceptions", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("exception-dashboard");
  await expect(mobileNavigation).toBeHidden();
  await expect(page.getByRole("button", { name: /^Notifications/ })).toBeInViewport();
});

test("Break Manager shortcuts fit the viewport and remain scrollable", async ({
  page,
}, testInfo) => {
  await openPage(page, "breaks");
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog");
  const list = dialog.getByRole("region", { name: /list$/ });
  await expect(list).toBeVisible();
  for (const width of [1440, 420]) {
    await page.setViewportSize({ width, height: 760 });
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return Boolean(
          box &&
          box.x >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y >= 0 &&
          box.y + box.height <= 761,
        );
      })
      .toBe(true);
    await list.focus();
    await list.press("End");
    // Native keyboard scrolling completes asynchronously; wait for its observable
    // bottom position instead of reading scrollTop in the keydown frame.
    await expect
      .poll(() => list.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThanOrEqual(1);
    const dimensions = await list.evaluate((node) => ({
      top: node.scrollTop,
      height: node.clientHeight,
      total: node.scrollHeight,
      width: node.clientWidth,
      totalWidth: node.scrollWidth,
    }));
    expect(dimensions.total).toBeGreaterThan(dimensions.height);
    expect(dimensions.top).toBeGreaterThan(0);
    expect(dimensions.totalWidth).toBeLessThanOrEqual(dimensions.width + 1);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`break-shortcuts-${width}.png`) });
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("exception dashboard renders real data, trends and working destinations", async ({
  page,
}, testInfo) => {
  await openPage(page, "exception-dashboard");
  await expect(
    page.getByRole("heading", { name: "Exception dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/As of/).first()).toBeVisible();
  await expect(
    page.getByText(/We couldn.t load|Could not load|This page didn.t load/i),
  ).toHaveCount(0);
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  const window = page.getByRole("group", { name: "Exception creation-cohort trend window" });
  for (const days of [7, 90, 30]) {
    await window.getByRole("button", { name: `${days}d`, exact: true }).click();
    await expect(window.getByRole("button", { name: `${days}d`, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText(new RegExp(`Trend window\\s+${days} days`, "i"))).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("exception-dashboard.png"), fullPage: true });
  const body = await page.locator("body").innerText();
  await testInfo.attach("dashboard-visible-values", { body, contentType: "text/plain" });
  await page.setViewportSize({ width: 420, height: 760 });
  const main = page.getByRole("main");
  const mainBox = await main.boundingBox();
  expect(mainBox).not.toBeNull();
  expect(mainBox!.x).toBeGreaterThanOrEqual(0);
  expect(mainBox!.x + mainBox!.width).toBeLessThanOrEqual(421);
  await expect(page.getByRole("button", { name: /^Notifications/ })).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("exception-dashboard-420.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("link", { name: "Open exception inbox", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("exceptions");
  await openPage(page, "exception-dashboard");
  await page.getByRole("link", { name: /open break manager/i }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("breaks");
});

test("governed exception analytics API returns internally consistent tenant aggregates", async ({
  page,
}, testInfo) => {
  const statePath = process.env.FVI_OWNER_STORAGE_STATE;
  const apiKey = process.env.FVI_E2E_SUPABASE_ANON_KEY;
  if (!statePath || !apiKey)
    throw new Error("Protected QA state and PROD publishable key are required");
  const currentState = await page.context().storageState();
  const state = currentState.origins.length
    ? currentState
    : JSON.parse(await readFile(statePath, "utf8"));
  const item = state.origins
    ?.find((entry: { origin: string }) => entry.origin === "https://app.reconiq.example")
    ?.localStorage?.find(
      (entry: { name: string }) => entry.name === "sb-YOUR_PROJECT_REF-auth-token",
    );
  const stored = item ? JSON.parse(item.value) : null;
  const session = stored?.access_token ? stored : stored?.currentSession;
  if (!session?.access_token) throw new Error("Protected PROD QA session is unavailable");
  const headers = {
    apikey: apiKey,
    authorization: `Bearer ${session.access_token}`,
    "content-type": "application/json",
  };
  const base = "https://YOUR_PROJECT_REF.supabase.co/rest/v1";
  const tenantResponse = await fetch(`${base}/tenants?select=id&slug=eq.${slug}`, { headers });
  expect(tenantResponse.status).toBe(200);
  const tenants = await tenantResponse.json();
  expect(tenants).toHaveLength(1);
  const response = await fetch(`${base}/rpc/get_exception_dashboard`, {
    method: "POST",
    headers,
    body: JSON.stringify({ _tenant_id: tenants[0].id, _days: 30 }),
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  const sum = (rows: Array<{ count: number }>) => rows.reduce((total, row) => total + row.count, 0);
  expect(data.totals.total).toBe(data.totals.open + data.totals.resolved);
  expect(sum(data.by_status)).toBe(data.totals.total);
  expect(sum(data.by_severity)).toBe(data.totals.total);
  expect(sum(data.ageing)).toBe(data.totals.open);
  for (const field of ["high_priority", "unassigned", "older_than_30_days"]) {
    expect(data.totals[field]).toBeGreaterThanOrEqual(0);
    expect(data.totals[field]).toBeLessThanOrEqual(data.totals.open);
  }
  expect(data.window_days).toBe(30);
  expect(data.trend).toHaveLength(30);
  for (const day of data.trend) {
    expect(day.still_open).toBeGreaterThanOrEqual(0);
    expect(day.still_open).toBeLessThanOrEqual(day.created);
  }
  expect(data.by_reconciliation.length).toBeLessThanOrEqual(10);
  // Independently reconcile the aggregates against the same actor's RLS-scoped
  // base rows. Do not persist row identifiers, assignees or exception payloads.
  type SourceRow = {
    created_at: string;
    lifecycle_state: string;
    status: string;
    priority: string;
    assignee: string | null;
    severity: string;
  };
  const sourceRows: SourceRow[] = [];
  const sourceQuery = new URLSearchParams({
    select: "created_at,lifecycle_state,status,priority,assignee,severity",
    tenant_id: `eq.${tenants[0].id}`,
    created_at: `lte.${data.as_of}`,
    order: "id.asc",
  });
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const sourceResponse = await fetch(`${base}/recon_exceptions?${sourceQuery}`, {
      headers: { ...headers, Range: `${offset}-${offset + 999}`, Prefer: "count=exact" },
    });
    expect([200, 206]).toContain(sourceResponse.status);
    const batch: SourceRow[] = await sourceResponse.json();
    sourceRows.push(...batch);
    const total = Number(sourceResponse.headers.get("content-range")?.split("/")[1]);
    expect(Number.isFinite(total)).toBe(true);
    if (sourceRows.length >= total) break;
  }
  expect(sourceRows.length).toBe(data.totals.total);
  const closed = (row: SourceRow) =>
    ["resolved", "written_off"].includes(row.lifecycle_state) ||
    ["resolved", "wont_fix"].includes(row.status);
  const open = sourceRows.filter((row) => !closed(row));
  const age = (row: SourceRow) =>
    Math.max(0, Math.floor((Date.parse(data.as_of) - Date.parse(row.created_at)) / 86_400_000));
  const independent = {
    total: sourceRows.length,
    open: open.length,
    resolved: sourceRows.length - open.length,
    high_priority: open.filter((row) => ["P1", "P2"].includes(row.priority)).length,
    unassigned: open.filter((row) => row.assignee === null).length,
    older_than_30_days: open.filter((row) => age(row) > 30).length,
    oldest_open_days: open.reduce((oldest, row) => Math.max(oldest, age(row)), 0),
  };
  expect(data.totals).toEqual(independent);
  for (const day of data.trend) {
    const cohort = sourceRows.filter(
      (row) => new Date(row.created_at).toISOString().slice(0, 10) === day.date,
    );
    expect(day.created).toBe(cohort.length);
    expect(day.still_open).toBe(cohort.filter((row) => !closed(row)).length);
  }
  for (const severity of data.by_severity) {
    expect(severity.count).toBe(sourceRows.filter((row) => row.severity === severity.name).length);
  }
  await testInfo.attach("independent-source-reconciliation", {
    body: JSON.stringify({ as_of: data.as_of, population: slug, totals: independent }, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach("exception-dashboard-api", {
    body: JSON.stringify(data, null, 2),
    contentType: "application/json",
  });
});
