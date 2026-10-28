import { handleCopilotStream } from "./stream-handler.server";
import { CopilotRefusal } from "./contracts";

// Compatibility adapter for the existing Sheet/server-function contract.
// Uses the same authenticated handler, scoped context and provider settlement.
export async function governedOneShot(request: Request, data: { thread_id: string; content: string; provider_id?: string }) {
  const response = await handleCopilotStream(new Request(new URL("/api/copilot/stream", request.url), {
    method: "POST", headers: { authorization: request.headers.get("authorization") ?? "", "content-type": "application/json" },
    signal: request.signal,
    body: JSON.stringify({ thread_id: data.thread_id, provider_id: data.provider_id, messages: [{ role: "user", parts: [{ type: "text", text: data.content }] }] }),
  }));
  if (!response.ok) {
    throw new CopilotRefusal(response.status, "copilot.request_refused", "Copilot could not complete this request. Check the conversation before retrying.");
  }
  const wire = await response.text();
  const events = wire.split("\n").filter(line => line.startsWith("data: ") && line !== "data: [DONE]")
    .map(line => { try { return JSON.parse(line.slice(6)); } catch { return null; } }).filter(Boolean);
  const content = events.filter(e => e.type === "text-delta").map(e => e.delta ?? "").join("");
  const finish = events.find(e => e.type === "finish");
  if (events.some(e => e.type === "error") || !content) throw new CopilotRefusal(503, "copilot.response_failed", "Copilot could not complete this request. Check the conversation before retrying.");
  const outputs = events.filter(e => e.type === "tool-output-available");
  return { ok: true, content, tool_calls: outputs.map(e => ({ tool_call_id: e.toolCallId, output: e.output })),
    approval_cards: outputs.map(e => e.output).filter(output => output?.status === "awaiting_approval" && output.confirmation_token),
    accounting: finish?.messageMetadata?.accounting === "settled" ? "settled" : "held" };
}
