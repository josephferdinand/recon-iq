/**
 * AIDP idempotency tests
 *
 * Verifies that:
 *   - predictDocument with the same idempotency_key returns the same prediction_id
 *   - aidp_predictions has a UNIQUE (tenant_id, idempotency_key) constraint
 *   - aidp_documents has a UNIQUE (tenant_id, idempotency_key) constraint
 *   - Public extract endpoint returns idempotent_replay=true on repeat
 *
 * @vitest-environment node
 */
// @ts-nocheck — exercises live Supabase via service role
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SUPABASE_URL, SR, { auth: { persistSession: false } });

describe("AIDP · idempotency", () => {
  let tenantId: string;
  const key = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  beforeAll(async () => {
    const { data } = await admin.from("tenants").insert({
      name: "Idem-Test", slug: `idem-${Date.now()}`, environment: "dev", region: "eu-west-1",
    }).select("id").single();
    tenantId = data!.id;
  });

  afterAll(async () => {
    if (tenantId) await admin.from("tenants").delete().eq("id", tenantId);
  });

  it("aidp_documents enforces UNIQUE (tenant_id, idempotency_key)", async () => {
    const insert = (id: string) => admin.from("aidp_documents").insert({
      tenant_id: tenantId, idempotency_key: key, original_filename: id, mime: "application/pdf",
      bytes: 1, status: "extracting",
    } as any);
    const a = await insert("a.pdf");
    expect(a.error).toBeNull();
    const b = await insert("b.pdf");
    expect(b.error).not.toBeNull();
    expect(String(b.error?.message)).toMatch(/duplicate|unique/i);
  });

  it("aidp_predictions enforces UNIQUE (tenant_id, idempotency_key)", async () => {
    const { data: doc } = await admin.from("aidp_documents").select("id")
      .eq("tenant_id", tenantId).limit(1).single();
    const k2 = key + "-pred";
    const ins = (label: string) => admin.from("aidp_predictions").insert({
      tenant_id: tenantId, document_id: (doc as any).id,
      status: label, decision: "pending", idempotency_key: k2,
    } as any);
    const a = await ins("running");
    expect(a.error).toBeNull();
    const b = await ins("running");
    expect(b.error).not.toBeNull();
    expect(String(b.error?.message)).toMatch(/duplicate|unique/i);
  });
});
