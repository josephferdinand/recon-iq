import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RUN_CONNECTOR_CAPABILITY_UI === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const agentSchedules = (process.env.FVI_CONNECTOR_AGENT_SCHEDULES ?? "")
  .split("|")
  .map((value) => value.trim())
  .filter(Boolean);

test("scheduled connector UI distinguishes direct, private-gateway, and agent execution", async ({
  page,
}) => {
  test.skip(!enabled || !tenantSlug, "Requires authenticated retained tenant state");
  await page.goto(`/${tenantSlug}/workspace?page=connectors`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/HTTP, HTTPS, and REST run directly/i)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/run through the private remote gateway/i)).toBeVisible();
  await expect(page.getByText(/require an approved on-premises agent/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "New schedule" })).toBeVisible();

  for (const scheduleName of agentSchedules) {
    const row = page.getByRole("row").filter({ hasText: scheduleName });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: scheduleName }).click();
    const inspector = page.getByRole("complementary", { name: "Selected connection details" });
    await expect(inspector.getByText("Agent required", { exact: true })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Run now" })).toBeEnabled();
    await expect(inspector.getByText("success", { exact: false })).toBeVisible();
    await inspector.getByRole("button", { name: "History" }).click();
    const history = page.getByRole("dialog", { name: "Run history" });
    await expect(history.getByText("success", { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(history).toBeHidden();
  }
});
