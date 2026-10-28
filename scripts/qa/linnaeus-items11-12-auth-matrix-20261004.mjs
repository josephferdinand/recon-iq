import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const privateRoot = path.join(process.env.LOCALAPPDATA ?? "", "FVI-QA-Private-20260925");
const governanceRoot = path.join(privateRoot, "governance-approval-hosted-20261002");
const outputRoot = path.join(privateRoot, "Linnaeus-Items11-12-20261004");
const cases = [
  { id: "AUTH-PROD-ANON-PLATFORM", env: "PROD", origin: "https://app.reconiq.example", path: "/platform", anonymous: true },
  { id: "AUTH-DEV-ANON-PLATFORM", env: "DEV", origin: "https://dev.app.reconiq.example", path: "/platform", anonymous: true },
  { id: "AUTH-PROD-REQUESTER-WORKSPACE", env: "PROD", actor: "requester", origin: "https://app.reconiq.example", path: "/reconiq-assurance-lab-prod/workspace?page=dashboard" },
  { id: "AUTH-PROD-REQUESTER-PLATFORM-DENY", env: "PROD", actor: "requester", origin: "https://app.reconiq.example", path: "/platform" },
  { id: "AUTH-PROD-CHECKER-GOVERNANCE", env: "PROD", actor: "checker", origin: "https://app.reconiq.example", path: "/reconiq-assurance-lab-prod/tenant?page=governance" },
  { id: "AUTH-PROD-CROSS-ENV-SLUG-DENY", env: "PROD", actor: "requester", origin: "https://app.reconiq.example", path: "/reconiq-assurance-lab-development/tenant?page=governance" },
  { id: "AUTH-DEV-MAKER-GOVERNANCE", env: "DEV", actor: "maker", origin: "https://dev.app.reconiq.example", path: "/reconiq-assurance-lab-development/tenant?page=governance" },
  { id: "AUTH-DEV-MAKER-PLATFORM-DENY", env: "DEV", actor: "maker", origin: "https://dev.app.reconiq.example", path: "/platform" },
  { id: "AUTH-DEV-CHECKER-GOVERNANCE", env: "DEV", actor: "checker", origin: "https://dev.app.reconiq.example", path: "/reconiq-assurance-lab-development/tenant?page=governance" },
  { id: "AUTH-DEV-CROSS-ENV-SLUG-DENY", env: "DEV", actor: "maker", origin: "https://dev.app.reconiq.example", path: "/reconiq-assurance-lab-prod/tenant?page=governance" },
];

function readTokenClaims(storageState, projectRef) {
  const item = (storageState.origins ?? [])
    .flatMap((origin) => origin.localStorage ?? [])
    .find((entry) => entry.name === `sb-${projectRef}-auth-token`);
  if (!item) return null;
  try {
    const session = JSON.parse(item.value);
    const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
    return { claims, session };
  } catch {
    return null;
  }
}

async function readReadiness(env) {
  const file = env === "PROD"
    ? path.join(governanceRoot, "SESSION-READINESS-2026-10-03T18-41-17-983Z.json")
    : path.join(governanceRoot, "DEV-SESSION-READINESS-2026-10-03T18-49-23-306Z.json");
  return JSON.parse(await readFile(file, "utf8"));
}

const refs = {
  PROD: "YOUR_PROJECT_REF",
  DEV: "YOUR_PROJECT_REF",
};
const readiness = {
  PROD: await readReadiness("PROD"),
  DEV: await readReadiness("DEV"),
};

for (const env of ["PROD", "DEV"]) {
  for (const actor of readiness[env].actors) {
    if (actor.real_aal2 !== true || actor.active === false) {
      throw new Error(`${env} saved actor readiness is not verified at AAL2`);
    }
  }
}

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const refreshedStates = new Map();

