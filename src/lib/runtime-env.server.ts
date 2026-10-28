type WorkerEnv = Record<string, unknown>;

/**
 * Installs Cloudflare's immutable per-deployment string bindings before the
 * lazily imported TanStack/Nitro server graph evaluates. This preserves the
 * conventional `process.env.NAME` contract without compiling credentials
 * into the bundle. Resource bindings (R2, KV, and similar objects) remain on
 * `globalThis.__env` and are never coerced into strings.
 */
export function installRuntimeEnv(rawEnv: unknown): void {
  if (!rawEnv || typeof rawEnv !== "object") return;
  const env = rawEnv as WorkerEnv;
  (globalThis as unknown as { __env?: WorkerEnv }).__env = env;

  if (typeof process === "undefined" || !process.env) return;
  for (const [name, value] of Object.entries(env)) {
    if (/^[A-Z][A-Z0-9_]*$/.test(name) && typeof value === "string") {
      process.env[name] = value;
    }
  }
}

export function getRuntimeEnv(name: string): string | undefined {
  const bound = (globalThis as unknown as { __env?: WorkerEnv }).__env?.[name];
  if (typeof bound === "string" && bound.length > 0) return bound;
  const fallback = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return fallback || undefined;
}
