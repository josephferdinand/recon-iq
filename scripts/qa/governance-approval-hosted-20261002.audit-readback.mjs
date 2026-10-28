// Current readback and settled captures only; completed decisions are never repeated.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { actorSession } from "./governance-approval-hosted-20261002.mjs";
const root = path.join(process.env.LOCALAPPDATA, "FVI-QA-Private-20260925");
const own = path.join(root, "governance-approval-hosted-20261002");
const readiness = JSON.parse(await readFile(process.env.FVI_GOVERNANCE_SESSION_READINESS_FILE, "utf8"));
const checker = readiness.actors.find(actor => actor.kind === "checker" && actor.real_aal2);
const transport = JSON.parse(await readFile(path.join(root, "FVI-QA-TRANSPORT-PROD-20261001.json"), "utf8"));
const input = JSON.parse(await readFile(path.join(own, "INPUT-PROD-df40ff88-8a4f-479b-b231-bf1e2b47b576.json"), "utf8"));
const { token } = await actorSession(checker, transport.apiUrl);
const headers = { apikey: transport.anonKey, Authorization: `Bearer ${token}` };
async function read(table, query) {
  const response = await fetch(`${transport.apiUrl}/rest/v1/${table}?${new URLSearchParams(query)}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Current ${table} read refused HTTP${response.status}`);
  return response.json();
}
const roles = await read("tenant_members", { select: "role,active", tenant_id: `eq.${input.tenant_id}`, user_id: `eq.${checker.user_id}` });
if (roles.length !== 1 || !roles[0].active || roles[0].role !== "tenant_admin") throw new Error("Current independent checker role differs");
const members = await read("tenant_group_members", { select: "group_id,user_id", group_id: `eq.${input.group_id}`, user_id: `eq.${input.actors.requester.user_id}` });
if (members.length !== 0) throw new Error("Revocation current membership readback differs");
const saved = JSON.parse(await readFile(path.join(own, "captures/PROD-UI-APPROVE-REVIEW-8dc638a4-aa18-4aaa-a9a5-a8828cc30167/proof.json"), "utf8"));
if (saved.status !== "FULL-ACTUAL-UI-WORKFLOW-PASS") throw new Error("Original completed proof missing");
const output = path.join(own, "captures", `PROD-SETTLED-AUDIT-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`);
await mkdir(output, { recursive: true });
const proof = { at: new Date().toISOString(), saved_status: saved.status, current_membership_count: members.length, real_aal2: true, current_role: roles[0].role, captures: [], status: "RUNNING" };
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
    const context = await browser.newContext({ storageState: checker.storage_state, viewport: { width: viewport.width, height: viewport.height } });
    // Copied state only; prevent this evidence context from refreshing shared token families.
    await context.route(/\/auth\/v1\/token(?:\?|$)/u, route => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.goto("https://app.reconiq.example/reconiq-assurance-lab-prod/tenant?page=governance", { waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "Governance views" }).waitFor({ timeout: 15000 });
    const finish = page.getByRole("button", { name: "Finish", exact: true });
    try { await finish.waitFor({ timeout: 5000 }); await finish.click(); } catch {}
    for (let n = 0; n < 4; n++) {
      const closes = page.locator(".driver-popover-close-btn");
      for (let i = (await closes.count()) - 1; i >= 0; i--) if (await closes.nth(i).isVisible().catch(() => false)) await closes.nth(i).click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      if (await page.locator(".driver-overlay").count() === 0) break;
    }
    if (await page.locator(".driver-overlay").count()) {
      await page.screenshot({ path: path.join(output, `${viewport.name}-tour-blocked.png`), fullPage: true });
      throw new Error("Guided-tour overlay remains after its normal Finish/Close/Escape controls");
    }
    await page.getByRole("button", { name: "Audit trail", exact: true }).click();
    await page.getByRole("heading", { name: "Audit trail", exact: true }).waitFor({ timeout: 15000 });
    await expect(page.locator("tbody tr")).toHaveCount(10, { timeout: 20000 });
    await expect(page.getByRole("button", { name: "Download CSV", exact: true })).toBeEnabled({ timeout: 15000 });
    const alerts = await page.getByRole("alert").allTextContents();
    if (alerts.length) throw new Error("Settled audit view reports an alert");
    const image = path.join(output, `${viewport.name}-audit-settled.png`);
    await page.screenshot({ path: image, fullPage: true });
    proof.captures.push({ viewport: viewport.name, image, rendered_rows: await page.locator("tbody tr").count(), alerts, export_enabled: true });
    await context.close();
  }
  proof.status = "SETTLED-AUDIT-READBACK-PASS";
} catch (error) { proof.status = "FAIL"; proof.failure = { name: error.name, message: error.message }; process.exitCode = 1; }
finally { await browser.close(); await writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2), { flag: "wx" }); }
console.log(JSON.stringify({ ...proof, output }));
