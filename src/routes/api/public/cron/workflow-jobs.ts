import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { processOneWorkflowApiJob } from "@/lib/workflow-api-job-worker.server";

export const Route = createFileRoute("/api/public/cron/workflow-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronSecret(request);
        if (unauthorized) return unauthorized;
        let requestedJobId: string | undefined;
        let maxJobs = 10;
        try {
          const body = await request.json() as { job_id?: string; max_jobs?: number };
          requestedJobId = body.job_id;
          maxJobs = Math.max(1, Math.min(20, Math.trunc(body.max_jobs ?? 10)));
        } catch { /* claim the oldest available jobs */ }

        const results = [];
        for (let index = 0; index < maxJobs; index += 1) {
          const result = await processOneWorkflowApiJob(index === 0 ? requestedJobId : undefined);
          if (!result.processed) break;
          results.push(result);
          if (requestedJobId) break;
        }
        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
