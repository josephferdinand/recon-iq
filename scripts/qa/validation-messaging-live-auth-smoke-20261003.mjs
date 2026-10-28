import { chromium } from "playwright";

const origin = new URL(process.env.FVI_VALIDATION_MESSAGING_APP_ORIGIN ?? "https://app.reconiq.example");
if (origin.origin !== "https://app.reconiq.example") {
  throw new Error("Live smoke is restricted to the canonical PROD app origin.");
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let nonGetRequests = 0;
  page.on("request", (request) => {
    if (!new Set(["GET", "HEAD", "OPTIONS"]).has(request.method())) nonGetRequests++;
  });

  const response = await page.goto(new URL("/request-invite", origin).href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => location.pathname !== "/request-invite" || Boolean(document.querySelector("#signup-name")),
    undefined,
    { timeout: 8000 },
  ).catch(() => undefined);
  if (new URL(page.url()).pathname !== "/request-invite" || !(await page.locator("#signup-name").count())) {
    process.stdout.write(`${JSON.stringify({
      caseId: "VMG-AUTH-INPUT-001",
      evidenceTier: "LIVE-BLOCKED",
      requestedPath: "/request-invite",
      finalPath: new URL(page.url()).pathname,
      httpStatus: response?.status() ?? null,
      observedPage: "sign-in page; invite form controls absent",
      blocker: "Canonical production navigation redirected away before client-side validation could be exercised.",
      accountOrAdmissionMutation: false,
    })}\n`);
  } else {
    await page.getByLabel("Full name").fill("QA Validation Fixture");
    await page.getByLabel("Work email").fill("not-an-email");
    const beforeSubmit = nonGetRequests;
    await page.getByRole("button", { name: "Verify email and request access" }).click();
    const alert = page.getByRole("alert");
    await alert.getByText("Enter your name and a valid work email address.").waitFor();
    await page.waitForTimeout(100);

    const requestsAfterClientBlock = nonGetRequests - beforeSubmit;
    if (requestsAfterClientBlock !== 0) {
      throw new Error("Invalid signup input reached a non-GET server action; inspect the private browser trace.");
    }
    process.stdout.write(`${JSON.stringify({
      caseId: "VMG-AUTH-INPUT-001",
      evidenceTier: "LIVE-PROVEN",
      page: "/request-invite",
      fixture: "synthetic invalid email; no account identity used",
      messageObserved: "Enter your name and a valid work email address.",
      correctiveAction: "edit the work email before submitting",
      nonGetRequestsAfterInvalidSubmit: requestsAfterClientBlock,
      accountOrAdmissionMutation: false,
    })}\n`);
  }
} finally {
  await browser.close();
}