try {
  for (const testCase of cases) {
    const actor = testCase.anonymous
      ? null
      : readiness[testCase.env].actors.find((candidate) => candidate.kind === testCase.actor);
    if (!testCase.anonymous && !actor) throw new Error(`Saved actor missing for ${testCase.id}`);
    const storedState = actor?.storage_state;
    const inputState = storedState
      ? path.isAbsolute(storedState) ? storedState : path.join(privateRoot, storedState)
      : undefined;
    const original = inputState ? JSON.parse(await readFile(inputState, "utf8")) : null;
    const before = original ? readTokenClaims(original, refs[testCase.env]) : null;
    if (actor && (!before || before.claims.sub !== actor.user_id || before.claims.aal !== "aal2" || before.claims.exp * 1000 <= Date.now())) {
      results.push({ id: testCase.id, env: testCase.env, actor: actor.kind, role: actor.current_role, status: "BLOCKED_SESSION_NOT_CURRENT_AAL2" });
      continue;
    }

    const context = await browser.newContext(inputState ? { storageState: inputState } : {});
    const page = await context.newPage();
    const authResponses = [];
    const apiFailures = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.hostname !== new URL(testCase.origin).hostname) return;
      if (url.pathname.startsWith("/auth/v1/")) authResponses.push({ path: url.pathname, status: response.status() });
      if (url.pathname.startsWith("/rest/v1/") && response.status() >= 400) {
        apiFailures.push({ path: url.pathname, status: response.status() });
      }
    });

    let navigationStatus = null;
    try {
      const response = await page.goto(new URL(testCase.path, testCase.origin).href, { waitUntil: "domcontentloaded", timeout: 25000 });
      navigationStatus = response?.status() ?? null;
      await page.waitForTimeout(1800);
      const current = new URL(page.url());
      const body = await page.locator("body").innerText().catch(() => "");
      const alertCount = await page.getByRole("alert").count().catch(() => 0);
      const appEnvironment = /Environment unavailable/i.test(body)
        ? "unavailable"
        : /\bPROD\b/u.test(body) ? "PROD" : /\bDEV\b/u.test(body) ? "DEV" : "not-visible";
      const publicState = {
        signInRequired: /sign in to continue|please sign in|welcome back/iu.test(body),
        accessDenied: /you do not currently have access|you don't have access|not authorized|access denied|permission denied/iu.test(body),
        unavailable: /unavailable|could not be loaded|temporarily unavailable/iu.test(body),
        retryActionVisible: /\bRetry\b/iu.test(body),
        rawDiagnosticMarker: /SQLSTATE|PGRST\d{3}|stack trace|postgresql?/iu.test(body),
      };
      const tokenNow = await page.evaluate((key) => localStorage.getItem(key), `sb-${refs[testCase.env]}-auth-token`).catch(() => null);
      let currentClaims = null;
      if (tokenNow) {
        try { currentClaims = JSON.parse(Buffer.from(JSON.parse(tokenNow).access_token.split(".")[1], "base64url").toString("utf8")); } catch {}
      }
      const actorStillBound = actor ? currentClaims?.sub === actor.user_id : false;
      const currentAal = actor ? (currentClaims?.aal ?? "missing") : null;
      const result = {
        id: testCase.id,
        env: testCase.env,
        release: testCase.env === "PROD" ? "5fbb724d-225e-4c75-998d-93fbab993cb4" : "4d170bfd-d7db-42ea-94b9-fa5ce84e2270",
        actor: actor?.kind ?? "anonymous",
        role: actor?.current_role ?? null,
        savedAal2Precondition: actor?.real_aal2 ?? false,
        navigationStatus,
        finalPath: current.pathname,
        expectedAuthGate: testCase.anonymous ? current.pathname.startsWith("/auth") : undefined,
        authenticatedActorPreserved: actor ? actorStillBound : undefined,
        currentAal,
        appEnvironment,
        alertCount,
        publicState,
        governanceVisible: /Membership approvals|Access reviews|Audit trail|Governance/iu.test(body),
        requesterWorkspaceVisible: /Workspace|Reconciliations/iu.test(body),
        containsOtherEnvironmentSlug: body.includes(testCase.env === "PROD" ? "reconiq-assurance-lab-development" : "reconiq-assurance-lab-prod"),
        authResponses,
        apiFailureStatuses: apiFailures,
      };
      results.push(result);

      if (actor && actorStillBound && currentAal === "aal2") {
        const serialized = await context.storageState();
        const after = readTokenClaims(serialized, refs[testCase.env]);
        if (after && after.claims.sub === actor.user_id && after.claims.aal === "aal2" && after.claims.exp * 1000 > (before.claims.exp * 1000)) {
          refreshedStates.set(`${testCase.env}-${actor.kind}`, serialized);
        }
      }
    } catch (error) {
      results.push({ id: testCase.id, env: testCase.env, actor: actor?.kind ?? "anonymous", role: actor?.current_role ?? null, status: "NAVIGATION_ERROR", errorName: error instanceof Error ? error.name : "Error" });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

for (const [key, state] of refreshedStates) {
  const target = path.join(outputRoot, `${key}-refreshed.storageState.json`);
  await writeFile(target, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
}

const report = {
  capturedAt: new Date().toISOString(),
  scope: "Read-only UI route/auth/config parity and role-gate probes using only saved exact-environment AAL2 QA sessions; no form submissions or business mutations.",
  deployments: {
    PROD: { app: "5fbb724d-225e-4c75-998d-93fbab993cb4", sql: 448 },
    DEV: { app: "4d170bfd-d7db-42ea-94b9-fa5ce84e2270", sql: 426 },
  },
  configBasis: "Auth email limit 999/hour and ZeptoMail preservation reused from FVI_AUTH_EMAIL_LIMIT_999_VERIFIED_2026-10-03.md; no Auth Admin configuration mutation or reread performed here.",
  results,
  refreshedSessionFiles: [...refreshedStates.keys()],
};
const reportPath = path.join(outputRoot, "LINNAEUS-AUTH-MATRIX-20261004.json");
await writeFile(reportPath, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(JSON.stringify({ reportPath, caseCount: results.length, refreshedActorCount: refreshedStates.size, cases: results.map(({ id, env, actor, role, finalPath, expectedAuthGate, authenticatedActorPreserved, currentAal, appEnvironment, navigationStatus, status }) => ({ id, env, actor, role, finalPath, expectedAuthGate, authenticatedActorPreserved, currentAal, appEnvironment, navigationStatus, status: status ?? "OBSERVED" })) }) + "\n");
