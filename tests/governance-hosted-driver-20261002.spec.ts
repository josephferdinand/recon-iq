import { afterAll, describe, expect, it } from "vitest";
import { chromium, expect as pwExpect, type Browser } from "@playwright/test";
import type { GovernanceMembershipOptions, GovernanceMembershipRequest } from "../src/lib/governance-membership.functions";
import type { GovernanceAccessReviewOption } from "../src/lib/governance-access-review.functions";
import {
  actorSession, loadInputs, modeFromArgs, safeSummary, verifyReleaseAck, verifySupplementalCatalogs,
  validateGovernanceAck, membershipOptionArgs, membershipListArgs, membershipWithdrawArgs, assertExactReplay, membershipChoices, reviewChoices, rpc, assertResourceRead, assertMembershipCount, verifyLiveRoles, assertSafeGovernanceCsv,
} from "../scripts/qa/governance-approval-hosted-20261002.mjs";

describe("governance hosted driver safety", () => {
  it("defaults to read-only preflight and requires an explicit execution flag", () => {
    expect(modeFromArgs([])).toBe("preflight");
    expect(modeFromArgs(["--execute"])).toBe("execute");
  });

  it("redacts bearer tokens and opaque publishable key strings from summaries", () => {
    const output = safeSummary({ token: "Bearer abc", jwt: "eyJhbGci.abc.def", key: "sb_publishable_abc", status: "ready" });
    expect(output).not.toMatch(/Bearer abc|eyJhbGci|sb_publishable_abc/u);
    expect(output).toContain("ready");
  });

  it("matches both owner-supplied read-only PROD and DEV catalog supplements", async () => {
    await expect(verifySupplementalCatalogs()).resolves.toMatchObject({
      PROD: { read_only: true, columns: 148, enum_labels: 264 },
      DEV: { read_only: true, columns: 148, enum_labels: 264 },
    });
  });

  it("rejects the completed cosmetic releases even if an acknowledgement claims verification", () => {
    expect(() => validateGovernanceAck({ release_kind: "governance", governance_ready: true, parent_explicit_ack: true, production_deployment_id: "cef2c7e7", dev_deployment_id: "48e15093", sql_verified: true, production_hosted_readback: true })).toThrow("Cosmetic");
    expect(() => validateGovernanceAck({ production_deployment_id: "new-release", sql_verified: true })).toThrow("Explicit parent");
  });
  it("uses the actual named-options parameter contract without caller authority", () => {
    expect(membershipOptionArgs({ tenant_id: "tenant", bu_id: "bu", workspace_id: "workspace" }, "group")).toEqual({ _tenant_id: "tenant", _kind: "group", _page: 1, _page_size: 25, _search: "", _bu_id: "bu", _workspace_id: "workspace", _environment: "prod" });
  });
  it("passes requester own_only through the current native list/SDK port", () => {
    expect(membershipListArgs({ tenant_id: "tenant", own_only: true })).toEqual({ _tenant_id: "tenant", _page: 1, _page_size: 25, _search: "", _status: null, _bu_id: null, _environment: null, _own_only: true });
    expect(membershipListArgs({ tenant_id: "tenant" })._own_only).toBe(false);
  });
  it("uses the versioned requester-only withdraw port without an acting-identity override", () => {
    expect(membershipWithdrawArgs({ tenant_id: "tenant", request_id: "request", expected_version: 3, reason: "Withdraw request", request_key: "key" })).toEqual({ _tenant_id: "tenant", _request_id: "request", _expected_version: 3, _reason: "Withdraw request", _request_key: "key" });
  });
  it("requires the exact committed audit/version/correlation result on replay", () => {
    const result = { id: "request", version: 2, audit_id: "17", correlation_id: "correlation", outcome: "no_access_granted", status: "withdrawn" };
    expect(() => assertExactReplay(result, { ...result }, "withdraw")).not.toThrow();
    for (const change of [{ version: 3 }, { audit_id: "18" }, { correlation_id: "changed" }, { status: "pending" }]) expect(() => assertExactReplay(result, { ...result, ...change }, "withdraw")).toThrow("differs");
  });
  it("rejects public input paths before reading credential material", async () => {
    await expect(loadInputs("C:/not-private/governance.json")).rejects.toThrow("protected");
  });
  it("checks formula protection in reason cells as well as the first CSV column", () => {
    const header = ['occurred_at','request_id','review_id','actor_name','actor_role','team_name','scope_label','environment','action','outcome','reason','version','id','correlation_id'].map(value => `"${value}"`).join(',');
    const cells = Array(14).fill('""'); cells[10] = '"=HYPERLINK()"';
    expect(() => assertSafeGovernanceCsv(`${header}\r\n${cells.join(',')}`)).toThrow("unsafe");
    cells[10] = '"\'=HYPERLINK()"';
    expect(assertSafeGovernanceCsv(`\uFEFF${header}\r\n${cells.join(',')}`)).toEqual({ rows: 1, columns: 14 });
  });
});

