// C1 — Read-side aggregation for the monitoring dashboard.
//
// The Cloudflare Analytics Engine SQL API is queried with an account-scoped
// API token. In dev/CI (no token), we return an empty shape so the UI
// renders without errors.

import { createFileRoute } from "@tanstack/react-router";

type SummaryRow = {
  bucket: string;
  count: number;
  avg_duration_ms: number;
  error_rate: number;
};

type Summary = {
  ai_calls_24h: SummaryRow[];
  cron_executions_24h: SummaryRow[];
  source: "analytics_engine" | "empty";
};

async function querySQL(sql: string): Promise<Array<Record<string, unknown>>> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_ANALYTICS_TOKEN;
  if (!accountId || !token) return [];
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: sql,
    },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  return json.data ?? [];
}

export const Route = createFileRoute("/api/public/metrics-summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Require an authenticated Supabase session; this endpoint exposes
        // internal operational telemetry and must not be world-readable.
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
        if (!token) return new Response("Unauthorized", { status: 401 });
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data: userRes, error: uErr } = await sb.auth.getUser(token);
        if (uErr || !userRes?.user) return new Response("Unauthorized", { status: 401 });

        const accountId = process.env.CF_ACCOUNT_ID;
        if (!accountId || !process.env.CF_ANALYTICS_TOKEN) {
          const empty: Summary = {
            ai_calls_24h: [],
            cron_executions_24h: [],
            source: "empty",
          };
          return Response.json(empty);
        }
        const ai = await querySQL(`
          SELECT blob3 AS bucket, count() AS count,
                 quantileWeighted(0.5)(double1, 1) AS avg_duration_ms,
                 sumIf(1, blob4 = 'error') / count() AS error_rate
          FROM fvi_prod
          WHERE blob1 = 'ai.call' AND timestamp > now() - INTERVAL '1' DAY
          GROUP BY bucket ORDER BY count DESC LIMIT 20
        `);
        const cron = await querySQL(`
          SELECT blob2 AS bucket, count() AS count,
                 avg(double1) AS avg_duration_ms,
                 sumIf(1, blob3 = 'error') / count() AS error_rate
          FROM fvi_prod
          WHERE blob1 = 'cron.execution' AND timestamp > now() - INTERVAL '1' DAY
          GROUP BY bucket ORDER BY count DESC LIMIT 20
        `);
        const out: Summary = {
          ai_calls_24h: ai as unknown as SummaryRow[],
          cron_executions_24h: cron as unknown as SummaryRow[],
          source: "analytics_engine",
        };
        return Response.json(out);
      },
    },
  },
});
