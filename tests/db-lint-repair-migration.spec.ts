import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const migration = new URL(
  "../supabase/migrations/20260905103000_fix_live_function_lint_errors.sql",
  import.meta.url,
);
const roleMigration = new URL(
  "../supabase/migrations/20260905104500_fix_security_alert_tenant_role.sql",
  import.meta.url,
);
const aliasMigration = new URL(
  "../supabase/migrations/20260905110000_fix_security_alert_rule_alias.sql",
  import.meta.url,
);
const extensionMigration = new URL(
  "../supabase/migrations/20260905111500_enable_plpgsql_check.sql",
  import.meta.url,
);

describe("live database lint repair migration", () => {
  it("covers every reported function and guards every rewrite", async () => {
    const sql = await readFile(migration, "utf8");
    const functions = [
      "simulate_cascade_policy",
      "list_allowed_signoff_transitions",
      "engage_ai_kill_switch",
      "release_ai_kill_switch",
      "assert_tenant_access",
      "mkt_book_appointment",
      "hash_sandbox_client_secret",
      "verify_sandbox_client_secret",
      "evaluate_security_alerts",
      "tdv_issue_token",
      "aidp_purge_stale_pages",
      "webhook_outbox_replay",
      "set_tenant_sandbox",
    ];
    for (const name of functions) expect(sql).toContain(`public.${name}`);
    expect(sql.match(/repair anchor/g)?.length).toBeGreaterThanOrEqual(functions.length);
    expect(sql).toContain("extensions.gen_random_bytes");
    expect(sql).toContain("extensions.gen_salt");
    expect(sql).toContain("extensions.crypt");
    expect(sql).toContain("actor_user_id");
    expect(sql).toContain("security_events.tenant_id");
  });

  it("removes the nonexistent tenant_owner enum from alert notifications", async () => {
    const sql = await readFile(roleMigration, "utf8");
    expect(sql).toContain("tenant_admin''::public.tenant_role");
    expect(sql).toContain("tenant-role repair anchor missing");
  });

  it("separates the security alert SQL alias from the PL/pgSQL record", async () => {
    const sql = await readFile(aliasMigration, "utf8");
    expect(sql).toContain("public.security_alert_rules alert_rule");
    expect(sql).toContain("alert_rule.event_type_pattern");
    expect(sql).toContain("rule-alias repair anchor missing");
  });

  it("keeps direct primary-database lint reproducible", async () => {
    const sql = await readFile(extensionMigration, "utf8");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS plpgsql_check WITH SCHEMA extensions");
  });
});
