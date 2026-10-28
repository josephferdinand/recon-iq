export async function runAidpSchedulerBatch(env: Env, fetchImpl: typeof fetch = fetch) {
  const batchSize = Math.min(10, Math.max(1, Number(env.BATCH_SIZE) || 1));
  const cronSecret = Reflect.get(env, "AIDP_JOB_CRON_SECRET");
  if (typeof cronSecret !== "string" || cronSecret.length < 32) {
    throw new Error("AIDP scheduler secret is unavailable");
  }
  let processed = 0;
  for (let index = 0; index < batchSize; index += 1) {
    const response = await fetchImpl(`${env.FVI_APP_URL}/api/public/cron/aidp-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": cronSecret },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`AIDP scheduler upstream failed with HTTP ${response.status}`);
    const result = await response.json() as { processed?: boolean };
    if (!result.processed) break;
    processed += 1;
  }
  console.log(JSON.stringify({ event: "aidp.scheduler.completed", processed }));
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAidpSchedulerBatch(env));
  },
} satisfies ExportedHandler<Env>;
