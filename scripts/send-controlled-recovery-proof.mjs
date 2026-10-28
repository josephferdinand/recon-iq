import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = {
  environment: flag("environment"),
  expectedRef: flag("expected-ref"),
  url: flag("url"),
  email: flag("email"),
  serviceKeyFile: flag("service-key-file"),
  hookSecretFile: flag("hook-secret-file"),
  redirectTo: flag("redirect-to"),
};

for (const [name, value] of Object.entries(config)) {
  if (!value) {
    throw new Error(
      `Missing required --${name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`,
    );
  }
}

const projectUrl = new URL(config.url);
if (
  projectUrl.protocol !== "https:" ||
  projectUrl.hostname !== `${config.expectedRef}.supabase.co`
) {
  throw new Error("Supabase URL does not match the expected project reference");
}

const serviceKey = (await readFile(config.serviceKeyFile, "utf8")).trim();
const storedHookSecret = (await readFile(config.hookSecretFile, "utf8")).trim();
const normalizedHookSecret = storedHookSecret.startsWith("v1,")
  ? storedHookSecret.slice(3)
  : storedHookSecret;
const encodedHookSecret = normalizedHookSecret.startsWith("whsec_")
  ? normalizedHookSecret.slice("whsec_".length)
  : normalizedHookSecret;
const signingKey = Buffer.from(encodedHookSecret, "base64");
if (!serviceKey || signingKey.length < 16) throw new Error("A protected credential is unavailable");

async function adminRequest(pathname, init = {}) {
  const response = await fetch(`${config.url}/auth/v1${pathname}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(`Auth Admin request failed with HTTP ${response.status}`);
  return body;
}

async function findOwnerUser() {
  const perPage = 10;
  for (let page = 1; page <= 100; page += 1) {
    const data = await adminRequest(`/admin/users?page=${page}&per_page=${perPage}`);
    const users = Array.isArray(data.users) ? data.users : [];
    const match = users.filter((user) => user.email === config.email);
    if (match.length > 1) throw new Error("More than one exact owner email match was returned");
    if (match.length === 1) return match[0];
    if (users.length < perPage) break;
  }
  throw new Error("The exact owner account was not found");
}

const owner = await findOwnerUser();
const recovery = await adminRequest("/admin/generate_link", {
  method: "POST",
  body: JSON.stringify({
    type: "recovery",
    email: config.email,
    redirect_to: config.redirectTo,
  }),
});
if (!recovery.hashed_token) throw new Error("Recovery generation returned no token hash");

const payload = JSON.stringify({
  user: {
    id: owner.id,
    email: owner.email,
    user_metadata: owner.user_metadata ?? {},
  },
  email_data: {
    token: recovery.email_otp ?? "",
    token_hash: recovery.hashed_token,
    redirect_to: config.redirectTo,
    email_action_type: "recovery",
    site_url: new URL(config.redirectTo).origin,
  },
});

const webhookId = `msg_${randomUUID()}`;
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = createHmac("sha256", signingKey)
  .update(`${webhookId}.${timestamp}.${payload}`)
  .digest("base64");

const response = await fetch(`${config.url}/functions/v1/send-email`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  },
  body: payload,
});
const result = await response.json().catch(() => ({}));
if (!response.ok || result?.ok !== true) {
  throw new Error(`Signed Send Email Hook proof failed with HTTP ${response.status}`);
}

console.log(
  JSON.stringify({
    ok: true,
    environment: config.environment,
    signedHookAccepted: true,
    deliveries: result.deliveries,
    providerMessageRecorded: Array.isArray(result.messageIds) && result.messageIds.length > 0,
  }),
);
