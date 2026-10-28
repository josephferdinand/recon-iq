import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

describe("Vault RLS isolation", () => {
  if (!url || !anon) {
    it.skip("env not set; skipping RLS tests", () => {});
    return;
  }
  const sb = createClient(url, anon);

  it("anonymous cannot read platform vault secrets", async () => {
    const { data, error } = await sb.from("app_vault_secrets").select("id").eq("scope", "platform").limit(1);
    // RLS should deny or return empty (never leak).
    expect(error || (data ?? []).length === 0).toBeTruthy();
  });

  it("anonymous cannot insert vault secret", async () => {
    const { error } = await sb.from("app_vault_secrets").insert({
      scope: "platform", secret_class: "generic", name: "x",
      ciphertext: "\\x00", iv: "\\x00", auth_tag: "\\x00", wrapped_dek: "\\x00",
      kek_provider: "meta_managed", kek_ref: "APP_DATA_ENC_KEY", fingerprint_sha256: "0".repeat(64),
    } as any);
    expect(error).toBeTruthy();
  });

  it("anonymous cannot read KMS bindings", async () => {
    const { data, error } = await sb.from("app_vault_kms_bindings").select("id").limit(1);
    expect(error || (data ?? []).length === 0).toBeTruthy();
  });
});
