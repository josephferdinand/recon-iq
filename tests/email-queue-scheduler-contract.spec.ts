import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import scheduler from "../workers/email-queue-scheduler/src/index";

type ScheduledParameters = Parameters<typeof scheduler.scheduled>;

function invokeSchedule(cron: string): Promise<unknown> {
  let pending: Promise<unknown> | undefined;
  const controller: ScheduledParameters[0] = {
    cron,
    scheduledTime: 0,
    noRetry: vi.fn(),
  };
  const context = {
    waitUntil(promise: Promise<unknown>) {
      pending = promise;
    },
  } as ScheduledParameters[2];

  void scheduler.scheduled(controller, { SLA_CRON_HMAC: "test-secret" }, context);
  if (!pending) throw new Error("scheduled handler did not register work with waitUntil");
  return pending;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("control-plane scheduler", () => {
  it("routes one-minute recon and five-minute email ticks through one encrypted binding", async () => {
    const [config, worker] = await Promise.all([
      readFile("workers/email-queue-scheduler/wrangler.jsonc", "utf8"),
      readFile("workers/email-queue-scheduler/src/index.ts", "utf8"),
    ]);
    expect(config).toContain('"* * * * *"');
    expect(config).toContain('"*/5 * * * *"');
    expect(config).toContain('"observability"');
    expect(worker).toContain("ctx.waitUntil(runSchedule(controller.cron, env))");
    expect(worker).toContain('Reflect.get(env, "SLA_CRON_HMAC")');
    expect(worker).toContain("https://app.reconiq.example/api/public/cron/email-queue");
    expect(worker).toContain("https://dev.app.reconiq.example/api/public/cron/email-queue");
    expect(worker).toContain("https://app.reconiq.example/api/public/cron/recon-orchestrator");
    expect(worker).toContain(
      "https://dev.app.reconiq.example/api/public/cron/recon-orchestrator",
    );
    expect(worker).toContain("https://app.reconiq.example/api/public/cron/workflow-jobs");
    expect(worker).not.toContain("https://dev.app.reconiq.example/api/public/cron/workflow-jobs");
    expect(worker).not.toMatch(/x-cron-secret["']?\s*:\s*["'][A-Za-z0-9_-]{20,}/u);
  });

  it("dispatches the two existing recon targets and the PROD workflow target each minute", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return Response.json({ ok: true });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(invokeSchedule("* * * * *")).resolves.toBeUndefined();

    expect(urls).toEqual(
      expect.arrayContaining([
        "https://app.reconiq.example/api/public/cron/recon-orchestrator",
        "https://dev.app.reconiq.example/api/public/cron/recon-orchestrator",
        "https://app.reconiq.example/api/public/cron/workflow-jobs",
      ]),
    );
    expect(urls).toHaveLength(3);
    expect(urls).not.toContain("https://dev.app.reconiq.example/api/public/cron/workflow-jobs");
  });

  it("keeps the five-minute schedule email-only", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return Response.json({ ok: true });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(invokeSchedule("*/5 * * * *")).resolves.toBeUndefined();

    expect(urls).toEqual([
      "https://app.reconiq.example/api/public/cron/email-queue",
      "https://dev.app.reconiq.example/api/public/cron/email-queue",
    ]);
  });

  it("awaits every minute branch and reports only sanitized event labels when one fails", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        return url === "https://dev.app.reconiq.example/api/public/cron/recon-orchestrator"
          ? new Response(null, { status: 503 })
          : Response.json({ ok: true });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(invokeSchedule("* * * * *")).rejects.toThrow("recon_orchestrator_tick");

    expect(urls).toHaveLength(3);
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).toContain("scheduler_dispatch_failed");
    expect(logged).toContain("recon_orchestrator_tick");
    expect(logged).not.toContain("https://");
    expect(logged).not.toContain("test-secret");
  });

  it.each([{ ok: false }, { ok: "true" }, null])(
    "makes a malformed or failing workflow body %j observable",
    async (body) => {
      const urls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          urls.push(url);
          return Response.json(url.endsWith("/workflow-jobs") ? body : { ok: true });
        }),
      );
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await expect(invokeSchedule("* * * * *")).rejects.toThrow("workflow_jobs_tick");
      expect(urls).toHaveLength(3);
    },
  );
});
