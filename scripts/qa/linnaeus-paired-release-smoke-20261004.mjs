import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const privateRoot = path.join(process.env.LOCALAPPDATA ?? "", "FVI-QA-Private-20260925");
const qaRoot = path.join(privateRoot, "governance-approval-hosted-20261002");
const evidenceRoot = path.join(privateRoot, "Linnaeus-Items11-12-20261004");
const base = {
  PROD: { host: "https://app.reconiq.example", tenant: "reconiq-assurance-lab-prod", ref: "YOUR_PROJECT_REF", app: "7180321a-e9c5-4014-bd9b-a3f1c52e392b", ledger: 451 },
  DEV: { host: "https://dev.app.reconiq.example", tenant: "reconiq-assurance-lab-development", ref: "YOUR_PROJECT_REF", app: "ce449c37-d9cd-4a7a-8d5f-032c881f4e95", ledger: 429 },
};

async function latestReadiness(env) {
  const names = (await readdir(qaRoot)).filter((name) => env === "PROD"
    ? /^SESSION-READINESS-2026-10-03T.*\.json$/u.test(name)
    : /^DEV-SESSION-READINESS-2026-10-03T.*\.json$/u.test(name));
  names.sort();
  const name = names.at(-1);
  if (!name) throw new Error(`No saved ${env} readiness receipt`);
  return JSON.parse(await readFile(path.join(qaRoot, name), "utf8"));
}

