import { getRuntimeEnv } from "@/lib/runtime-env.server";

export const PLATFORM_RUNTIME_SECRETS = [
  "APP_DATA_ENC_KEY",
  "AUDIT_SIGNING_KEY",
  "PLATFORM_ADMIN_SEED_EMAIL",
  "LLM_PLATFORM_ANTHROPIC_SEED",
  "FVI_AI_API_KEY",
  "SLA_CRON_HMAC",
] as const;

export type PlatformRuntimeSecretName = (typeof PLATFORM_RUNTIME_SECRETS)[number];

export function readPlatformSecretPresence(
  resolve: (name: string) => string | undefined = getRuntimeEnv,
): Array<{ name: PlatformRuntimeSecretName; configured: boolean }> {
  return PLATFORM_RUNTIME_SECRETS.map((name) => ({
    name,
    configured: Boolean(resolve(name)),
  }));
}
