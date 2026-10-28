import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const enabled = process.env.FVI_RUN_TURING_PROD_READONLY === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";
const evidenceDir = path.resolve(
  process.env.FVI_TURING_READONLY_EVIDENCE_DIR ?? "_e2e_run/owner-session/turing-prod-readonly",
);

test.skip(
  !enabled || !tenantSlug,
  "Requires the existing authenticated PROD Assurance Lab QA session",
);
test.use({ trace: "off", screenshot: "off", video: "off" });

async function writeReceipt(name: string, data: Record<string, unknown>) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, name),
    `${JSON.stringify({ target: "PROD Assurance Lab", ownerAcknowledgedRelease: process.env.FVI_TURING_PROD_DEPLOYMENT_ID ?? null, capturedAt: new Date().toISOString(), ...data }, null, 2)}\n`,
    "utf8",
  );
}

async function skipWorkspaceTour(page: Page) {
  await page.addInitScript((id) => {
    const key = "fvi.prefs.v1";
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    current.tourSeen = {
      ...(current.tourSeen ?? {}),
      "ws.recons": true,
      "ws.exceptions": true,
      [`workspace-${id}-v2`]: true,
    };
    current.tourProgress = { ...(current.tourProgress ?? {}) };
    delete current.tourProgress["ws.recons"];
    delete current.tourProgress["ws.exceptions"];
    localStorage.setItem(key, JSON.stringify(current));
  }, tenantId);
}

async function finishTourIfVisible(page: Page) {
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (
    await finishTour
      .waitFor({ state: "visible", timeout: 2_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await finishTour.click();
    await expect(page.locator(".driver-overlay")).toBeHidden();
  }
}

test("reads persisted multi-side run results and period history without mutation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await skipWorkspaceTour(page);
  await page.goto(`/${tenantSlug}/workspace?page=recons`, { waitUntil: "networkidle" });
  await finishTourIfVisible(page);
  await page.getByRole("combobox", { name: "Filter reconciliations by type" }).click();
  await page.getByRole("option", { name: "Tri-Party", exact: true }).click();
  const definitions = page.getByRole("table", { name: "Reconciliations" });
  await expect(definitions).toBeVisible();
  const firstDefinition = definitions.getByRole("row").nth(1);
  await expect(firstDefinition).toBeVisible();
  await firstDefinition.getByRole("button", { name: /^View /u }).click();
  const definitionDetails = page.getByRole("dialog");
  await expect(
    definitionDetails.getByRole("button", { name: "Processed runs", exact: true }),
  ).toBeVisible();
  await definitionDetails.getByRole("button", { name: "Processed runs", exact: true }).click();
  const workbench = page.getByRole("region", { name: "Reconciliation run workbench" });
  await workbench.getByRole("tab", { name: "History" }).click();
  await workbench.getByRole("button", { name: "90 days", exact: true }).click();
  const history = workbench.getByRole("tabpanel").filter({ hasText: /Run history ·/u });
  await expect(history.getByRole("table")).toBeVisible();
  const recentRun = history.getByRole("button", { name: /^Open run /u }).first();
  await expect(recentRun).toBeVisible();
  const openedRun = (await recentRun.getAttribute("aria-label"))?.replace(/^Open run /u, "") ?? "";
  await recentRun.click();
  await workbench.getByRole("tab", { name: "Overview" }).click();
  const overview = workbench.getByRole("tabpanel").filter({ hasText: "Configured sides" });
  const overviewText = await overview.innerText();
  const configuredSideLines = overviewText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z]:\s/u.test(line));
  expect(configuredSideLines.length).toBeGreaterThanOrEqual(2);
  await workbench.getByRole("tab", { name: "Results" }).click();
  const processedRun = workbench.getByRole("region", { name: "Processed run" });
  await expect(processedRun).toBeVisible();
  await expect(processedRun.getByText(/Run ID/u)).toBeVisible();
  const resultRows = await processedRun.getByRole("row").count();
  await writeReceipt("reconciliation-readonly.json", {
    route: "workspace?page=recons",
    openedRun,
    configuredSideCount: configuredSideLines.length,
    resultTableRows: resultRows,
    ninetyDayHistoryVisible: true,
    writesPerformed: 0,
  });
});

