import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fromJSON, fromCrossJSON } from "seroval";

const origins = { PROD: "https://app.reconiq.example", DEV: "https://dev.app.reconiq.example" };
const oldApps = new Set([
  "7180321a-e9c5-4014-bd9b-a3f1c52e392b",
  "ce449c37-d9cd-4a7a-8d5f-032c881f4e95",
]);
const sourceSha = "f8285a42ea7dfb1424989643f2ff585f1428b856fd8c6c6be884c08cfe20ee63";
const privateRoot = "./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925";
const storageKey = "fvi-signup-recovery-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateRegistrationQaAck(ack) {
  if (!ack || ack.kind !== "FVI_REGISTRATION_BOUNDED_QA_ACK" || !origins[ack.environment])
    throw Error("ACK_MISSING_OR_UNSUPPORTED");
  if (ack.origin !== origins[ack.environment]) throw Error("ACK_ORIGIN_MISMATCH");
  if (ack.sqlCommitted !== true || ack.registrationSqlSourceSha256 !== sourceSha)
    throw Error("ACK_SQL_NOT_PROVEN");
  if (
    ack.appDeployed !== true ||
    !uuid.test(ack.deploymentId ?? "") ||
    oldApps.has(ack.deploymentId?.toLowerCase())
  )
    throw Error("ACK_APP_NOT_PROVEN");
  if (ack.routeWired !== true || ack.path !== "/request-invite")
    throw Error("ACK_WIRING_NOT_PROVEN");
  if (
    ack.allowOneInvitation !== true ||
    ack.userKind !== "NEW_OWNED_REGISTRATION_USER" ||
    ack.verifiedDomain !== true
  )
    throw Error("ACK_MAIL_OR_ACTOR_NOT_APPROVED");
  if (
    typeof ack.email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(ack.email.trim()) ||
    ack.email.trim().length > 254 ||
    typeof ack.fullName !== "string" ||
    !ack.fullName.trim() ||
    ack.fullName.trim().length > 120
  )
    throw Error("ACK_OWNED_FIELDS_MISSING");
  const output = path.resolve(ack.outputDirectory ?? "");
  const base = path.resolve(privateRoot) + path.sep;
  if (!output.toLowerCase().startsWith(base.toLowerCase()))
    throw Error("ACK_OUTPUT_MUST_BE_PRIVATE_FVI");
  return {
    ...ack,
    email: ack.email.trim().toLowerCase(),
    fullName: ack.fullName.trim(),
    outputDirectory: output,
  };
}
export function nextRegistrationQaAction(journal) {
  if (!journal || typeof journal.submitIntent !== "boolean")
    throw Error("JOURNAL_INVALID_DO_NOT_REISSUE");
  if (journal.submitIntent === false) {
    if (
      journal.recoveryProof ||
      journal.intentAt ||
      journal.firstTransportStatus ||
      journal.lastCheckAt
    )
      throw Error("JOURNAL_CONTRADICTORY_DO_NOT_REISSUE");
    return "FIRST_OWNED_SUBMIT";
  }
  if (!journal.recoveryProof) throw Error("INTERRUPTED_WITHOUT_PROOF_DO_NOT_REISSUE");
  if (journal.recoveryProof.email !== journal.email) throw Error("JOURNAL_ACTOR_MISMATCH");
  return "CHECK_ORIGINAL_REQUEST_ONLY";
}
export function validateRecoveryProof(value, ack) {
  if (
    !value ||
    !uuid.test(value.attemptId ?? "") ||
    !/^[a-f0-9]{64}$/.test(value.recoveryToken ?? "") ||
    value.email !== ack.email.trim().toLowerCase() ||
    value.full_name !== ack.fullName.trim()
  )
    throw Error("RECOVERY_PROOF_INVALID_OR_WRONG_ACTOR");
  return {
    attemptId: value.attemptId,
    recoveryToken: value.recoveryToken,
    email: value.email,
    full_name: value.full_name,
  };
}
export function validateJournal(journal, ack) {
  if (
    !journal ||
    journal.kind !== "FVI_REGISTRATION_QA_JOURNAL_V1" ||
    journal.email !== ack.email ||
    journal.fullName !== ack.fullName ||
    journal.environment !== ack.environment ||
    journal.registrationSqlSourceSha256 !== sourceSha
  )
    throw Error("JOURNAL_SCOPE_MISMATCH_DO_NOT_REISSUE");
  const action = nextRegistrationQaAction(journal);
  if (action === "CHECK_ORIGINAL_REQUEST_ONLY") validateRecoveryProof(journal.recoveryProof, ack);
  return action;
}
export function validateBrowserRecoveryCall(url, body, ack, proof) {
  const endpoint = new URL(url);
  if (endpoint.origin !== ack.origin || !endpoint.pathname.startsWith("/_serverFn/"))
    throw Error("BROWSER_CALL_SCOPE_MISMATCH");
  const decoded = fromJSON(JSON.parse(body));
  const input = decoded?.data;
  validateRecoveryProof(input, ack);
  if (
    input.attemptId !== proof.attemptId ||
    input.recoveryToken !== proof.recoveryToken ||
    !["submit", "check"].includes(input.mode)
  )
    throw Error("BROWSER_CALL_IDENTITY_CHANGED");
  return input.mode;
}
export function publicRecoveryDto(serialized) {
  const value = fromCrossJSON(serialized, { plugins: [] })?.result;
  const known = {
    SIGNUP_INVITE_ACCEPTED: ["accepted", 200, true, false],
    SIGNUP_ACCOUNT_EXISTS: ["existing", 409, false, false],
    SIGNUP_NOT_STARTED: ["not_sent", 503, false, true],
    SIGNUP_RATE_LIMITED: ["not_sent", 429, false, true],
    WRITE_OUTCOME_UNKNOWN: ["unknown", 503, false, false],
    SIGNUP_RECOVERY_UNAVAILABLE: ["unknown", 503, false, false],
    SIGNUP_RECOVERY_RATE_LIMITED: ["unknown", 429, false, false],
  };
  const expected = known[value?.code];
  if (
    !expected ||
    Object.keys(value).some(
      (key) => !["accepted", "outcome", "retryable", "code", "status", "requestId"].includes(key),
    ) ||
    value.outcome !== expected[0] ||
    value.status !== expected[1] ||
    value.accepted !== expected[2] ||
    value.retryable !== expected[3] ||
    (value.requestId !== undefined && !/^FVI-[A-F0-9]{12}$/.test(value.requestId))
  )
    throw Error("LIVE_DTO_UNSAFE_OR_CONTRACT_MISMATCH");
  return {
    accepted: value.accepted,
    outcome: value.outcome,
    retryable: value.retryable,
    code: value.code,
    status: value.status,
    requestId: value.requestId,
  };
}
export async function runRegistrationRecoveryQa(ackFile) {
  // Validate actual parent acknowledgments BEFORE imports/browser/network actions.
  const ack = validateRegistrationQaAck(JSON.parse(await fs.readFile(ackFile, "utf8")));
  const journalFile = path.join(ack.outputDirectory, "registration-private-journal.json");
  await fs.mkdir(ack.outputDirectory, { recursive: true });
  // Exclusive, persistent on crash. Never automatically reclaim a failed run's lock.
  const lockFile = journalFile + ".lock";
  const lock = await fs.open(lockFile, "wx", 0o600);
  let browser;
  try {
    let journal;
    try {
      journal = JSON.parse(await fs.readFile(journalFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw Error("JOURNAL_UNREADABLE_DO_NOT_REISSUE");
      journal = {
        kind: "FVI_REGISTRATION_QA_JOURNAL_V1",
        email: ack.email,
        fullName: ack.fullName,
        environment: ack.environment,
        registrationSqlSourceSha256: sourceSha,
        submitIntent: false,
      };
    }
    const action = validateJournal(journal, ack);
    const save = () =>
      fs.writeFile(journalFile, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
    await save();
    const { chromium } = await import("playwright");
    // Existing installed browser only. No installation, Docker or product build.
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    let submitForwarded = 0;
    let checkForwarded = 0;
    let blockedCalls = 0;
    let lostResponse = false;
    await page.route("**/_serverFn/**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      try {
        const raw = await page.evaluate((key) => sessionStorage.getItem(key), storageKey);
        const proof = validateRecoveryProof(JSON.parse(raw ?? "null"), ack);
        const mode = validateBrowserRecoveryCall(
          route.request().url(),
          route.request().postData(),
          ack,
          proof,
        );
        if (mode === "submit") {
          if (
            action !== "FIRST_OWNED_SUBMIT" ||
            submitForwarded !== 0 ||
            journal.submitIntent !== true
          )
            throw Error("ADDITIONAL_SUBMIT_BLOCKED");
          journal.recoveryProof = proof;
          await save();
          submitForwarded += 1;
          // Ordinary browser request only; no Management/Auth-admin shortcut.
          // No HTTP redirects or transport retries can repeat this write.
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
          journal.firstTransportStatus = response.status();
          journal.firstPublicDto = publicRecoveryDto(await response.json());
          await save();
          lostResponse = true;
          await route.abort("failed");
        } else {
          if (
            !journal.recoveryProof ||
            journal.recoveryProof.attemptId !== proof.attemptId ||
            journal.recoveryProof.recoveryToken !== proof.recoveryToken
          )
            throw Error("CHECK_IDENTITY_CHANGED");
          checkForwarded += 1;
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
          journal.lastPublicDto = publicRecoveryDto(await response.json());
          await save();
          await route.fulfill({ response });
        }
      } catch {
        blockedCalls += 1;
        await route.abort("failed");
      }
    });
    if (action === "CHECK_ORIGINAL_REQUEST_ONLY") {
      const proof = validateRecoveryProof(journal.recoveryProof, ack);
      await context.addInitScript(
        ({ key, proof }) => sessionStorage.setItem(key, JSON.stringify(proof)),
        { key: storageKey, proof },
      );
    }
    await page.goto(`${ack.origin}/request-invite`, { waitUntil: "domcontentloaded" });
    if (
      new URL(page.url()).pathname !== "/request-invite" ||
      new URL(page.url()).origin !== ack.origin
    )
      throw Error("LIVE_ROUTE_NOT_WIRED_NO_MUTATION");
    if (action === "FIRST_OWNED_SUBMIT") {
      await page.getByLabel("Full name", { exact: true }).fill(ack.fullName);
      await page.getByLabel("Work email", { exact: true }).fill(ack.email);
      journal.submitIntent = true;
      journal.intentAt = new Date().toISOString();
      await save();
      await page
        .getByRole("button", { name: "Verify email and request access", exact: true })
        .click();
      await page.getByRole("button", { name: "Check request status", exact: true }).waitFor();
      if (!journal.recoveryProof) throw Error("LIVE_PROOF_CAPTURE_FAILED_DO_NOT_REISSUE");
      if (
        (await page.getByLabel("Full name", { exact: true }).inputValue()) !== ack.fullName ||
        (await page.getByLabel("Work email", { exact: true }).inputValue()) !== ack.email ||
        !(await page
          .getByRole("button", { name: "Verify email and request access", exact: true })
          .isDisabled())
      )
        throw Error("LIVE_UNKNOWN_FIELDS_OR_SUBMIT_LOCK_LOST");
    }
    const terminal = page
      .getByText(
        /verification request was accepted|account already exists|couldn’t confirm whether the verification request|original request has not reached/i,
      )
      .first();
    // A restored page starts its own check. Wait for it before deciding whether
    // the corrective action remains visible; do not race its disabled button.
    await terminal.waitFor();
    const check = page.getByRole("button", { name: "Check request status", exact: true });
    if (await check.isVisible()) {
      const checked = page.waitForResponse(
        (response) =>
          new URL(response.url()).origin === ack.origin &&
          new URL(response.url()).pathname.startsWith("/_serverFn/") &&
          response.request().method() === "POST",
      );
      await check.click();
      await checked;
      await terminal.waitFor();
    }
    const beforeReload = await page.evaluate((key) => sessionStorage.getItem(key), storageKey);
    validateRecoveryProof(JSON.parse(beforeReload ?? "null"), ack);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByText(
        /verification request was accepted|account already exists|couldn’t confirm whether the verification request|original request has not reached/i,
      )
      .first()
      .waitFor();
    const afterReload = await page.evaluate((key) => sessionStorage.getItem(key), storageKey);
    if (beforeReload !== afterReload) throw Error("LIVE_RELOAD_IDENTITY_CHANGED_NO_REISSUE");
    if (blockedCalls || checkForwarded < 1 || (action === "FIRST_OWNED_SUBMIT" && !lostResponse))
      throw Error("LIVE_TRANSPORT_PROOF_INCOMPLETE_DO_NOT_REISSUE");
    const safeUi = await page.locator("main").innerText();
    if (
      /\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|SQLSTATE|PGRST\d+|service_role|stack trace)\b/i.test(safeUi)
    )
      throw Error("LIVE_UNSAFE_MESSAGE_REQUIRES_REVIEW");
    const correlation = safeUi.match(/Request reference: (FVI-[A-F0-9]{12})\b/)?.[1];
    if (correlation && correlation !== journal.lastPublicDto?.requestId)
      throw Error("LIVE_CORRELATION_DOES_NOT_MATCH_DTO");
    if (
      /couldn’t confirm whether/i.test(safeUi) &&
      (await page.getByRole("button", { name: "Continue original request", exact: true }).count())
    )
      throw Error("LIVE_UNKNOWN_OUTCOME_HAS_UNSAFE_RETRY");
    if (/couldn’t confirm whether|account already exists/i.test(safeUi)) {
      const signIn = new URL(
        await page.getByRole("link", { name: "Sign In", exact: true }).getAttribute("href"),
        ack.origin,
      );
      const reset = new URL(
        await page.getByRole("link", { name: "Forgot Password", exact: true }).getAttribute("href"),
        ack.origin,
      );
      if (
        signIn.origin !== ack.origin ||
        signIn.pathname !== "/auth" ||
        reset.origin !== ack.origin ||
        reset.pathname !== "/auth" ||
        reset.searchParams.get("reset") !== "true"
      )
        throw Error("LIVE_CORRECTIVE_LINK_TARGET_INVALID");
    }
    journal.lastCheckAt = new Date().toISOString();
    journal.reloadIdentityStable = true;
    await save();
    await page.screenshot({
      path: path.join(ack.outputDirectory, "registration-recovery-private.png"),
      fullPage: false,
    });
    const receipt = {
      at: journal.lastCheckAt,
      environment: ack.environment,
      deploymentId: ack.deploymentId,
      emailSha256: createHash("sha256").update(ack.email).digest("hex"),
      action,
      firstTransportStatus: journal.firstTransportStatus,
      firstPublicDto: journal.firstPublicDto,
      lastPublicDto: journal.lastPublicDto,
      reloadIdentityStable: true,
      browserSubmitRequestsForwardedThisRun: submitForwarded,
      browserStatusChecksForwardedThisRun: checkForwarded,
      browserCallsBlockedThisRun: blockedCalls,
      requestReference: correlation,
      authProviderInvitationCount: "NOT_VERIFIED_REQUIRES_PARENT_READBACK",
      workflowScope: "NORMAL_OWNED_PUBLIC_UI_ONLY",
      delivery: "NOT_VERIFIED",
      MFAAndAdmission: "REMAIN_PARENT_ACCEPTANCE",
      privateJournal: journalFile,
    };
    await fs.writeFile(
      path.join(ack.outputDirectory, "registration-recovery-receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    return receipt;
  } finally {
    if (browser) await browser.close();
    await lock.close();
    await fs.unlink(lockFile);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ack = process.argv[2];
  if (!ack) {
    console.error("ACK_REQUIRED_NO_BROWSER_OR_INVITATION_STARTED");
    process.exitCode = 2;
  } else
    runRegistrationRecoveryQa(ack)
      .then((result) => console.log(JSON.stringify(result)))
      .catch(() => {
        console.error("REGISTRATION_QA_STOPPED_REVIEW_PRIVATE_JOURNAL_DO_NOT_REISSUE");
        process.exitCode = 1;
      });
}
