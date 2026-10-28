import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const enabled = process.env.FVI_RUN_COPILOT_RAG === "YES";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";
const supabaseUrl = process.env.FVI_TEST_SUPABASE_URL ?? "";
const publishableKey = process.env.FVI_TEST_SUPABASE_ANON_KEY ?? "";
const storageStatePath = process.env.FVI_OWNER_STORAGE_STATE ?? "";

test.use({ trace: "off", screenshot: "off", video: "off" });

function sessionFromStorageState() {
  const state = JSON.parse(readFileSync(storageStatePath, "utf8"));
  const origin = state.origins?.find(
    (entry: { origin?: string }) => entry.origin === "https://app.reconiq.example",
  );
  const stored = origin?.localStorage?.find((entry: { name?: string }) =>
    entry.name?.endsWith("-auth-token"),
  );
  if (!stored?.value) throw new Error("PROD owner storage state has no Supabase session");
  return JSON.parse(stored.value);
}

function decodeUiMessageStream(body: string): string {
  const deltas: string[] = [];
  for (const line of body.split(/\r?\n/u)) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const event = JSON.parse(raw);
      if (event.type === "text-delta" && typeof event.delta === "string") {
        deltas.push(event.delta);
      }
      if (event.type === "error")
        throw new Error(String(event.errorText ?? "Copilot stream error"));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return deltas.join("");
}

test("tenant Copilot answers from RAG and records priced usage", async ({ request }) => {
  test.skip(
    !enabled || !tenantId || !supabaseUrl || !publishableKey || !storageStatePath,
    "Requires the PROD Assurance Lab, QA session, and publishable Supabase configuration",
  );
  const session = sessionFromStorageState();
  const authHeaders = {
    apikey: publishableKey,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };

  const created = await request.post(`${supabaseUrl}/rest/v1/copilot_threads`, {
    headers: { ...authHeaders, Prefer: "return=representation" },
    data: {
      scope: "tenant",
      tenant_id: tenantId,
      user_id: session.user.id,
      title: "Assurance Lab — RAG and metering validation",
    },
  });
  expect(created.status()).toBe(201);
  const [thread] = await created.json();
  expect(thread?.id).toBeTruthy();

  const question =
    "Using the knowledge base, explain one-to-many reconciliation matching and cite the Matching rule library article. Keep the answer concise.";
  const streamed = await request.post("/api/copilot/stream", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    data: {
      thread_id: thread.id,
      messages: [
        {
          id: "assurance-rag-1",
          role: "user",
          content: question,
          parts: [{ type: "text", text: question }],
        },
      ],
    },
    timeout: 90_000,
  });
  const streamBody = await streamed.text();
  expect(streamed.status(), streamBody).toBe(200);
  expect(streamed.headers()["content-type"]).toContain("text/event-stream");
  const answer = decodeUiMessageStream(streamBody);
  expect(answer).not.toMatch(/LLM call failed/iu);
  expect(answer).toMatch(/one-to-many|1:N/iu);
  expect(answer).toMatch(/Matching rule library/iu);

  let messages: Array<{ role: string; content: string }> = [];
  let usage: Array<{
    scope: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
  }> = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const messagesResponse = await request.get(
      `${supabaseUrl}/rest/v1/copilot_messages?thread_id=eq.${thread.id}&select=role,content&order=created_at.asc`,
      { headers: authHeaders },
    );
    expect(messagesResponse.status()).toBe(200);
    messages = await messagesResponse.json();

    const usageResponse = await request.get(
      `${supabaseUrl}/rest/v1/ai_usage_events?tenant_id=eq.${tenantId}&user_id=eq.${session.user.id}&select=scope,model,tokens_in,tokens_out,cost_usd&order=created_at.desc&limit=1`,
      { headers: authHeaders },
    );
    expect(usageResponse.status()).toBe(200);
    usage = await usageResponse.json();
    if (messages.some((message) => message.role === "assistant") && usage.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  expect(messages.map((message) => message.role)).toEqual(
    expect.arrayContaining(["user", "assistant"]),
  );
  expect(usage[0]).toMatchObject({ scope: "copilot", model: "claude-sonnet-5" });
  expect(Number(usage[0].tokens_in)).toBeGreaterThan(0);
  expect(Number(usage[0].tokens_out)).toBeGreaterThan(0);
  expect(Number(usage[0].cost_usd)).toBeGreaterThan(0);
});
