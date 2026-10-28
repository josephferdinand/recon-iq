import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { processOneAidpApiJob } from "@/lib/aidp-api-job-worker.server";

export const Route = createFileRoute("/api/public/cron/aidp-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronSecret(request, "AIDP_JOB_CRON_SECRET");
        if (unauthorized) return unauthorized;
        let jobId: string | undefined;
        try {
          const body = await request.json() as { job_id?: string };
          jobId = body.job_id;
        } catch { /* worker claims the oldest available job */ }
        const result = await processOneAidpApiJob(jobId);
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
