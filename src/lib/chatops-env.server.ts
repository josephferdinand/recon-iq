// S-6 — Module-load env-var validation for chat-ops endpoints.
//
// In production, missing secrets must hard-fail at module load to keep
// the endpoint from silently accepting traffic with reduced security
// guarantees. In dev, we log a warning instead so local builds don't
// crash on a fresh checkout.
//
// Exported as a pure function so tests can exercise both paths without
// mutating real process.env beyond the test scope.

export type ChatOpsEnvName = "INBOUND_EMAIL_SECRET" | "SLACK_SIGNING_SECRET";

export function assertChatopsEnv(
  name: ChatOpsEnvName,
  value: string | undefined,
  nodeEnv: string | undefined,
  logger: { warn: (msg: string) => void } = console,
): void {
  if (value && value.length > 0) return;
  if (nodeEnv === "production") {
    throw new Error(
      `[chatops] required env var ${name} is missing in production — refusing to load module.`,
    );
  }
  logger.warn(
    `[chatops] env var ${name} is not set; chat-ops endpoint will reject all traffic in dev until set.`,
  );
}