const readiness = { PROD: await latestReadiness("PROD"), DEV: await latestReadiness("DEV") };
const cases = [
  { id: "PROD-ANALYST-PLATFORM-ROUTE", env: "PROD", actor: "requester", route: "/platform" },
  { id: "PROD-ANALYST-OWN-WORKSPACE", env: "PROD", actor: "requester", route: "/reconiq-assurance-lab-prod/workspace?page=dashboard" },
  { id: "DEV-ADMIN-PLATFORM-ROUTE", env: "DEV", actor: "maker", route: "/platform" },
  { id: "DEV-ADMIN-OWN-GOVERNANCE", env: "DEV", actor: "maker", route: "/reconiq-assurance-lab-development/tenant?page=governance" },
];
const probeCases = process.argv.includes("--settle-recheck")
  ? cases.filter((item) => ["PROD-ANALYST-OWN-WORKSPACE", "DEV-ADMIN-OWN-GOVERNANCE"].includes(item.id))
  : cases;

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const item of probeCases) {
    const cfg = base[item.env];
    const actor = readiness[item.env].actors.find((entry) => entry.kind === item.actor);
    if (!actor || actor.real_aal2 !== true || actor.active === false) throw new Error(`Saved ${item.env} actor readiness not AAL2/active for ${item.id}`);
    const statePath = actor.storage_state;
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const token = (state.origins ?? []).flatMap((origin) => origin.localStorage ?? []).find((entry) => entry.name === `sb-${cfg.ref}-auth-token`);
    if (!token) throw new Error(`Exact ${item.env} project session missing for ${item.id}`);
    const session = JSON.parse(token.value);
    const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
    if (claims.aal !== "aal2" || claims.exp * 1000 <= Date.now()) throw new Error(`Saved ${item.env} AAL2 session expired for ${item.id}`);
    const context = await browser.newContext({ storageState: statePath, viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();
    const auth = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.hostname === new URL(cfg.host).hostname && url.pathname.startsWith("/auth/v1/")) auth.push({ path: url.pathname, status: response.status() });
    });
    try {
      const response = await page.goto(new URL(item.route, cfg.host).href, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(process.argv.includes("--settle-recheck") ? 5000 : 2200);
      const body = await page.locator("body").innerText().catch(() => "");
      const headingText = (await page.locator("h1,h2").allTextContents().catch(() => [])).join(" ");
      const currentToken = await page.evaluate((key) => localStorage.getItem(key), `sb-${cfg.ref}-auth-token`).catch(() => null);
      let currentClaims = null;
      if (currentToken) {
        try { currentClaims = JSON.parse(Buffer.from(JSON.parse(currentToken).access_token.split(".")[1], "base64url").toString("utf8")); } catch {}
      }
      const control = page.getByRole("button", { name: /new tenant/i });
      const controlCount = await control.count();
      results.push({
        id: item.id, environment: item.env, releaseApp: cfg.app, schemaLedger: cfg.ledger,
        actorRole: actor.current_role, actualAal2Precondition: true, tokenSubjectMatches: currentClaims?.sub === actor.user_id,
        navigationHttpStatus: response?.status() ?? null, finalPath: new URL(page.url()).pathname,
        authenticatedSurface: /sign in to continue|welcome back/iu.test(body) ? "AUTH_REQUIRED" : "SIGNED_IN",
        platformHeadingVisible: /platform administration/iu.test(headingText),
        newTenantButtonVisible: controlCount > 0,
        newTenantButtonEnabled: controlCount > 0 ? await control.isEnabled().catch(() => false) : false,
        bodyTextLength: body.length,
        ownWorkspaceOrGovernanceVisible: item.route.includes("workspace")
          ? /workspace|reconciliation|dashboard/iu.test(`${headingText} ${body}`)
          : item.route.includes("governance") && /governance|membership approvals|access reviews|audit trail/iu.test(body),
        environmentUnavailable: /environment unavailable/iu.test(body),
        rawDiagnosticMarker: /SQLSTATE|PGRST\d{3}|stack trace|postgresql?/iu.test(body),
        authResponseStatuses: auth,
      });
    } catch (error) {
      results.push({ id: item.id, environment: item.env, releaseApp: cfg.app, schemaLedger: cfg.ledger, status: "NAVIGATION_ERROR", errorName: error instanceof Error ? error.name : "Error" });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const report = {
  capturedAt: new Date().toISOString(),
  evidenceTier: "LIVE_READ_ONLY_AUTHENTICATED_ROUTE_SMOKE",
  releaseBasis: { PROD: base.PROD, DEV: base.DEV },
  readinessReceipts: {
    PROD: path.basename((await readdir(qaRoot)).filter((name) => /^SESSION-READINESS-2026-10-03T.*\.json$/u.test(name)).sort().at(-1)),
    DEV: path.basename((await readdir(qaRoot)).filter((name) => /^DEV-SESSION-READINESS-2026-10-03T.*\.json$/u.test(name)).sort().at(-1)),
  },
  cases: results,
  mutations: 0,
  limitations: ["Auth Admin settings/ZeptoMail were not reread; the 999/hour and provider state are prior receipt plus owner confirmation.", "Platform New tenant control was observed but not invoked; server-side create denial was not exercised.", "No DEV tenant_analyst exists in the saved actor set; DEV ordinary-role negative case remains open."],
};
const evidencePath = path.join(evidenceRoot, process.argv.includes("--settle-recheck")
  ? "LINNAEUS-PAIRED-RELEASE-SETTLE-RECHECK-20261004.json"
  : "LINNAEUS-PAIRED-RELEASE-SMOKE-20261004.json");
await writeFile(evidencePath, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(JSON.stringify({ evidencePath, caseCount: results.length, cases: results.map(({ id, actorRole, actualAal2Precondition, tokenSubjectMatches, navigationHttpStatus, finalPath, authenticatedSurface, platformHeadingVisible, newTenantButtonVisible, newTenantButtonEnabled, ownWorkspaceOrGovernanceVisible, environmentUnavailable, status }) => ({ id, actorRole, actualAal2Precondition, tokenSubjectMatches, navigationHttpStatus, finalPath, authenticatedSurface, platformHeadingVisible, newTenantButtonVisible, newTenantButtonEnabled, ownWorkspaceOrGovernanceVisible, environmentUnavailable, status: status ?? "CAPTURED" })) }) + "\n");
