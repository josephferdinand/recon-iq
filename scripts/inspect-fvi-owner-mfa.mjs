import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const statePath = process.env.FVI_OWNER_STORAGE_STATE ?? "";
const anonPath = process.env.FVI_PROD_ANON_KEY_FILE ?? "";
if (!path.isAbsolute(statePath) || !path.isAbsolute(anonPath))
  throw new Error("Set absolute FVI_OWNER_STORAGE_STATE and FVI_PROD_ANON_KEY_FILE paths");
const state = JSON.parse(await readFile(statePath, "utf8"));
const values = (state.origins ?? []).flatMap((origin) => origin.localStorage ?? []);
let session = null;
for (const item of values) {
  try {
    const parsed = JSON.parse(item.value);
    const candidate = parsed?.access_token ? parsed : parsed?.currentSession ?? null;
    if (candidate?.access_token && candidate?.refresh_token) {
      session = candidate;
      break;
    }
  } catch { /* not a session value */ }
}
if (!session) throw new Error("No Supabase session exists in the owner browser state");
const anon = (await readFile(anonPath, "utf8")).trim();
const client = createClient("https://YOUR_PROJECT_REF.supabase.co", anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const established = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
if (established.error) throw new Error("Owner session could not be established");
const factors = await client.auth.mfa.listFactors();
if (factors.error) throw new Error("MFA factors could not be read");
const aal = await client.auth.mfa.getAuthenticatorAssuranceLevel();
if (aal.error) throw new Error("Authenticator assurance level could not be read");
const all = factors.data?.all ?? [];
console.log(JSON.stringify({
  ok: true,
  factor_count: all.length,
  verified_factors: all.filter((factor) => factor.status === "verified").length,
  unverified_factors: all.filter((factor) => factor.status !== "verified").length,
  factor_types: [...new Set(all.map((factor) => factor.factor_type))],
  current_level: aal.data.currentLevel,
  next_level: aal.data.nextLevel,
  session_user_present: Boolean(established.data.user),
}));
