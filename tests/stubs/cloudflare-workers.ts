export const env =
  (globalThis as unknown as { __env?: Record<string, unknown> }).__env ?? {};
