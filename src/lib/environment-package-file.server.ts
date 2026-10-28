import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeEnv } from "@/lib/runtime-env.server";

const MAX_PACKAGE_BYTES = 2_000_000;

function signingKey() {
  const value = getRuntimeEnv("ENVIRONMENT_PACKAGE_HMAC_KEY");
  if (!value || value.length < 43) throw new Error("Environment package signing key unavailable");
  return value;
}

async function hmacKey(usage: KeyUsage) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unhex(value: string) {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error("Package signature is invalid");
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (part) => Number.parseInt(part, 16));
}

export type EnvironmentPackageEnvelope = {
  schema_version: 1;
  payload: string;
  signature: string;
};

export async function signEnvironmentPackage(
  payload: unknown,
): Promise<EnvironmentPackageEnvelope> {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  if (encoded.length > MAX_PACKAGE_BYTES) throw new Error("Environment package exceeds 2 MB");
  const message = new TextEncoder().encode(`1.${encoded}`);
  const signature = await crypto.subtle.sign("HMAC", await hmacKey("sign"), message);
  return { schema_version: 1, payload: encoded, signature: hex(signature) };
}

export async function verifyEnvironmentPackage(envelope: EnvironmentPackageEnvelope) {
  if (envelope.schema_version !== 1 || envelope.payload.length > MAX_PACKAGE_BYTES) {
    throw new Error("Environment package format is unsupported");
  }
  const message = new TextEncoder().encode(`1.${envelope.payload}`);
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey("verify"),
    unhex(envelope.signature),
    message,
  );
  if (!valid) throw new Error("Environment package signature verification failed");
  const payload = JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  return payload;
}

export async function exportApprovedPackage(supabase: SupabaseClient, requestId: string) {
  const { data, error } = await supabase.rpc("export_approved_environment_change_for_transport", {
    _request_id: requestId,
  });
  if (error || !data) throw new Error(error?.message ?? "Approved package export failed");
  return signEnvironmentPackage(data);
}
