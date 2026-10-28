/**
 * ReconIQ Copilot — streaming chat endpoint.
 *
 * Phase 1 / item 5: replaces the prior one-shot `generateText` call with a
 * true `streamText` + `toUIMessageStreamResponse` pipeline so the client
 * (via `useChat`) renders tokens as they arrive. Tool execution, PII
 * redaction, budget enforcement, and audit logging are preserved.
 *
 * Auth: pulls the Supabase bearer token from the `Authorization` header and
 * mints a per-request user-scoped client so RLS still applies. The route is
 * NOT under `/api/public/*` and therefore requires a signed-in session.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { tool } from "ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildCopilotTools, hybridSearchKb, type CopilotContext } from "@/lib/copilot-tools.server";
import { checkBudget } from "@/lib/ai-metering.server";
import { redactPii, redactAndAudit } from "@/lib/pii-redact";
import {
  resolveFviAiBaseUrl,
  createFviAiProvider,
} from "@/lib/ai/provider-router.server";
import { buildModelHandle, resolveTenantProvider } from "@/lib/model-factory.server";
import {
  assignBreaks,
  resolveBreaks,
  triggerReconciliationRun,
  recommendFix,
  ensureAgentRunForThread,
  proposeKbArticleCreate,
  proposeKbArticleUpdate,
  proposeKbArticlePublish,
  proposeKbArticleArchive,
  RESOLUTION_CODES,
} from "@/lib/agent-write-tools.server";
import { loadTenantPluginTools } from "@/lib/copilot-plugins.server";
import { buildCopilotTicketTools } from "@/lib/copilot-ticket-tools.server";
import { buildCopilotKbTools } from "@/lib/copilot-kb-tools.server";
import {
  formatCopilotKbGrounding,
  estimateCopilotTokens,
  initialCopilotToolChoice,
  prepareCopilotReadStep,
  routeCopilotReadTool,
} from "@/lib/copilot-tool-routing";


const Body = z.object({
  thread_id: z.string().uuid(),
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        // SECURITY: reject client-supplied `system` messages — the server
        // owns the system prompt. Any inbound `system` role is prompt-injection.
        role: z.enum(["user", "assistant"]),
        content: z.string().optional(),
        parts: z.array(z.any()).optional(),
      }),
    )
    .min(1),
});

// LL-066 + LL-073 — Validate Bearer JWT SHAPE before any downstream work.
// A real Supabase JWT has three base64url segments (header.payload.signature).
// Reject anything else with 401 immediately so we don't fall through to
// `createClient` and surface a misleading 500 ("supabaseUrl is required").
function userTokenFromRequest(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
  return m ? m[1] : null;
}

function buildSystemPrompt(scope: string, tenantId: string | null, isPlatformAdmin: boolean): string {
  const banner = tenantId
    ? `Tenant scope: ${tenantId}.`
    : scope === "platform"
    ? "Platform-wide scope (cross-tenant)."
    : "No tenant in context.";
  return [
    "You are ReconIQ Copilot, the in-app reconciliation assistant for ReconIQ.",
    `Active scope: ${scope}. ${banner}`,
    isPlatformAdmin
      ? "Caller is a PLATFORM ADMIN — on a platform-scope thread they may see cross-tenant aggregates."
      : "Caller is a regular member; only data their row-level-security policies allow is visible.",
    "",
    "Use STRUCTURED TOOLS for any metric, count, status or entity lookup. Use search_kb for knowledge/how-to/policy. Lead with the answer, then the filters/scope you applied. Never invent numbers when a tool returns 0 rows. Never tell the user to run SQL.",
    "",
    "MUTATING TOOLS (assign_breaks, resolve_breaks, trigger_reconciliation_run, kb_article_create, kb_article_update, kb_article_publish, kb_article_archive) DO NOT execute immediately. They return `status: awaiting_approval` with a confirmation_token. After calling, summarise what will happen and tell the user to use the Approve / Modify / Cancel card. Do NOT call the same mutating tool twice in one turn.",
    "Use `recommend_fix` (read-only) to advise the user on remediations before proposing a mutating action.",
    "",
    "KNOWLEDGE BASE: for 'how do I…', 'explain this article', 'troubleshoot X', or 'what should I read' questions, start with `search_kb` to find candidates, then use `kb_get_article` to load the full article (returns summary, body, extracted procedure steps, troubleshooting sections, and related articles). Use `kb_get_procedure` when the user asks HOW to do something, `kb_troubleshoot` when they report a symptom/error, `kb_list_related` for follow-ups, and `kb_recommend_reading` to close an answer with a curated reading list. ALWAYS cite article titles, quote the relevant steps, and end with actionable recommendations. Never paraphrase without loading the article body first.",
    "",
    "KB AUTHORING (mutating, approval-gated): use `kb_article_create` / `kb_article_update` / `kb_article_publish` / `kb_article_archive` when the user (a tenant admin or platform admin) asks to write, revise, publish, or retire KB content. These return `awaiting_approval` and require a second admin to approve. NEVER propose more than one KB write per turn.",
    "",
    "SUPPORT TICKETS: use `create_support_ticket` to raise a ticket, `list_support_tickets` (supports search/query, queue, assignee, sla_state=breached|due_soon|on_track), `get_support_ticket` / `check_ticket_sla_status` for status, `upcoming_ticket_sla` to proactively surface breached/due-soon/pending-action tickets when the user asks 'what's due', `add_ticket_comment` for follow-ups (mark internal_note=true for staff-only notes), `attach_files_to_ticket` for file uploads, and `escalate_support_ticket` when the user asks to escalate. Tenant users can only act on their own tenant; platform admins can target others. All ticket actions are audited automatically.",
  ].join("\n");
}

function copilotStreamErrorMessage(error: unknown): string {
  // Raw provider detail is logged by the caller; clients only get the
  // standard service copy (see user-facing-errors registry).
  void error;
  return "Unable To Reach The Service — the AI service is currently unavailable. Please try again shortly. If the issue continues, contact support.";
}

function rateLimitErrorCode(error: unknown) {
  if (!(error instanceof Error) || !("code" in error)) return null;
  const code = (error as Error & { code?: unknown }).code;
  return code === "rate_limit_exceeded" || code === "rate_limit_unavailable" ? code : null;
}

function boundedRetryAfter(error: unknown) {
  if (!(error instanceof Error) || !("retryAfterSeconds" in error)) return 1;
  const value = Number((error as Error & { retryAfterSeconds?: unknown }).retryAfterSeconds);
  return Number.isFinite(value) ? Math.min(86_400, Math.max(1, Math.ceil(value))) : 1;
}


export async function handleCopilotStream(request: Request): Promise<Response> {
  const token = userTokenFromRequest(request);
  if (!token) return new Response("Unauthorized", { status: 401 });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return Response.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let payload: z.infer<typeof Body>;
  try {
    payload = Body.parse(await request.json());
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const supabase: SupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { data: threadRow, error: tErr } = await supabase
    .from("copilot_threads")
    .select("id, scope, tenant_id, user_id")
    .eq("id", payload.thread_id)
    .single();
  if (tErr || !threadRow) return new Response("Thread not found", { status: 404 });
  const thread = threadRow as { id: string; scope: "platform" | "tenant" | "workspace"; tenant_id: string | null; user_id: string };
  if (thread.user_id !== userId) return new Response("Forbidden", { status: 403 });

  // Rate limit — per user (60/min) and per tenant (300/min) — mitigates
  // runaway spend and abuse. Infrastructure errors fail closed.
  try {
    const { enforceRateLimit } = await import("@/lib/rate-limit.server");
    await enforceRateLimit(supabase, `copilot.stream:user:${userId}`, 60, 60, {
      user_id: userId, tenant_id: thread.tenant_id ?? undefined, event_type: "copilot.rate_limited",
    });
    if (thread.tenant_id) {
      await enforceRateLimit(supabase, `copilot.stream:tenant:${thread.tenant_id}`, 60, 300, {
        user_id: userId, tenant_id: thread.tenant_id, event_type: "copilot.rate_limited",
      });
    }
  } catch (error) {
    if (rateLimitErrorCode(error) === "rate_limit_exceeded") {
      return new Response("Rate limit exceeded. Try again later.", {
        status: 429,
        headers: { "Retry-After": String(boundedRetryAfter(error)) },
      });
    }
    return new Response("Rate limiting is temporarily unavailable. Try again later.", {
      status: 503,
    });
  }

  // Tenant budget guardrail.
  if (thread.tenant_id) {
    const budget = await checkBudget(supabase, thread.tenant_id);
    if (!budget.allowed) {
      return new Response(`AI_BUDGET_EXCEEDED: ${budget.reason}`, { status: 402 });
    }
  }

  // PII redact the most recent user message and persist it.
  const lastUser = [...payload.messages].reverse().find((m) => m.role === "user");
  const rawText = lastUser?.content ?? "";
  if (rawText) {
    const red = redactPii(rawText);
    const safe = await redactAndAudit(rawText, {
      supabase,
      tenantId: thread.tenant_id,
      callerId: userId,
      destination: "copilot",
    });
    await supabase.from("copilot_messages").insert({
      thread_id: thread.id, role: "user", content: safe,
    });
    if (red.redacted) {
      await supabase.from("security_events").insert({
        tenant_id: thread.tenant_id,
        user_id: userId,
        event_type: "copilot.pii_redacted",
        severity: "info",
        context: { thread_id: thread.id, counts: red.counts },
      } as any);
    }
  }

  const { data: isPlat } = await supabase.rpc("is_platform_admin", { _user_id: userId });
  const toolCtx: CopilotContext = {
    supabase,
    userId,
    scope: thread.scope,
    tenantId: thread.tenant_id,
    isPlatformAdmin: !!isPlat,
  };

  // Phase 3 — unified provider factory. Resolves BYO (Anthropic, Muse,
  // Azure, Vertex, Bedrock) or the FVI-managed provider, and returns an AI
  // SDK model handle that always supports tool calling.
  const resolved = await resolveTenantProvider(supabase, thread.tenant_id);
  if (!resolved) {
    return new Response(
      "No AI provider configured. Add a BYO provider in Tenant → AI & LLM, or configure the platform default provider.",
      { status: 500 },
    );
  }
  const model = buildModelHandle(resolved);
  // Preserve helper references so tree-shaking keeps the runtime available.
  void createFviAiProvider;
  void resolveFviAiBaseUrl;

  const readTools = buildCopilotTools(toolCtx);
  const kbTools = buildCopilotKbTools(toolCtx);
  const writeTools = thread.tenant_id ? buildWriteTools(supabase, {
    tenantId: thread.tenant_id,
    userId,
    threadId: thread.id,
  }) : {};
  const ticketTools = buildCopilotTicketTools({
    supabase,
    userId,
    scope: thread.scope,
    tenantId: thread.tenant_id,
    isPlatformAdmin: !!isPlat,
    threadId: thread.id,
  });
  // Phase 4 — load tenant-installed marketplace plugins (RLS scopes the read).
  const pluginTools = await loadTenantPluginTools(supabase, thread.tenant_id, {
    actorUserId: userId,
    threadId: thread.id,
  });
  // Phase 3 (7a) — wrap every tool so we capture { tool, latency_ms, status }.
  const toolCallLog: Array<{ tool: string; latency_ms: number; status: "ok" | "error" }> = [];
  const tools = instrumentToolCalls({ ...readTools, ...kbTools, ...writeTools, ...ticketTools, ...pluginTools }, toolCallLog);

  const forcedReadTool = routeCopilotReadTool(rawText);
  let kbGrounding = "";
  if (forcedReadTool === "search_kb") {
    const startedAt = Date.now();
    try {
      const search = await hybridSearchKb(toolCtx, { query: rawText, k: 5 });
      const ids = [...new Set(search.results.map((row) => row.article_id))];
      type KbArticleRow = { id: string; title: string; slug: string; summary: string | null; body_md: string | null };
      let articleRows: KbArticleRow[] = [];
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from("kb_articles")
          .select("id, title, slug, summary, body_md")
          .in("id", ids)
          .eq("status", "published")
          .limit(5);
        if (error) throw error;
        articleRows = (data ?? []) as KbArticleRow[];
      }
      const byId = new Map(articleRows.map((article) => [article.id, article]));
      kbGrounding = formatCopilotKbGrounding(
        search.mode,
        search.results.flatMap((result) => {
          const article = byId.get(result.article_id);
          return article
            ? [{
                id: article.id,
                title: article.title,
                slug: article.slug,
                summary: article.summary ?? "",
                body: article.body_md ?? result.excerpt,
              }]
            : [];
        }),
      );
      toolCallLog.push({ tool: "search_kb", latency_ms: Date.now() - startedAt, status: "ok" });
      await supabase.from("security_events").insert({
        tenant_id: thread.tenant_id,
        user_id: userId,
        event_type: "copilot.tool_call",
        severity: "info",
        context: {
          thread_id: thread.id,
          tool: "search_kb",
          scope: thread.scope,
          result_count: articleRows.length,
          execution: "server_grounding",
        },
      } as never);
    } catch {
      toolCallLog.push({ tool: "search_kb", latency_ms: Date.now() - startedAt, status: "error" });
      kbGrounding = formatCopilotKbGrounding("error", []);
    }
  }

  const systemPrompt = [
    buildSystemPrompt(thread.scope, thread.tenant_id, !!isPlat),
    kbGrounding,
  ].filter(Boolean).join("\n\n");
  const modelToolInput = kbGrounding ? "" : rawText;
  const modelTools = kbGrounding ? undefined : tools;

  const { streamText, stepCountIs, convertToModelMessages } = await import("ai");
  const modelMessages = await convertToModelMessages(payload.messages as any);
  const result = streamText({
    model,
    system: systemPrompt,
    messages: modelMessages,
    tools: modelTools,
    toolChoice: initialCopilotToolChoice(modelToolInput),
    prepareStep: prepareCopilotReadStep(modelToolInput),
    stopWhen: stepCountIs(12),
    temperature: 0.2,
  });

  const streamResponse = result.toUIMessageStreamResponse({
    originalMessages: payload.messages as any,
    onError: (error: unknown) => {
      console.warn("[copilot.stream] model call failed", error);
      return copilotStreamErrorMessage(error);
    },
    onFinish: async ({ messages }: { messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }> }) => {
      try {
        const assistant = [...messages].reverse().find((m) => m.role === "assistant");
        const text = assistant?.parts
          ?.filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("") ?? assistant?.content ?? "";
        if (text) {
          await supabase.from("copilot_messages").insert({
            thread_id: thread.id, role: "assistant", content: text,
          });
          await supabase.from("copilot_threads")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", thread.id);
        }
        // Real token accounting: pull usage from the streamText result. Log
        // every completed turn (not just tool calls) so cost dashboards and
        // budget enforcement reflect reality.
        let tokensIn = 0, tokensOut = 0;
        let usageEstimated = false;
        try {
          const usage: any = await (result as any).usage;
          tokensIn = Number(usage?.promptTokens ?? usage?.inputTokens ?? 0) || 0;
          tokensOut = Number(usage?.completionTokens ?? usage?.outputTokens ?? 0) || 0;
        } catch { /* usage unavailable — fall back to 0 */ }
        if (tokensIn <= 0 && tokensOut <= 0 && text) {
          tokensIn = estimateCopilotTokens(`${systemPrompt}\n${rawText}`);
          tokensOut = estimateCopilotTokens(text);
          usageEstimated = true;
        }
        if (thread.tenant_id && (tokensIn > 0 || tokensOut > 0 || toolCallLog.length > 0)) {
          const { recordUsage } = await import("@/lib/ai-metering.server");
          await recordUsage(supabase as any, {
            tenant_id: thread.tenant_id,
            user_id: userId,
            scope: "copilot",
            model: resolved.model,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            meta: {
              surface: "copilot.stream",
              thread_id: thread.id,
              provider: resolved.provider,
              tool_calls: toolCallLog,
              usage_source: usageEstimated ? "estimated_gateway_omission" : "provider",
            },
          });
        }
      } catch {
        /* persistence best-effort; stream already flushed to client */
      }
    },
  });

  // S-2 — enforce explicit stream security headers. We preserve the
  // AI-SDK stream body + content-type and override caching/sniffing/CSP.
  const headers = new Headers(streamResponse.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  return new Response(streamResponse.body, {
    status: streamResponse.status,
    statusText: streamResponse.statusText,
    headers,
  });
}

