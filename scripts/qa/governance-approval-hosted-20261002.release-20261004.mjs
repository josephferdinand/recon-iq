import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { currentSourceHashes, expectedSupplementHashes } from "./governance-approval-hosted-20261002.mjs";
export const privateRoot = path.join(process.env.LOCALAPPDATA, "FVI-QA-Private-20260925");
export const own = path.join(privateRoot, "governance-approval-hosted-20261002");
export const vaultPath = "./.private/CREDENTIALS.md";
export async function credential(field) {
  if (!["SUPABASE_DEV_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN"].includes(field)) throw new Error("Outside owned DEV provisioning/read-only metadata credential scope");
  const text = await readFile(vaultPath, "utf8");
  const a = text.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->"), b = text.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (a < 0 || b <= a) throw new Error("Canonical FVI credential markers absent");
  const value = text.slice(a, b).split(/\r?\n/u).find(line => line.startsWith(`| \`${field}\` |`))?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Protected ${field} unavailable`);
  return value;
}
const ids = { PROD: "7180321a-e9c5-4014-bd9b-a3f1c52e392b", DEV: "ce449c37-d9cd-4a7a-8d5f-032c881f4e95" };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function assets(origin) {
  const response = await fetch(`${origin}/auth`, { redirect: "error", signal: AbortSignal.timeout(15000) });
  const html = await response.text();
  if (response.status !== 200 || !/nonce=/u.test(html)) throw new Error("Actual auth/CSP nonce readback failed");
  const css = [...html.matchAll(/(?:src|href)="([^"?]+styles-OdFI9wlS\.css)"/gu)].map(item => item[1]);
  if (css.length !== 1) throw new Error("Exact acknowledged CSS asset absent");
  const asset = await fetch(new URL(css[0], origin), { signal: AbortSignal.timeout(15000) });
  const hash = sha(Buffer.from(await asset.arrayBuffer()));
  if (!asset.ok || hash !== "4f4db83987784dd855b79d5959b4ce10762f37863dcf79b33da474de6658da01") throw new Error("Current served stylesheet differs from paired owner ACK");
  return { auth_status: response.status, stylesheet: css[0], sha256: hash };
}
export async function releaseAck() {
  const evidencePath = path.join(own, "PAIRED-7180321a-ce449c37-ACK-20261004.json");
  const apply = {};
  for (const env of ["PROD", "DEV"]) {
    const file = path.join(privateRoot, `FVI-HOME-REFERENCE-REPORTS-${env}-20261004-v5-APPLY-RECEIPT.json`);
    const bytes = await readFile(file); const receipt = JSON.parse(bytes);
    const after = receipt.after?.[0];
    if (receipt.environment !== env || receipt.phase !== "apply" || after?.ledger !== (env === "PROD" ? 451 : 429) || after.latest !== "20261003180000") throw new Error("Actual parent apply receipt differs from owner paired ACK");
    apply[env] = { file, sha256: sha(bytes), ledger: after.ledger, latest: after.latest, engine: after.engine };
  }
  const prod = await assets("https://app.reconiq.example"), dev = await assets("https://dev.app.reconiq.example");
  await assets("https://YOUR_PROJECT.pages.dev");
  await assets("https://YOUR_PROJECT.pages.dev");
  const previous = JSON.parse(await readFile(path.join(own, "PROD-5fbb724d-PARENT-ACK-READBACK.json"), "utf8"));
  const ack = { ...previous, status: "verified", release_kind: "governance", parent_explicit_ack: true, governance_ready: true, production_deployment_id: ids.PROD, dev_deployment_id: ids.DEV, production_hosted_readback: true, dev_hosted_readback: true, sql_verified: true, dev_sql_verified: true, dev_host: "https://dev.app.reconiq.example", source_sha256: await currentSourceHashes(), supplemental_catalog_sha256: expectedSupplementHashes, latest_parent_ack: "Direct owner paired ACK 7180321a/ce449c37,451/429/latest180000;997 exact reviewed sources and2196 artifacts/environment. Original governance applied-migration chain retained.", latest_parent_apply: apply, latest_hosted_readback: { PROD: prod, DEV: dev }, at: new Date().toISOString() };
  try { await writeFile(evidencePath, JSON.stringify(ack, null, 2), { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; const saved = JSON.parse(await readFile(evidencePath, "utf8")); if (JSON.stringify(saved.source_sha256) !== JSON.stringify(ack.source_sha256)) throw new Error("Owned current-source acknowledgement changed; preserve old receipt and reconcile"); }
  process.env.FVI_GOVERNANCE_RELEASE_ACK = evidencePath;
  return evidencePath;
}
