import { z } from "zod";

export const textPart = z.object({ type: z.literal("text"), text: z.string().max(8000) });
export const chatInput = z.object({
  thread_id: z.string().uuid(),
  provider_id: z.string().uuid().optional(),
  messages: z.array(z.object({
    id: z.string().max(160).optional(),
    role: z.enum(["user", "assistant"]),
    content: z.string().max(8000).optional(),
    // Previous SDK tool outputs may be present but are never trusted as context.
    parts: z.array(z.unknown()).max(64).optional(),
  })).min(1).max(128),
// DefaultChatTransport adds id/trigger/messageId. Preserve the existing API's
// stripping behavior; all authorization fields come from the owned thread.
}).strip().superRefine((input, ctx) => {
  const last = input.messages.at(-1);
  if (!last || last.role !== "user") ctx.addIssue({ code: "custom", message: "A new user message is required" });
  try { incomingText(input); } catch { ctx.addIssue({ code: "custom", message: "Invalid message" }); }
});

export function incomingText(input: { messages: Array<{ role: string; content?: string; parts?: unknown[] }> }) {
  const last = input.messages.at(-1);
  if (!last || last.role !== "user") throw new Error("Invalid message");
  const parts = last.parts?.filter((p): p is { type: "text"; text: string } => textPart.safeParse(p).success) ?? [];
  if (last.parts?.some(p => !textPart.safeParse(p).success)) throw new Error("Text messages only");
  const text = parts.length ? parts.map(p => p.text).join("") : last.content ?? "";
  if (last.content && parts.length && last.content !== text) throw new Error("Ambiguous message");
  if (!text.trim() || text.length > 8000) throw new Error("Invalid message");
  return text;
}

export class CopilotRefusal extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

const refusalCodes: Record<string, [number, string]> = {
  "copilot.forbidden": [403, "Copilot is not available for your current access."],
  "copilot.policy_unavailable": [403, "Copilot is not enabled for this scope. Contact your administrator."],
  "copilot.kill_switch": [423, "Copilot is paused by policy."],
  "copilot.rate_limit": [429, "Too many AI requests. Wait before trying again."],
  "copilot.budget_reached": [402, "The AI budget has been reached. Contact your administrator."],
  "copilot.pricing_unavailable": [424, "Current provider pricing is unavailable. Contact your administrator."],
  "copilot.binding_required": [424, "This provider needs a current approved model binding."],
  "copilot.bounds_unavailable": [424, "This model needs verified input and output limits."],
  "copilot.already_dispatched": [409, "This request was already dispatched. Check its result before retrying."],
};
export function safeRefusal(error: unknown): CopilotRefusal {
  if (error instanceof CopilotRefusal) return error;
  const code = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const entry = refusalCodes[code];
  return entry ? new CopilotRefusal(entry[0], code, entry[1])
    : new CopilotRefusal(503, "copilot.unavailable", "Copilot is temporarily unavailable. Check this conversation before retrying.");
}

export type ProviderChoice = {
  id: string; label: string; provider: string; model: string;
  available: boolean; reason: string | null;
  maxInputTokens: number | null; maxOutputTokens: number | null;
};

export function providerCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
