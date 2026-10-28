import { readFile } from "node:fs/promises";
import path from "node:path";

const DEV_REF = "YOUR_PROJECT_REF";
const serviceFile = process.env.FVI_DEV_SERVICE_ROLE_KEY_FILE ?? "";
if (!path.isAbsolute(serviceFile)) {
  throw new Error("FVI_DEV_SERVICE_ROLE_KEY_FILE must be an absolute protected file");
}
const serviceKey = (await readFile(serviceFile, "utf8")).trim();
if (serviceKey.length < 40) throw new Error("Protected DEV service key is unavailable");
const base = `https://${DEV_REF}.supabase.co/auth/v1`;

const health = await fetch(`${base}/health`);
const admin = await fetch(`${base}/admin/users?page=1&per_page=1`, {
  headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
});
const adminRaw = await admin.text();
let adminCode = "unavailable";
try {
  const parsed = JSON.parse(adminRaw);
  adminCode = String(
    parsed.code ?? parsed.error_code ?? parsed.msg ?? parsed.message ?? "response",
  ).slice(0, 120);
} catch {
  adminCode = adminRaw ? "non_json_response" : "empty_response";
}
console.log(
  JSON.stringify({
    ok: admin.ok,
    read_only: true,
    auth_health_status: health.status,
    admin_users_status: admin.status,
    admin_response_code: adminCode,
    credential_value_exposed: false,
  }),
);
if (!admin.ok) process.exit(1);
