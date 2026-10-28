import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.FVI_E2E_BASE_URL ?? "").replace(/\/+$/u, "");
const tokenFile = path.resolve(process.env.FVI_AIDP_TOKEN_FILE ?? "");
const fileUrl = process.env.FVI_AIDP_FILE_URL ?? "";
const idempotencyKey = process.env.FVI_AIDP_IDEMPOTENCY_KEY ?? "";
if (!baseUrl || !fileUrl || !idempotencyKey || !path.isAbsolute(tokenFile)) {
  throw new Error("Set base URL, token file, file URL, and idempotency key");
}
if (!new URL(fileUrl).hostname.endsWith("reconiq.example")) throw new Error("Fixture URL must be FVI-owned");
const token = (await readFile(tokenFile, "utf8")).match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
if (!token) throw new Error("AIDP token file is malformed");
const headers = { "x-aidp-token": token, "content-type": "application/json", "idempotency-key": idempotencyKey };
const enqueue = await fetch(`${baseUrl}/api/public/aidp/extract`, {
  method: "POST",
  headers,
  body: JSON.stringify({ document_type_code: "assurance_bank_statement", file_url: fileUrl }),
});
const accepted = await enqueue.json();
if (![200, 202].includes(enqueue.status) || !accepted.job_id) {
  throw new Error(`AIDP enqueue failed with HTTP ${enqueue.status}`);
}
const jobId = accepted.job_id;
let terminal = accepted;
let lastStatus = String(terminal.status ?? "unknown");
console.log(JSON.stringify({ event: "aidp_job_accepted", job_id: jobId, status: lastStatus }));
for (let attempt = 0; attempt < 120 && !["succeeded", "failed", "dead"].includes(terminal.status); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const poll = await fetch(`${baseUrl}/api/public/aidp/jobs/${jobId}`, { headers: { "x-aidp-token": token } });
  if (!poll.ok) throw new Error(`AIDP poll failed with HTTP ${poll.status}`);
  terminal = await poll.json();
  const currentStatus = String(terminal.status ?? "unknown");
  if (currentStatus !== lastStatus || attempt % 6 === 5) {
    console.log(JSON.stringify({ event: "aidp_job_progress", job_id: jobId, status: currentStatus, attempts: terminal.attempts ?? 0 }));
    lastStatus = currentStatus;
  }
}
if (terminal.status !== "succeeded") throw new Error(`AIDP job ended in ${terminal.status ?? "non-terminal state"}`);
const fields = Array.isArray(terminal.fields) ? terminal.fields : [];
const keys = new Set(fields.map((field) => field.key));
const expected = ["account_id", "currency", "period_start", "period_end", "opening_balance", "closing_balance", "total_debits", "total_credits", "transaction_count"];
if (fields.length !== 9 || expected.some((key) => !keys.has(key))) throw new Error("AIDP field coverage failed");
const account = fields.find((field) => field.key === "account_id")?.value;
if (account !== "FVI-VALIDATION-001") throw new Error("AIDP account field accuracy failed");
const replay = await fetch(`${baseUrl}/api/public/aidp/extract`, {
  method: "POST", headers, body: JSON.stringify({ document_type_code: "assurance_bank_statement", file_url: fileUrl }),
});
if (replay.status !== 200 || replay.headers.get("idempotent-replay") !== "true") {
  throw new Error("AIDP idempotent replay failed");
}
console.log(JSON.stringify({
  ok: true,
  job_id: jobId,
  document_id: terminal.document_id,
  prediction_id: terminal.prediction_id,
  status: terminal.status,
  attempts: terminal.attempts,
  fields: fields.length,
  account_exact: true,
  idempotent_replay: true,
}));