/**
 * Phase 3 (7a) — wrap every tool's `execute` so we capture the tool name,
 * latency, and status. The wrapper does not change the tool result shape.
 */
function instrumentToolCalls(
  tools: Record<string, any>,
  log: Array<{ tool: string; latency_ms: number; status: "ok" | "error" }>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [name, t] of Object.entries(tools)) {
    if (!t?.execute) { out[name] = t; continue; }
    const origExecute = t.execute as (input: unknown) => Promise<unknown>;
    out[name] = {
      ...t,
      execute: async (input: unknown) => {
        const t0 = Date.now();
        try {
          const r = await origExecute(input);
          log.push({ tool: name, latency_ms: Date.now() - t0, status: "ok" });
          return r;
        } catch (e) {
          log.push({ tool: name, latency_ms: Date.now() - t0, status: "error" });
          throw e;
        }
      },
    };
  }
  return out;
}

/**
 * Phase 2 — register the four write/advice tools. Mutating tools NEVER
 * mutate inline: they create a pending agent_actions row and return a
 * `needs_approval` payload that the UI renders as Approve / Modify / Cancel.
 */
export function buildWriteTools(
  supabase: SupabaseClient,
  ctx: { tenantId: string; userId: string; threadId: string },
) {
  const ensureRun = () => ensureAgentRunForThread(supabase, ctx);
  return {
    assign_breaks: tool({
      description:
        "Propose assigning one or more breaks to a tenant member. Returns awaiting_approval; the human must confirm via the Approve / Modify / Cancel card. Never mutates inline.",
      inputSchema: z.object({
        break_ids: z.array(z.string().uuid()).min(1).max(100),
        assignee_user_id: z.string().uuid(),
      }),
      execute: async (input) => {
        const runId = await ensureRun();
        return assignBreaks(supabase, {
          tenantId: ctx.tenantId,
          runId,
          breakIds: input.break_ids,
          assigneeUserId: input.assignee_user_id,
          requesterUserId: ctx.userId,
          needsApproval: true,
        });
      },
    }),
    resolve_breaks: tool({
      description:
        "Propose resolving (or writing-off) one or more breaks with a resolution code (matched|written_off|timing|duplicate) and an audit note. Always requires 4-eyes approval. Never mutates inline.",
      inputSchema: z.object({
        break_ids: z.array(z.string().uuid()).min(1).max(100),
        resolution_code: z.enum(RESOLUTION_CODES),
        note: z.string().min(4).max(2000),
      }),
      execute: async (input) => {
        const runId = await ensureRun();
        return resolveBreaks(supabase, {
          tenantId: ctx.tenantId,
          runId,
          breakIds: input.break_ids,
          resolutionCode: input.resolution_code,
          note: input.note,
        });
      },
    }),
    trigger_reconciliation_run: tool({
      description:
        "Propose triggering a new reconciliation run for a given definition. Enforces blast-radius, hourly limit, and production step-up. Returns awaiting_approval.",
      inputSchema: z.object({
        recon_definition_id: z.string().uuid(),
      }),
      execute: async (input) => {
        const runId = await ensureRun();
        return triggerReconciliationRun(supabase, {
          tenantId: ctx.tenantId,
          runId,
          reconDefinitionId: input.recon_definition_id,
          requesterUserId: ctx.userId,
        });
      },
    }),
    recommend_fix: tool({
      description:
        "Read-only: returns structured remediation suggestions (root cause, similar-resolved count, rule suggestion, confidence) for a given break. Use BEFORE proposing a mutating action.",
      inputSchema: z.object({ exception_id: z.string().uuid() }),
      execute: async (input) =>
        recommendFix(supabase, { tenantId: ctx.tenantId, exceptionId: input.exception_id }),
    }),
    kb_article_create: tool({
      description:
        "Propose creating a new Knowledge Base article. Requires tenant_admin or platform_admin. Returns awaiting_approval; a second admin must approve. Use `scope: 'tenant'` for tenant-only articles, `scope: 'platform'` (platform admins only) for global content.",
      inputSchema: z.object({
        scope: z.enum(["platform", "tenant"]),
        title: z.string().min(2).max(200),
        summary: z.string().max(500).optional(),
        body_md: z.string().max(50_000),
        category_id: z.string().uuid().optional(),
        publish_immediately: z.boolean().default(false),
      }),
      execute: async (input) => {
        const runId = await ensureRun();
        return proposeKbArticleCreate(supabase, {
          tenantId: ctx.tenantId,
          runId,
          requesterUserId: ctx.userId,
          input: {
            scope: input.scope,
            title: input.title,
            summary: input.summary ?? null,
            body_md: input.body_md,
            category_id: input.category_id ?? null,
            publish_immediately: input.publish_immediately,
          },
        });
      },
    }),
    kb_article_update: tool({
      description:
        "Propose updating an existing KB article. Provide only the fields to change (title, summary, body_md, category_id). Always requires approval.",
      inputSchema: z.object({
        article_id: z.string().uuid(),
        title: z.string().min(2).max(200).optional(),
        summary: z.string().max(500).nullable().optional(),
        body_md: z.string().max(50_000).optional(),
        category_id: z.string().uuid().nullable().optional(),
      }),
      execute: async (input) => {
        const runId = await ensureRun();
        return proposeKbArticleUpdate(supabase, {
          tenantId: ctx.tenantId,
          runId,
          requesterUserId: ctx.userId,
          input,
        });
      },
    }),
    kb_article_publish: tool({
      description:
        "Propose publishing (or unpublishing back to draft) a KB article. Use `publish: true` to publish, `false` to move back to draft.",
      inputSchema: z.object({
        article_id: z.string().uuid(),
        publish: z.boolean(),
      }),
      execute: async (input) => {
        const runId = await ensureRun();
        return proposeKbArticlePublish(supabase, {
          tenantId: ctx.tenantId,
          runId,
          requesterUserId: ctx.userId,
          articleId: input.article_id,
          publish: input.publish,
        });
      },
    }),
    kb_article_archive: tool({
      description:
        "Propose archiving a KB article (removes it from published listings without deleting it). Requires approval.",
      inputSchema: z.object({
        article_id: z.string().uuid(),
      }),
      execute: async (input) => {
        const runId = await ensureRun();
        return proposeKbArticleArchive(supabase, {
          tenantId: ctx.tenantId,
          runId,
          requesterUserId: ctx.userId,
          articleId: input.article_id,
        });
      },
    }),
  };
}


export const Route = createFileRoute("/api/copilot/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => handleCopilotStream(request),
    },
  },
});
