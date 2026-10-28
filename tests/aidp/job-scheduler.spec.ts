import { describe, expect, it, vi } from "vitest";

import { runAidpSchedulerBatch } from "../../workers/aidp-job-scheduler/src/index";

describe("AIDP job scheduler", () => {
  it("processes a bounded batch and stops when the queue is empty", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ processed: true }))
      .mockResolvedValueOnce(Response.json({ processed: true }))
      .mockResolvedValueOnce(Response.json({ processed: false }));
    await runAidpSchedulerBatch({
      FVI_APP_URL: "https://app.reconiq.example",
      BATCH_SIZE: "5",
      AIDP_JOB_CRON_SECRET: "assurance-only-secret-with-32-characters",
    }, fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith(
      "https://app.reconiq.example/api/public/cron/aidp-jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-cron-secret": "assurance-only-secret-with-32-characters" }),
      }),
    );
  });

  it("fails closed for a missing secret or an upstream error", async () => {
    await expect(runAidpSchedulerBatch({
      FVI_APP_URL: "https://app.reconiq.example",
      BATCH_SIZE: "1",
    }, vi.fn())).rejects.toThrow("secret is unavailable");
    await expect(runAidpSchedulerBatch({
      FVI_APP_URL: "https://app.reconiq.example",
      BATCH_SIZE: "1",
      AIDP_JOB_CRON_SECRET: "assurance-only-secret-with-32-characters",
    }, vi.fn(async () => new Response("unauthorized", { status: 401 })))).rejects.toThrow("HTTP 401");
  });
});
