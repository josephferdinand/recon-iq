import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_ENV_DELIVERY_BROWSER === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const controlTenantId = process.env.FVI_E2E_TENANT_ID ?? "";
const targetTenantId = process.env.FVI_ENV_DELIVERY_TARGET_TENANT_ID ?? "";
const requestTitle = process.env.FVI_ENV_DELIVERY_REQUEST_TITLE ?? "";

test("source maker creates a retained package request and cannot self-approve", async ({
  page,
}, testInfo) => {
  test.skip(
    !enabled || !tenantSlug || !controlTenantId || !targetTenantId || !requestTitle,
    "Requires retained tenant-admin state and governed environment fixture IDs",
  );

  await page.goto(`/${tenantSlug}/tenant?page=promo`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Environment & Delivery" })).toBeVisible();
  const existing = page.getByRole("row").filter({ hasText: requestTitle }).first();
  if (!(await existing.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "New change request" }).click();
    const dialog = page.getByRole("dialog", { name: "Build environment change request" });
    await expect(dialog.getByLabel("Current source tenant")).toHaveValue(controlTenantId);
    await dialog.locator("input").nth(1).fill(targetTenantId);
    await dialog.locator("input").nth(2).fill(requestTitle);
    await dialog
      .locator("textarea")
      .fill(
        "Promote the governed Assurance Lab package after independent source and target review.",
      );
    await dialog.getByRole("button", { name: "Create governed request" }).click();
    await expect(page.getByText(/^Change request created · FVI-CR-/u)).toBeVisible({
      timeout: 30_000,
    });
    await expect(dialog).toBeHidden();
  }

  const row = page.getByRole("row").filter({ hasText: requestTitle }).first();
  await expect(row).toBeVisible();
  await row.click();
  const detail = page.getByRole("dialog").filter({ hasText: requestTitle });
  if (
    await detail
      .getByText("approved", { exact: true })
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await expect(detail.getByText(/#\d+ · approved/u)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("environment-delivery-independent-approval-retained.png"),
      fullPage: true,
    });
    return;
  }
  await expect(detail.getByText("pending_approval", { exact: true })).toBeVisible();
  await expect(detail.getByText(/source_tenant_binding/u)).toBeVisible();
  await expect(detail.getByText("Immutable audit history")).toBeVisible();
  await expect(detail.getByText(/#1 · request created/u)).toBeVisible();
  await detail.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/Four-eyes: requester cannot approve/iu)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("environment-delivery-request-and-self-approval-denial.png"),
    fullPage: true,
  });
});

test("independent source checker approves and transmits the package", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.FVI_ENV_DELIVERY_CHECKER !== "YES" ||
      !tenantSlug ||
      !controlTenantId ||
      !requestTitle,
    "Requires the retained independent checker state and completed preflight",
  );

  await page.goto(`/${tenantSlug}/tenant?page=promo`, { waitUntil: "networkidle" });
  const row = page.getByRole("row").filter({ hasText: requestTitle }).first();
  await expect(row).toBeVisible();
  await row.click();
  const detail = page.getByRole("dialog").filter({ hasText: requestTitle });
  await expect(detail).toContainText(/approved|pending_approval/u);
  if (
    await detail
      .getByText("approved", { exact: true })
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await expect(detail.getByText(/#\d+ · approved/u)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("environment-delivery-independent-approval-retained.png"),
      fullPage: true,
    });
    return;
  }
  await expect(detail.getByText("pending_approval", { exact: true })).toBeVisible();
  await expect(detail.getByText(/source_tenant_binding/u)).toBeVisible();
  await expect(detail.getByText(/package_inventory/u)).toBeVisible();
  await expect(detail.getByText(/secret_free_manifest/u)).toBeVisible();
  await detail
    .locator("textarea")
    .fill("Independent source checker verified the frozen package and integrity hashes.");
  await detail.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/Source approved and sent · FVI-CR-/u)).toBeVisible({
    timeout: 30_000,
  });
  await expect(detail.getByText("approved", { exact: true })).toBeVisible();
  await expect(detail.getByText(/#\d+ · approved/u)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("environment-delivery-independent-approval.png"),
    fullPage: true,
  });
});

test("independent target reviewer confirms mappings and approves installation", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.FVI_ENV_DELIVERY_TARGET_REVIEWER !== "YES" || !tenantSlug || !requestTitle,
    "Requires retained target-reviewer state and the transported package",
  );
  await page.goto(`/${tenantSlug}/tenant?page=promo`, { waitUntil: "networkidle" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (await finishTour.isVisible().catch(() => false)) await finishTour.click();
  await page.getByRole("button", { name: "Incoming approvals" }).click();
  const row = page.getByRole("row").filter({ hasText: requestTitle }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  const detail = page.getByRole("dialog").filter({ hasText: requestTitle });
  await expect(detail.getByText("Target", { exact: true })).toBeVisible();
  await expect(detail.getByText("Proposed user and group mappings")).toBeVisible();
  await detail
    .getByText(/I reviewed the proposed user\/group mappings/u)
    .locator("xpath=ancestor::label")
    .locator('input[type="checkbox"]')
    .check();
  await detail
    .locator("textarea")
    .fill("Independent target reviewer confirmed the proposed access mappings and installation.");
  await detail.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Change request approved", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(detail.getByText("approved", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("environment-delivery-target-approval.png"),
    fullPage: true,
  });
});
