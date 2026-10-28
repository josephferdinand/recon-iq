const DEV_REF = "YOUR_PROJECT_REF";
const url = process.env.SUPABASE_URL ?? "";

if (process.env.FVI_LIVE_TEST_TARGET !== "DEV") {
  throw new Error("Live tests require FVI_LIVE_TEST_TARGET=DEV");
}
if (process.env.FVI_ALLOW_LIVE_MUTATIONS !== "YES") {
  throw new Error("Live tests require FVI_ALLOW_LIVE_MUTATIONS=YES");
}
if (!url.includes(DEV_REF) || url.includes("YOUR_PROJECT_REF")) {
  throw new Error("Live tests are DEV-only; the configured Supabase URL is not fvi-dev");
}
for (const name of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[name]) throw new Error(`Live tests require ${name}`);
}

process.env.FVI_TEST_SUPABASE_URL = url;
process.env.FVI_TEST_SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
process.env.FVI_TEST_SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
