const emailTargets = [
  "https://app.reconiq.example/api/public/cron/email-queue",
  "https://dev.app.reconiq.example/api/public/cron/email-queue",
];

const reconTargets = [
  "https://app.reconiq.example/api/public/cron/recon-orchestrator",
  "https://dev.app.reconiq.example/api/public/cron/recon-orchestrator",
];

const workflowTargets = ["https://app.reconiq.example/api/public/cron/workflow-jobs"];

type DispatchEvent = "email_queue_drain" | "recon_orchestrator_tick" | "workflow_jobs_tick";

function cronSecret(env: Env): string {
  const cronSecret: unknown = Reflect.get(env, "SLA_CRON_HMAC");
  if (typeof cronSecret !== "string" || !cronSecret) {
    throw new Error("SLA_CRON_HMAC binding is unavailable");
  }
  return cronSecret;
}

async function dispatch(
  event: DispatchEvent,
  targets: string[],
  env: Env,
  requireOkBody: boolean,
): Promise<void> {
  const secret = cronSecret(env);
  const outcomes = await Promise.allSettled(
    targets.map(async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "x-cron-secret": secret },
      });
      if (!response.ok) throw new Error(`scheduled endpoint returned HTTP ${response.status}`);
      if (requireOkBody) {
        const result = await response.json<unknown>();
        if (
          typeof result !== "object" ||
          result === null ||
          !("ok" in result) ||
          result.ok !== true
        ) {
          throw new Error("scheduled endpoint reported failure");
        }
      }
      return new URL(url).hostname;
    }),
  );
  const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
  console.log(JSON.stringify({ event, targets: targets.length, failed }));
  if (failed) throw new Error(`${failed} ${event} target(s) failed`);
}

async function dispatchAll(
  branches: { event: DispatchEvent; targets: string[]; requireOkBody: boolean }[],
  env: Env,
): Promise<void> {
  const outcomes = await Promise.allSettled(
    branches.map((branch) => dispatch(branch.event, branch.targets, env, branch.requireOkBody)),
  );
  const failedEvents = outcomes.flatMap((outcome, index) =>
    outcome.status === "rejected" ? [branches[index].event] : [],
  );
  if (failedEvents.length) {
    console.error(
      JSON.stringify({ event: "scheduler_dispatch_failed", failed_events: failedEvents }),
    );
    throw new Error(`scheduled dispatch failed: ${failedEvents.join(", ")}`);
  }
}

async function runSchedule(cron: string, env: Env): Promise<void> {
  if (cron === "* * * * *") {
    await dispatchAll(
      [
        { event: "recon_orchestrator_tick", targets: reconTargets, requireOkBody: false },
        { event: "workflow_jobs_tick", targets: workflowTargets, requireOkBody: true },
      ],
      env,
    );
    return;
  }
  if (cron === "*/5 * * * *") {
    await dispatch("email_queue_drain", emailTargets, env, true);
    return;
  }
  console.log(JSON.stringify({ event: "scheduler_unknown_cron", cron }));
}

export default {
  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(runSchedule(controller.cron, env));
  },
  async fetch(): Promise<Response> {
    return Response.json({
      service: "fvi-control-plane-scheduler",
      status: "healthy",
      schedules: [
        "recon_orchestrator_each_minute",
        "workflow_jobs_each_minute_prod",
        "email_queue_each_five_minutes",
      ],
    });
  },
} satisfies ExportedHandler<Env>;
