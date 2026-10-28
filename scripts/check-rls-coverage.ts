// CI gate: fail when any public-schema table is missing RLS or policies.
// Invoked by .github/workflows/ci.yml (rls-coverage job) and locally via
// `bun run check-rls`. Uses the service-role client to call the
// security-definer RPC `public.list_unprotected_tables`.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(2);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: unprotected, error } = await db.rpc("list_unprotected_tables");

if (error) {
  console.error("❌ Failed to query list_unprotected_tables:", error.message);
  process.exit(2);
}

if (!unprotected || unprotected.length === 0) {
  console.log("✅ All public-schema tables have RLS + policies.");
  process.exit(0);
}

console.error("❌ Unprotected tables:");
for (const t of unprotected as Array<{ schema: string; name: string }>) {
  console.error(`  - ${t.schema}.${t.name}`);
}
process.exit(1);
