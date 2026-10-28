import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.FVI_AIDP_DOCUMENT_SERVICE_URL ?? "").replace(/\/+$/u, "");
const pdfPath = path.resolve(process.env.FVI_AIDP_DOCUMENT_PDF ?? "");
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(baseUrl) && !baseUrl.endsWith(".workers.dev")) {
  throw new Error("Document service URL must be local or an exact workers.dev host");
}
const checks = [];
const health = await fetch(`${baseUrl}/health`);
checks.push({ name: "health", passed: health.status === 200, status: health.status });
const wrongType = await fetch(`${baseUrl}/v1/pdf/text`, { method: "POST", headers: { "content-type": "text/plain" }, body: "not-pdf" });
checks.push({ name: "content_type", passed: wrongType.status === 415, status: wrongType.status });
const empty = await fetch(`${baseUrl}/v1/pdf/text`, { method: "POST", headers: { "content-type": "application/pdf" }, body: new Uint8Array() });
checks.push({ name: "empty", passed: empty.status === 400, status: empty.status });
const pdf = await readFile(pdfPath);
const extract = await fetch(`${baseUrl}/v1/pdf/text`, { method: "POST", headers: { "content-type": "application/pdf" }, body: pdf });
const payload = await extract.json();
checks.push({
  name: "two_page_financial_statement",
  passed: extract.status === 200 && payload.pageCount === 2
    && typeof payload.text === "string"
    && ["[Page 1]", "[Page 2]", "FVI-VALIDATION-001", "132,425.00", "Transaction count"].every((value) => payload.text.includes(value)),
  status: extract.status,
});
for (const check of checks) console.log(`${check.passed ? "PASS" : "FAIL"} ${check.name} HTTP ${check.status}`);
if (checks.some((check) => !check.passed)) process.exitCode = 1;
