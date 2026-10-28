// Server-only helper to safely look up an environment-variable value by a
// user-controlled name. Prevents secret exfiltration of unrelated env vars
// (e.g. SUPABASE_SERVICE_ROLE_KEY) when a tenant analyst stores an
// `auth_secret_ref` or `key_secret_name` referring to anything they like.
//
// Allow-listed prefixes are the only names ever returned. All others resolve
// to `undefined`, even if the variable exists in the process environment.

const ALLOWED_PREFIXES = [
  "FVI_TENANT_",     // canonical: FVI_TENANT_<tenant_slug>_<purpose>
  "FVI_LLM_",        // BYO-LLM keys, e.g. FVI_LLM_MUSE_PRIMARY
  "FVI_CONNECTOR_",  // outbound connector credentials
  "FVI_API_",        // generic API tokens for rekon wizard inline sources
  "FVI_DB_",         // database connection secrets
];

const ALLOWED_EXACT = new Set<string>([
  // Provider-default keys that the platform itself owns.
  "FVI_AI_API_KEY",
  "META_API_KEY", // legacy alias; still readable during migration
  "MUSE_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
]);

const NAME_RE = /^[A-Z][A-Z0-9_]{2,127}$/;

export function readSafeEnv(name: string | null | undefined): string | undefined {
  if (!name || typeof name !== "string") return undefined;
  if (!NAME_RE.test(name)) return undefined;
  if (ALLOWED_EXACT.has(name)) return process.env[name];
  if (ALLOWED_PREFIXES.some((p) => name.startsWith(p))) return process.env[name];
  return undefined;
}

export function isSafeEnvName(name: string | null | undefined): boolean {
  if (!name || typeof name !== "string") return false;
  if (!NAME_RE.test(name)) return false;
  if (ALLOWED_EXACT.has(name)) return true;
  return ALLOWED_PREFIXES.some((p) => name.startsWith(p));
}