test("reads exception cases or verifies truthful unavailable-state guidance without mutation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await skipWorkspaceTour(page);
  const networkObservations: Array<{
    method: string;
    path: string;
    status: number;
    topLevelKeys?: string[];
    errorCode?: string;
    errorClass?: string;
  }> = [];
  const pendingObservations: Promise<void>[] = [];
  page.on("response", (response) => {
    const request = response.request();
    const url = new URL(response.url());
    const relevant = url.hostname.endsWith(".supabase.co") || url.pathname.includes("server");
    if (!relevant) return;
    pendingObservations.push(
      (async () => {
        const entry: (typeof networkObservations)[number] = {
          method: request.method(),
          path: url.pathname,
          status: response.status(),
        };
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          networkObservations.push(entry);
          return;
        }
        const root = body as Record<string, unknown>;
        entry.topLevelKeys = Object.keys(root).slice(0, 20);
        const candidates = [root, root.error, root.data, root.result].filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === "object" && !Array.isArray(item),
        );
        const rawCode = candidates.find((item) => typeof item.code === "string")?.code;
        if (typeof rawCode === "string") {
          const safeCode = rawCode.match(/^(?:PGRST\d{3}|SQLSTATE\d{5}|[A-Z]\d{4})$/u);
          if (safeCode) entry.errorCode = safeCode[0];
        }
        const message = candidates
          .map((item) => item.message)
          .filter((item): item is string => typeof item === "string")
          .join(" ");
        if (/timeout|timed out|statement timeout/iu.test(message)) entry.errorClass = "timeout";
        else if (/permission denied|not authorized|forbidden/iu.test(message))
          entry.errorClass = "permission";
        else if (/unavailable|could not load|service error/iu.test(message))
          entry.errorClass = "unavailable";
        else if (
          entry.errorCode ||
          root.error ||
          candidates.some((item) => item.status === "error")
        ) {
          entry.errorClass = "reported-error";
        }
        networkObservations.push(entry);
      })(),
    );
  });
  await page.goto(`/${tenantSlug}/workspace?page=exceptions`, { waitUntil: "networkidle" });
  await finishTourIfVisible(page);
  await expect(page.getByText("Exceptions", { exact: true }).first()).toBeVisible();

  const queue = page.getByRole("table");
  const queueUnavailable = page.getByText("Exception queue unavailable");
  const queueState = await Promise.race([
    queue
      .waitFor({ state: "visible", timeout: 40_000 })
      .then(() => "available")
      .catch(() => null),
    queueUnavailable
      .waitFor({ state: "visible", timeout: 40_000 })
      .then(() => "unavailable")
      .catch(() => null),
  ]);
  expect(
    queueState,
    "the production queue should show data or explicit unavailable guidance",
  ).not.toBeNull();
  const queueAvailable = await queue.isVisible();
  const alerts = (await page.getByRole("alert").allInnerTexts()).map((text) =>
    text.replace(/\s+/gu, " ").trim(),
  );
  await Promise.all(pendingObservations);
  await writeReceipt("exceptions-readonly.json", {
    route: "workspace?page=exceptions",
    queueAvailable,
    exceptionQueueAlertVisible: alerts.some((text) => text.includes("Exception queue unavailable")),
    overviewAlertVisible: alerts.some((text) => text.includes("Exception overview unavailable")),
    networkObservations,
    writesPerformed: 0,
  });
  if (!queueAvailable) {
    await expect(queueUnavailable).toBeVisible();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Exception queue unavailable" })
        .getByRole("button", { name: "Try again", exact: true }),
    ).toBeVisible();
    return;
  }
  await expect(queue).toBeVisible();
  const rowCount = await queue.getByRole("row").count();
  expect(rowCount).toBeGreaterThan(1);
  const multiSideRow = queue
    .getByRole("row")
    .filter({ hasText: /SOURCE_A\/SOURCE_[BC]|SOURCE_B\/SOURCE_C/u })
    .first();
  await expect(multiSideRow).toBeVisible();
  const openCase = multiSideRow.getByRole("button", { name: /^View case /u });
  await expect(openCase).toBeVisible();
  await openCase.click();
  await expect(page.getByRole("button", { name: "Close case inspector" })).toBeVisible();
  const activityRegion = page.getByRole("region", { name: "Activity" });
  await expect(activityRegion).toBeVisible();
  const activityText = (await activityRegion.innerText()).replace(/\s+/gu, " ").trim();
  const sideTable = page
    .locator("table")
    .filter({ has: page.getByRole("columnheader", { name: "Field", exact: true }) });
  const sideBySideVisible = await sideTable.isVisible().catch(() => false);
  const rawPayloadFallback = await page
    .locator("pre")
    .isVisible()
    .catch(() => false);
  const queueSummary = (await page.getByText(/Showing .* of \d+ cases/u).innerText()).trim();
  const caseTotal = Number(queueSummary.match(/of\s+(\d+)\s+cases/u)?.[1] ?? 0);
  expect(caseTotal).toBeGreaterThan(0);
  await writeReceipt("exceptions-readonly.json", {
    route: "workspace?page=exceptions",
    visibleQueueRows: rowCount - 1,
    filteredTotal: caseTotal,
    inspectedCase: true,
    activitySectionVisible: activityText.length > 0,
    workflowActivityRecorded: !/No workflow activity recorded/iu.test(activityText),
    multiSideEvidenceTableVisible: sideBySideVisible,
    rawPayloadFallback,
    writesPerformed: 0,
  });
});
