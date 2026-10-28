export type ProbeResult = { id: string; cell_key: string; function_key: string; checked_at: string;
  outcome: "healthy" | "degraded" | "outage" | "unknown"; latency_ms: number | null };
export type RegisteredStatusProbe = {
  cell_key: string; function_key: string; registered: boolean; enabled: boolean;
  kind: "functional" | "availability"; origin: string; path: string;
  allowedOrigins: readonly string[]; timeout_ms: number;
  /** A reviewed, read-only semantic assertion. HTTP 200 alone never supplies it. */
  assert?: (body: unknown) => "healthy" | "degraded" | "outage" | "unknown";
};

/** Parent-owned job supplies only registered targets and current authorized
 * headers. No credential, body, origin or diagnostics is persisted publicly. */
export async function runRegisteredStatusProbe(probe: RegisteredStatusProbe, dependencies: {
  fetch?: typeof fetch; authorize: () => Promise<HeadersInit>;
  record: (result: ProbeResult) => Promise<void>; now?: () => number;
}) {
  const now = dependencies.now ?? Date.now;
  if (!probe.registered || !probe.enabled) return { attempted: false, outcome: "unknown" as const };
  const origin = new URL(probe.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
    || !probe.allowedOrigins.includes(origin.origin) || !probe.path.startsWith("/api/") || probe.path.startsWith("//")
    || probe.path.includes("\\") || probe.timeout_ms < 500 || probe.timeout_ms > 15_000) throw new Error("Probe target is not a registered read-only API origin.");
  const target = new URL(probe.path, origin.origin);
  if (target.origin !== origin.origin || !target.pathname.startsWith("/api/")) throw new Error("Probe target origin or read-only API path changed.");
  const started = now(); let outcome: ProbeResult["outcome"] = "unknown";
  try {
    const headers = await dependencies.authorize();
    const response = await (dependencies.fetch ?? fetch)(target, { method: "GET", headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(probe.timeout_ms) });
    if ([401, 403, 404, 429].includes(response.status) || response.status >= 300 && response.status < 400) outcome = "unknown";
    else if (response.status >= 500) outcome = "outage";
    else if (response.ok && probe.kind === "availability") outcome = "healthy";
    else if (response.ok && probe.assert) {
      const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      if (!reader) throw new Error("Missing probe response.");
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65_536) { await reader.cancel(); throw new Error("Probe response limit."); } chunks.push(part.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const asserted = probe.assert(JSON.parse(new TextDecoder().decode(bytes)));
      outcome = ["healthy", "degraded", "outage", "unknown"].includes(asserted) ? asserted : "unknown";
    }
  } catch { outcome = "unknown"; }
  const result: ProbeResult = { id: crypto.randomUUID(), cell_key: probe.cell_key, function_key: probe.function_key,
    checked_at: new Date(now()).toISOString(), outcome, latency_ms: Math.max(0, Math.round(now() - started)) };
  // Instantaneous checks do not invent observed time windows or uptime.
  await dependencies.record(result);
  return { attempted: true, ...result };
}