const executeSuite = process.env.FVI_GOVERNANCE_EXECUTE === "1" ? describe : describe.skip;
executeSuite("governance actual production UI workflow", () => {
  it("submits a named-scope request, independently approves, sets up campaigns, retains and revokes through the app", async () => {
    const input = await loadInputs();
    await verifyReleaseAck(undefined, input.environment);
    await verifySupplementalCatalogs();
    await verifyLiveRoles(input);
    await assertResourceRead(input, false);
    await assertMembershipCount(input, 0);
    const { randomUUID } = await import("node:crypto");
    const runId = randomUUID();
    const browser = await chromium.launch({ headless: true });
    browserHandles.push(browser);
    const { mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const captureRoot = path.resolve(process.env.FVI_GOVERNANCE_EVIDENCE_DIR ?? "");
    const captureRelative = path.relative(path.resolve(process.env.LOCALAPPDATA!, "FVI-QA-Private-20260925", "governance-approval-hosted-20261002", "captures"), captureRoot);
    if (!process.env.FVI_GOVERNANCE_EVIDENCE_DIR || captureRelative.startsWith("..") || path.isAbsolute(captureRelative)) throw new Error("Dedicated private governance captures directory is required");
    await mkdir(captureRoot, { recursive: true });
    const capture = async (page: import('@playwright/test').Page, label: string) => page.screenshot({ path: path.join(captureRoot, `${runId}-${label}.png`), fullPage: true });
    const open = async (actor: string, route: string) => {
      await actorSession(input.actors[actor], input.supabase_url);
      const context = await browser.newContext({ storageState: input.actors[actor].storage_state, viewport: { width: 1440, height: 1000 } });
      await context.route(/\/auth\/v1\/token(?:\?|$)/u, route => route.abort("blockedbyclient"));
      const page = await context.newPage();
      await page.goto(`${input.app_origin}${input.tenant_slug}/${route}`, { waitUntil: "domcontentloaded" });
      return page;
    };
    const pick = async (page: import('@playwright/test').Page, label: string, optionLabel: string) => {
      await page.getByRole("combobox", { name: label, exact: true }).click();
      const list = page.getByRole("listbox", { name: `${label} options`, exact: true });
      await page.getByRole("textbox", { name: `Search ${label}`, exact: true }).fill(optionLabel);
      const option = list.getByRole("option").filter({ has: page.locator("span.font-medium", { hasText: optionLabel }) });
      await pwExpect(option).toHaveCount(1);
      await option.click();
    };
    const options: Record<string, GovernanceMembershipOptions['rows'][number]> = {};
    for (const kind of ["bu", "workspace", "group", "environment"]) {
      const rows = await membershipChoices(input, input.actors.requester, kind);
      const id = ({ bu: input.bu_id, workspace: input.workspace_id, group: input.group_id } as Record<string, string>)[kind];
      const chosen = rows.find((row: GovernanceMembershipOptions['rows'][number]) => kind === "environment" ? row.environment === input.membership_environment : row.id === id);
      if (!chosen || chosen.selectable === false) throw new Error(`No current authorized named ${kind} option`);
      options[kind] = chosen;
    }
    const requesterPage = await open("requester", "workspace?page=membership-requests");
    const reason = `Governance UI QA ${runId}`;
    await pick(requesterPage, "Business unit", options.bu.label);
    await pick(requesterPage, "Registered environment", input.membership_environment);
    await pick(requesterPage, "Workspace", options.workspace.label);
    await pick(requesterPage, "Group", options.group.label);
    await pwExpect(requesterPage.getByText("Effective group scope", { exact: true })).toBeVisible();
    await requesterPage.getByLabel("Why do you need this access?", { exact: true }).fill(reason);
    await capture(requesterPage, "requester-named-scope");
    await verifyReleaseAck(undefined, input.environment);
    await requesterPage.getByRole("button", { name: "Submit membership request", exact: true }).click();
    await pwExpect(requesterPage.getByText(/It is awaiting an independent tenant administrator/)).toBeVisible();
    const requests = (await rpc(input, input.actors.requester, "list_governance_membership_requests", { _tenant_id: input.tenant_id, _page: 1, _page_size: 100, _search: "", _status: "pending", _bu_id: input.bu_id, _environment: input.membership_environment, _own_only: true })).data;
    expect(requests.rows.every((row: GovernanceMembershipRequest) => row.requested_by === input.actors.requester.user_id)).toBe(true);
    const request: GovernanceMembershipRequest = requests.rows.find((row: GovernanceMembershipRequest) => row.request_reason === reason);
    expect(request?.group_id).toBe(input.group_id);
    const checkerPage = await open("checker", "tenant?page=governance");
    await checkerPage.getByLabel("Search governance records").fill(options.group.label);
    const requestRow = checkerPage.getByRole("row").filter({ hasText: request.id.slice(0, 8) });
    await pwExpect(requestRow).toHaveCount(1);
    await requestRow.getByRole("button", { name: "Review", exact: true }).click();
    await checkerPage.getByLabel("Decision reason", { exact: true }).fill(`Independent UI approval ${runId}`);
    await verifyReleaseAck(undefined, input.environment);
    await checkerPage.getByRole("button", { name: "Approve request", exact: true }).click();
    await pwExpect(checkerPage.getByRole("dialog")).toHaveCount(0);
    await assertResourceRead(input, true);
    await assertMembershipCount(input, 1);
    await capture(checkerPage, "independent-membership-approval");
    const makerPage = await open("maker", "tenant?page=governance");
    for (const decision of ["retain", "revoke"] as const) {
      const members: GovernanceAccessReviewOption[] = await reviewChoices(input, input.actors.maker, "members");
      const reviewers: GovernanceAccessReviewOption[] = await reviewChoices(input, input.actors.maker, "reviewers");
      const member = members.find(row => row.subject_user_id === input.actors.requester.user_id && row.group_id === input.group_id);
      const reviewer = reviewers.find(row => row.id === input.actors.checker.user_id);
      if (!member?.snapshot_hash || !reviewer?.label || !(member.label ?? member.member_name)) throw new Error("Campaign first setup lacks actual named current membership/reviewer options");
      await makerPage.getByRole("button", { name: "Access reviews", exact: true }).click();
      await makerPage.getByRole("button", { name: "Create review campaign", exact: true }).click();
      const campaignName = `UI ${decision} ${runId}`;
      await makerPage.getByLabel("Campaign name", { exact: true }).fill(campaignName);
      await makerPage.getByLabel("Decision due at", { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
      await pick(makerPage, "Business unit", options.bu.label);
      await pick(makerPage, "Group", options.group.label);
      await pick(makerPage, "Workspace", options.workspace.label);
      await pick(makerPage, "Member", member.label ?? member.member_name!);
      await pick(makerPage, "Independent reviewer", reviewer.label);
      await makerPage.getByRole("button", { name: "Add member to campaign", exact: true }).click();
      await capture(makerPage, `${decision}-campaign-first-setup`);
      await verifyReleaseAck(undefined, input.environment);
      await makerPage.getByRole("button", { name: "Create campaign · 1", exact: true }).click();
      await pwExpect(makerPage.getByRole("heading", { name: "Create access review campaign", exact: true })).toHaveCount(0);
      await checkerPage.reload({ waitUntil: "domcontentloaded" });
      await checkerPage.getByRole("button", { name: "Access reviews", exact: true }).click();
      await checkerPage.getByLabel("Search governance records").fill(campaignName);
      await checkerPage.getByRole("row").filter({ hasText: campaignName }).getByRole("button", { name: "Review", exact: true }).click();
      await checkerPage.getByLabel("Decision reason", { exact: true }).fill(`Independent UI ${decision} ${runId}`);
      await verifyReleaseAck(undefined, input.environment);
      await checkerPage.getByRole("button", { name: decision === "retain" ? "Retain access" : "Revoke access", exact: true }).click();
      await pwExpect(checkerPage.getByRole("dialog")).toHaveCount(0);
      await assertResourceRead(input, decision === "retain");
      await assertMembershipCount(input, decision === "retain" ? 1 : 0);
      await capture(checkerPage, `review-${decision}-committed`);
    }
    await checkerPage.getByRole("button", { name: "Audit trail", exact: true }).click();
    await pwExpect(checkerPage.getByRole("heading", { name: "Audit trail", exact: true })).toBeVisible();
    await pwExpect(checkerPage.getByRole("status").filter({ hasText: /^Loading/u })).toHaveCount(0);
    await capture(checkerPage, "audit-actual-outcomes");
  }, 240_000);
});

const hosted = process.env.FVI_GOVERNANCE_CAPTURE_UI === "1" || process.env.FVI_GOVERNANCE_EXECUTE === "1";
const browserHandles: Browser[] = [];
const hostedSuite = hosted ? describe : describe.skip;

hostedSuite("governance production hosted UI captures", () => {
  afterAll(async () => { await Promise.all(browserHandles.map(browser => browser.close())); });

  it("captures all three released governance views at desktop and mobile sizes", async () => {
    const input = await loadInputs();
    const { ack } = await verifyReleaseAck(undefined, input.environment);
    const deploymentId = input.environment === "DEV" ? ack.dev_deployment_id : ack.production_deployment_id;
    const admin = input.actors.checker;
    await actorSession(admin, input.supabase_url);
    const evidenceRoot = process.env.FVI_GOVERNANCE_EVIDENCE_DIR;
    expect(evidenceRoot, "Set FVI_GOVERNANCE_EVIDENCE_DIR to a new folder under the protected QA root").toBeTruthy();
    const { mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const resolved = path.resolve(evidenceRoot!);
    const relative = path.relative(path.resolve(process.env.LOCALAPPDATA!, "FVI-QA-Private-20260925"), resolved);
    expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
    expect(relative.split(path.sep).slice(0, 2)).toEqual(["governance-approval-hosted-20261002", "captures"]);
    await mkdir(resolved, { recursive: true });

    for (const viewport of [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const browser = await chromium.launch({ headless: true });
      browserHandles.push(browser);
      const context = await browser.newContext({ storageState: admin.storage_state, viewport: { width: viewport.width, height: viewport.height } });
      await context.route(/\/auth\/v1\/token(?:\?|$)/u, route => route.abort("blockedbyclient"));
      const page = await context.newPage();
      await page.goto(`${input.app_origin}${input.tenant_slug}/tenant?page=governance`, { waitUntil: "domcontentloaded" });
      await pwExpect(page).toHaveURL(/app\.falconveritas\.com/u);
      await pwExpect(page.getByRole("navigation", { name: "Governance views" })).toBeVisible();
      await pwExpect(page.getByRole("button", { name: "Membership approvals" })).toBeVisible();
      await pwExpect(page.getByRole("button", { name: "Access reviews" })).toBeVisible();
      await pwExpect(page.getByRole("button", { name: "Audit trail" })).toBeVisible();

      for (const view of ["Membership approvals", "Access reviews", "Audit trail"]) {
        await page.getByRole("button", { name: view }).click();
        await pwExpect(page.getByRole("heading", { name: view, exact: true })).toBeVisible();
        await pwExpect(page.getByRole("status").filter({ hasText: /^Loading/u })).toHaveCount(0);
        await pwExpect(page.getByRole("alert")).toHaveCount(0);
        await page.screenshot({ path: path.join(resolved, `${input.environment}-${viewport.name}-${view.toLowerCase().replaceAll(" ", "-")}-${deploymentId}.png`), fullPage: true });
        if (view === "Audit trail") {
          const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
          const csvPath = path.join(resolved, `${input.environment}-${viewport.name}-audit-trail-${deploymentId}.csv`);
          await download.saveAs(csvPath);
          const { readFile } = await import("node:fs/promises");
          const csv = await readFile(csvPath, "utf8");
          pwExpect(csv.startsWith("\uFEFF")).toBe(true);
          pwExpect(csv).toContain('"occurred_at"');
          pwExpect(csv).toContain('"reason"');
          pwExpect(csv).toContain('"correlation_id"');
          expect(assertSafeGovernanceCsv(csv).columns).toBe(14);
        }
      }
      await context.close();
    }
  }, 180_000);
});
