import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.join(process.env.LOCALAPPDATA ?? "", "FVI-QA-Private-20260925");
const qa = path.join(root, "governance-approval-hosted-20261002");
const output = path.join(root, "Linnaeus-Items11-12-20261004", "settled-captures");
await mkdir(output, { recursive: true });

const cases = [
  { id: "PROD-requester-workspace", env: "PROD", actor: "requester", state: "actors/requester-PROD-2026-10-03T18-41-17-983Z.json", url: "https://app.reconiq.example/reconiq-assurance-lab-prod/workspace?page=dashboard" },
  { id: "PROD-requester-platform", env: "PROD", actor: "requester", state: "actors/requester-PROD-2026-10-03T18-41-17-983Z.json", url: "https://app.reconiq.example/platform" },
  { id: "PROD-checker-governance", env: "PROD", actor: "checker", state: "actors/checker-PROD-2026-10-03T18-41-17-983Z.json", url: "https://app.reconiq.example/reconiq-assurance-lab-prod/tenant?page=governance" },
  { id: "DEV-maker-governance", env: "DEV", actor: "maker", state: "actors/maker-DEV-2026-10-03T18-49-23-306Z.json", url: "https://dev.app.reconiq.example/reconiq-assurance-lab-development/tenant?page=governance" },
  { id: "DEV-maker-platform", env: "DEV", actor: "maker", state: "actors/maker-DEV-2026-10-03T18-49-23-306Z.json", url: "https://dev.app.reconiq.example/platform" },
  { id: "DEV-checker-governance", env: "DEV", actor: "checker", state: "actors/checker-DEV-2026-10-03T18-49-23-306Z.json", url: "https://dev.app.reconiq.example/reconiq-assurance-lab-development/tenant?page=governance" },
];

const readiness = {
  PROD: JSON.parse(await readFile(path.join(qa, "SESSION-READINESS-2026-10-03T18-41-17-983Z.json"), "utf8")),
  DEV: JSON.parse(await readFile(path.join(qa, "DEV-SESSION-READINESS-2026-10-03T18-49-23-306Z.json"), "utf8")),
};
const refs = { PROD: "YOUR_PROJECT_REF", DEV: "YOUR_PROJECT_REF" };
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const item of cases) {
    const actor = readiness[item.env].actors.find((entry) => entry.kind === item.actor);
    if (!actor || actor.real_aal2 !== true || actor.current_role === undefined) throw new Error(`No verified ${item.env} actor for ${item.id}`);
    const stateFile = path.join(qa, item.state);
    const context = await browser.newContext({ storageState: stateFile, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const authEvents = [];
    const apiFailures = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.hostname !== new URL(item.url).hostname) return;
      if (url.pathname.startsWith("/auth/v1/")) authEvents.push({ path: url.pathname, status: response.status() });
      if (url.pathname.startsWith("/rest/v1/") && response.status() >= 400) apiFailures.push({ path: url.pathname, status: response.status() });
    });
    let httpStatus = null;
    try {
      const response = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 25000 });
      httpStatus = response?.status() ?? null;
      await page.waitForFunction(() => document.readyState === "complete", undefined, { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(4000);
      const body = await page.locator("body").innerText().catch(() => "");
      const title = await page.title().catch(() => "");
      const headings = await page.locator("h1,h2").allTextContents().catch(() => []);
      const alertTexts = await page.getByRole("alert").allTextContents().catch(() => []);
      const claims = await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
          const session = JSON.parse(raw);
          const payload = JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          return { sub: payload.sub, aal: payload.aal, exp: payload.exp };
        } catch { return null; }
      }, `sb-${refs[item.env]}-auth-token`).catch(() => null);
      const screenshot = path.join(output, `${item.id}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      results.push({
        caseId: item.id,
        env: item.env,
        actor: item.actor,
        currentRole: actor.current_role,
        actualAal2: claims?.aal === "aal2",
        actorIdentityStillMatches: claims?.sub === actor.user_id,
        tokenUnexpiredAtReadback: Number.isFinite(claims?.exp) && claims.exp * 1000 > Date.now(),
        httpStatus,
        finalPath: new URL(page.url()).pathname,
        title,
        headings: headings.map((heading) => heading.replace(/\s+/gu, " ").trim()).filter(Boolean).slice(0, 8),
        visibleSignals: {
          authRequired: /sign in to continue|please sign in|welcome back/iu.test(body),
          accessDenied: /you do not currently have access|you don't have access|not authorized|access denied|permission denied/iu.test(body),
          platformNavigation: /platform administration|platform/iu.test(headings.join(" ")),
          tenantOrWorkspaceSurface: /tenant|workspace|reconciliation/iu.test(headings.join(" ")),
          governanceContent: /membership approvals|access reviews|audit trail/iu.test(body),
          environmentUnavailable: /environment unavailable/iu.test(body),
          loadingSurface: /loading/iu.test(body),
          safeErrorCopy: /unavailable|could not be loaded|try again/iu.test(body),
          rawDiagnosticMarker: /SQLSTATE|PGRST\d{3}|stack trace|postgresql?/iu.test(body),
        },
        alertCount: alertTexts.length,
        alertTextContainsSensitiveMarker: alertTexts.some((text) => /[0-9a-f]{8}-[0-9a-f-]{27,}|Bearer\s|JWT|access_token/iu.test(text)),
        authEvents,
        apiFailures,
        screenshot,
      });
    } catch (error) {
      results.push({ caseId: item.id, env: item.env, actor: item.actor, currentRole: actor.current_role, status: "CAPTURE_ERROR", errorName: error instanceof Error ? error.name : "Error", httpStatus, authEvents, apiFailures });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const reportPath = path.join(output, "LINNAEUS-SETTLED-VISIBLE-RECHECK-20261004.json");
await writeFile(reportPath, JSON.stringify({ capturedAt: new Date().toISOString(), evidenceTier: "LIVE_PROD_DEV_UI_OBSERVATION; read-only page navigation under prior verified QA states", businessMutations: 0, results }, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(JSON.stringify({ reportPath, resultCount: results.length, results: results.map(({ caseId, env, actor, currentRole, actualAal2, tokenUnexpiredAtReadback, finalPath, httpStatus, visibleSignals, alertCount, status }) => ({ caseId, env, actor, currentRole, actualAal2, tokenUnexpiredAtReadback, finalPath, httpStatus, visibleSignals, alertCount, status: status ?? "CAPTURED" })) }) + "\n");
