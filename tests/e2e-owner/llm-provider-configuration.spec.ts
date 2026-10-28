import { expect, test, type Locator, type Page } from "@playwright/test";

const enabled = process.env.FVI_RUN_LLM_CONFIGURATION === "YES";
const scope = process.env.FVI_AI_TEST_SCOPE === "platform" ? "platform" : "tenant";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const baseUrl = process.env.FVI_AI_TEST_BASE_URL ?? "";
const primaryKey = process.env.FVI_AI_TEST_PRIMARY_KEY ?? "";
const fallbackKey = process.env.FVI_AI_TEST_FALLBACK_KEY ?? "";
const primaryModel = process.env.FVI_AI_TEST_PRIMARY_MODEL ?? "claude-sonnet-5";
const fallbackModel = process.env.FVI_AI_TEST_FALLBACK_MODEL ?? "claude-opus-5";

// This workflow enters real provider keys into password controls. Never retain
// browser traces, screenshots, or video for this credential-bearing test.
test.use({ trace: "off", screenshot: "off", video: "off" });

function slotCard(page: Page, label: string): Locator {
  return page
    .getByRole("button", { name: `Test ${label}`, exact: true })
    .locator("xpath=ancestor::div[contains(@class,'border') and contains(@class,'rounded')][1]");
}

async function configureSlot(args: {
  page: Page;
  label: "Primary" | "Fallback #1";
  providerLabel: string;
  model: string;
  apiKey: string;
}) {
  let card = slotCard(args.page, args.label);
  await expect(card).toBeVisible();
  await card.getByRole("combobox").first().click();
  await args.page.getByRole("option", { name: args.providerLabel, exact: true }).click();

  card = slotCard(args.page, args.label);
  await card.getByPlaceholder("https://api.falconbank.com/v1").fill(baseUrl);
  await card.getByRole("combobox").nth(1).click();
  await args.page.getByRole("option", { name: "Custom…", exact: true }).click();
  await card.getByPlaceholder("your-model-id").fill(args.model);
  await card.getByPlaceholder(/sk-…/u).fill(args.apiKey);
  await card.getByRole("button", { name: /^Save(?: changes)?$/u }).click();
  await expect(
    args.page.getByText(new RegExp(`Saved ${args.label.replace("#", "\\#")}`)),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(slotCard(args.page, args.label).getByPlaceholder("your-model-id")).toHaveValue(
    args.model,
    { timeout: 20_000 },
  );
}

test(`configures and tests the ${scope} AI fallback chain`, async ({ page }) => {
  test.skip(
    !enabled || !baseUrl || !primaryKey || !fallbackKey || (scope === "tenant" && !tenantSlug),
    "Requires secured AI values and the selected platform or tenant scope",
  );

  await page.addInitScript(() => {
    const key = "fvi.prefs.v1";
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    current.tourSeen = { ...(current.tourSeen ?? {}), "tn.ai": true };
    current.tourProgress = { ...(current.tourProgress ?? {}) };
    delete current.tourProgress["tn.ai"];
    localStorage.setItem(key, JSON.stringify(current));
  });

  const route =
    scope === "platform" ? "/platform?page=llm-legacy" : `/${tenantSlug}/tenant?page=ai`;
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/u);
  await expect(page.getByRole("button", { name: "Test Primary", exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const aiSwitch = page.getByRole("switch", { name: "AI enabled", exact: true });
  if (!(await aiSwitch.isChecked())) {
    await aiSwitch.click();
    await expect(page.getByText("AI setting updated", { exact: true })).toBeVisible();
  }

  await configureSlot({
    page,
    label: "Primary",
    providerLabel: "Custom (Muse-compatible)",
    model: primaryModel,
    apiKey: primaryKey,
  });
  await configureSlot({
    page,
    label: "Fallback #1",
    providerLabel: "Anthropic",
    model: fallbackModel,
    apiKey: fallbackKey,
  });

  await slotCard(page, "Primary").getByRole("button", { name: "Test Primary" }).click();
  await expect(page.getByText(/Custom \(Muse-compatible\): OK/u)).toBeVisible({
    timeout: 30_000,
  });

  await slotCard(page, "Fallback #1").getByRole("button", { name: "Test Fallback #1" }).click();
  await expect(page.getByText(/Anthropic: OK/u)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Test entire chain" }).click();
  await expect(page.getByText(/Chain OK — first responding/u)).toBeVisible({ timeout: 45_000 });
});
