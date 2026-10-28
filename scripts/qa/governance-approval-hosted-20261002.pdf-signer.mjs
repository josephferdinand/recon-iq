// Read-only purpose-handler proof. Never persist or follow a signed capability.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toJSONAsync, fromCrossJSON } from "seroval";
import { defaultSerovalPlugins } from "@tanstack/router-core";
import { actorSession } from "./governance-approval-hosted-20261002.mjs";

const root = path.join(process.env.LOCALAPPDATA, "FVI-QA-Private-20260925");
const own = path.join(root, "governance-approval-hosted-20261002");
const transport = JSON.parse(await readFile(path.join(root, "FVI-QA-TRANSPORT-PROD-20261001.json"), "utf8"));
if (transport.projectRef !== "YOUR_PROJECT_REF" || new URL(transport.apiUrl).protocol !== "https:") throw new Error("Wrong PROD public transport");
const readyPath = path.resolve(process.env.FVI_GOVERNANCE_SESSION_READINESS_FILE ?? "");
if (!readyPath.toLowerCase().startsWith(`${own}${path.sep}`.toLowerCase())) throw new Error("Owned private readiness file required");
const readiness = JSON.parse(await readFile(readyPath, "utf8"));
const actor = readiness.actors.find(item => item.kind === "requester" && item.user_id === "86655159-7270-4635-a0f0-e3a627ad49fc" && item.real_aal2);
if (!actor) throw new Error("Actual authorized ordinary actor missing");
const { token } = await actorSession(actor, transport.apiUrl);
const headers = { apikey: transport.anonKey, Authorization: `Bearer ${token}` };
const tenant = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const userResponse = await fetch(`${transport.apiUrl}/auth/v1/user`, { headers, signal: AbortSignal.timeout(15000) });
const user = await userResponse.json();
if (!userResponse.ok || user.id !== actor.user_id) throw new Error("Actual caller identity refused");
const roleResponse = await fetch(`${transport.apiUrl}/rest/v1/tenant_members?${new URLSearchParams({ select: "role,active", tenant_id: `eq.${tenant}`, user_id: `eq.${actor.user_id}` })}`, { headers, signal: AbortSignal.timeout(15000) });
const roles = await roleResponse.json();
if (!roleResponse.ok || roles.length !== 1 || !roles[0].active || roles[0].role !== "tenant_analyst") throw new Error("Current ordinary tenant role differs");

const handler = "f622492c34907ca65f0e7f6c6b5d7ebd8c6cf9a9368f3a947a30678b190d511a";
const unicodePath = `${tenant}/ce0b5936-21be-4dbd-852d-cf70b5241cdf/source.pdf`;
const cases = [
  { name: "owned Unicode source read", tenant_id: tenant, path: unicodePath },
  { name: "retained source read", tenant_id: tenant, path: `${tenant}/e693b70e-9aaa-42e5-b639-df6142726124/source.pdf` },
  { name: "wrong tenant prefix refusal", tenant_id: "00000000-0000-4000-8000-000000000001", path: unicodePath },
];
function classify(error) {
  const message = String(error?.message ?? error ?? "");
  if (/Path must be scoped to the tenant id/u.test(message)) return "Path must be scoped to the tenant id";
  if (/Object not found/iu.test(message)) return "Object not found";
  if (/row.level.security|permission denied|forbidden|not authorized/iu.test(message)) return "Authorization refused";
  if (/unauthorized|token expired/iu.test(message)) return "Authentication refused";
  if (/timeout|transport failed/iu.test(message)) return "Transport failed";
  return "Unclassified serialized error; no raw response persisted";
}
const results = [];
for (const item of cases) {
  const result = { name: item.name, handler, mode: "read", expires_in: 900 };
  const start = Date.now();
  try {
    // Match the installed native serverFnFetcher serialization without its
    // browser/server startup-context dependency in this terminal-only probe.
    const body = JSON.stringify(await toJSONAsync({ data: { tenant_id: item.tenant_id, path: item.path, mode: "read", expires_in: 900 } }, { plugins: defaultSerovalPlugins }));
    const response = await fetch(`https://app.reconiq.example/_serverFn/${handler}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "x-tsr-serverFn": "true", "Content-Type": "application/json", Accept: "application/json" }, body, signal: AbortSignal.timeout(20000), redirect: "error" });
    result.http = response.status;
    result.serialized_by_start = response.headers.has("x-tss-serialized");
    const json = await response.json();
    const value = result.serialized_by_start ? fromCrossJSON(json, { plugins: defaultSerovalPlugins }) : json;
    if (value instanceof Error) throw value;
    const payload = value?.result ?? value;
    if (value?.error) { result.signed_capability_returned = false; result.error = classify(value.error); }
    else { result.signed_capability_returned = typeof payload?.signed_url === "string"; result.result_shape = result.signed_capability_returned ? "signed capability withheld" : "unexpected result shape"; }
  } catch (error) { result.signed_capability_returned = false; result.error = classify(error); }
  result.elapsed_ms = Date.now() - start;
  results.push(result);
}
const evidence = path.join(own, `PDF-ORDINARY-ACTUAL-SIGNER-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.json`);
const proof = { at: new Date().toISOString(), actor_user_id: actor.user_id, real_aal2: true, current_role: roles[0].role, results, scope: "Actual compiled caller handler, normal current Auth/MFA. Read mode only; no new grants, upload/render, signed URL persistence or content fetch. Wrong-prefix refusal does not prove an aligned foreign-tenant storage policy." };
await writeFile(evidence, JSON.stringify(proof, null, 2), { flag: "wx" });
console.log(JSON.stringify({ ...proof, evidence }));
