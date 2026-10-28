import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { readSafeEnv } from "@/lib/safe-env.server";
import { checkBudget } from "@/lib/ai-metering.server";
import { resolveFviAiBaseUrl, FVI_AI_DEFAULT_BASE_URL } from "@/lib/ai/provider-router.server";
import { initialCopilotToolChoice, prepareCopilotReadStep } from "@/lib/copilot-tool-routing";

export const listThreads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant", "workspace"]),
      tenant_id: z.string().uuid().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("copilot_threads")
      .select("id, title, scope, tenant_id, created_at, updated_at")
      .eq("user_id", context.userId)
      .eq("scope", data.scope)
      .order("updated_at", { ascending: false });
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    else q = q.is("tenant_id", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant", "workspace"]),
      tenant_id: z.string().uuid().optional(),
      title: z.string().max(120).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("copilot_threads")
      .insert({
        scope: data.scope,
        tenant_id: data.tenant_id ?? null,
        user_id: context.userId,
        title: data.title ?? "New conversation",
      })
      .select("id, title, scope, tenant_id, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Phase 1 / item 4 — proactive opening briefing.
    try {
      const { generateThreadBriefing, persistThreadBriefing } = await import("./copilot-briefing.server");
      const { data: isPlat } = await context.supabase.rpc("is_platform_admin", {
        _user_id: context.userId,
      });
      const scope =
        data.scope === "platform" && !!isPlat
          ? ({ type: "platform" } as const)
          : data.tenant_id
          ? ({ type: "tenant", tenantId: data.tenant_id } as const)
          : ({ type: "platform" } as const);
      const briefing = await generateThreadBriefing(
        context.supabase,
        context.userId,
        scope,
        data.scope,
      );
      await persistThreadBriefing(context.supabase, (row as any).id, data.tenant_id ?? null, briefing);
    } catch {
      /* briefing is best-effort — never block thread creation */
    }
    return row;
  });

export const openThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ thread_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: thread, error } = await context.supabase
      .from("copilot_threads")
      .select("id, scope, tenant_id, user_id")
      .eq("id", data.thread_id)
      .single();
    if (error || !thread) throw new Error("Thread not found");
    if ((thread as any).user_id !== context.userId) throw new Error("Forbidden");

    const { generateThreadBriefing, persistThreadBriefing } = await import("./copilot-briefing.server");
    const { data: isPlat } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    const t = thread as any;
    const scope =
      t.scope === "platform" && !!isPlat
        ? ({ type: "platform" } as const)
        : t.tenant_id
        ? ({ type: "tenant", tenantId: t.tenant_id } as const)
        : ({ type: "platform" } as const);
    const briefing = await generateThreadBriefing(
      context.supabase,
      context.userId,
      scope,
      t.scope,
    );
    await persistThreadBriefing(context.supabase, t.id, t.tenant_id, briefing);
    return { ok: true, briefing };
  });


export const listMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ thread_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("copilot_messages")
      .select("id, role, content, created_at")
      .eq("thread_id", data.thread_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

async function callLLM(opts: {
  apiKey: string; baseUrl?: string | null; model: string; provider: string;
  messages: { role: string; content: string }[];
}): Promise<string> {
  const provider = opts.provider;
  if (provider === "anthropic") {
    const res = await fetch((opts.baseUrl || "https://api.anthropic.com") + "/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 1024,
        messages: opts.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
        system: opts.messages.find((m) => m.role === "system")?.content,
      }),
    });
    if (!res.ok) throw new Error(`LLM error: ${res.status} ${await res.text()}`);
    const j: any = await res.json();
    return j?.content?.[0]?.text ?? "";
  }
  // muse / custom / fvi -> muse-compatible
  // E2: prefer caller-supplied baseUrl, else fall back to the platform default.
  const base = opts.baseUrl
    || (provider === "fvi" || provider === "meta" ? FVI_AI_DEFAULT_BASE_URL : "https://api.meta.ai/v1");
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: opts.model, messages: opts.messages }),
  });
  if (!res.ok) throw new Error(`LLM error: ${res.status} ${await res.text()}`);
  const j: any = await res.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      thread_id: z.string().uuid(),
      content: z.string().min(1).max(8000),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: threadRow, error: tErr } = await context.supabase
      .from("copilot_threads")
      .select("id, scope, tenant_id, user_id")
      .eq("id", data.thread_id).single();
    if (tErr || !threadRow) throw new Error("Thread not found");
    const thread: {
      id: string;
      scope: "platform" | "tenant" | "workspace";
      tenant_id: string | null;
      user_id: string;
    } = threadRow as any;
    if (thread.user_id !== context.userId) throw new Error("Forbidden");

    // Redact PII before persisting / sending upstream — also emits the
    // structured pii.redaction audit row into ai_usage_events, or a
    // pii.redaction.unattributed security_events row when tenant_id is null.
    const { redactPii, redactAndAudit } = await import("./pii-redact");
    const red = redactPii(data.content);
    const safeContent = await redactAndAudit(data.content, {
      supabase: context.supabase,
      tenantId: thread.tenant_id,
      callerId: context.userId,
      destination: "copilot",
    });

    // Insert user message (already redacted)
    await context.supabase.from("copilot_messages").insert({
      thread_id: data.thread_id, role: "user", content: safeContent,
    });
    if (red.redacted) {
      await context.supabase.from("security_events").insert({
        tenant_id: thread.tenant_id,
        user_id: context.userId,
        event_type: "copilot.pii_redacted",
        severity: "info",
        context: { thread_id: data.thread_id, counts: red.counts },
      } as any);
    }

    // Resolve provider
    let providerRow: any = null;
    if (thread.scope === "platform") {
      const { data: p } = await context.supabase
        .from("llm_providers").select("provider, base_url, model, key_secret_name")
        .eq("scope", "platform").eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      providerRow = p;
    } else if (thread.tenant_id) {
      // Check AI enabled
      const { data: t } = await context.supabase
        .from("tenants").select("ai_enabled").eq("id", thread.tenant_id).single();
      if (!(t as any)?.ai_enabled) {
        const errMsg = "AI is disabled for this tenant. A tenant admin can enable it in Tenant management.";
        await context.supabase.from("copilot_messages").insert({
          thread_id: data.thread_id, role: "assistant", content: errMsg,
        });
        return { ok: true, content: errMsg };
      }
      const { data: p } = await context.supabase
        .from("llm_providers").select("provider, base_url, model, key_secret_name")
        .eq("scope", "tenant").eq("tenant_id", thread.tenant_id)
        .eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      providerRow = p;
    }

    // C6 — LLM cost guardrail: enforce tenant budget BEFORE any provider fetch.
    // Platform-scope threads (no tenant_id) skip the per-tenant check.
    if (thread.tenant_id) {
      const budget = await checkBudget(context.supabase, thread.tenant_id);
      if (!budget.allowed) {
        const errMsg = `AI_BUDGET_EXCEEDED: ${budget.reason}`;
        await context.supabase.from("copilot_messages").insert({
          thread_id: data.thread_id, role: "assistant", content: errMsg,
        });
        return { ok: true, content: errMsg };
      }
    }

    // Resolve effective scope context for tool execution.
    const { data: isPlat } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    const toolCtx = {
      supabase: context.supabase,
      userId: context.userId,
      scope: thread.scope,
      tenantId: thread.tenant_id,
      isPlatformAdmin: !!isPlat,
    } as const;

    // System prompt grounds the model in role-aware behaviour and forbids the
    // "run this SQL" failure mode that prompted this redesign.
    const tenantBanner = thread.tenant_id
      ? `Tenant scope: ${thread.tenant_id}.`
      : (thread.scope === "platform" ? "Platform-wide scope (cross-tenant)." : "No tenant in context.");
    const systemPrompt = [
      "You are ReconIQ Copilot, the in-app reconciliation assistant for ReconIQ.",
      `Active scope: ${thread.scope}. ${tenantBanner}`,
      toolCtx.isPlatformAdmin
        ? "Caller is a PLATFORM ADMIN — on a platform-scope thread they may see cross-tenant aggregates."
        : "Caller is a regular member; only data their row-level-security policies allow is visible.",
      "",
      "EXECUTION STRATEGY:",
      "1. Understand intent. Classify as METRIC (count/trend/aggregate), ENTITY LOOKUP (specific recon/break/run), KNOWLEDGE (how-to/policy) or MIXED.",
      "2. Map natural language to tool filters: 'last 7 days' → since='7d' or days=7; 'last N days' → days=N; 'open recs' → status='active'; 'open breaks' → status='open'; 'my breaks' → list_my_breaks.",
      "3. Use STRUCTURED TOOLS for any metric, count, status or entity lookup. Use search_kb for knowledge/how-to/policy. Combine tools for mixed questions.",
      "4. For 'status of REC-…' or specific id references, call get_reconciliation / get_break first.",
      "5. Always give the final answer in natural language. Lead with the answer, then the filters/scope you applied. Use bullet lists for multi-row results.",
      "6. When a tool returns 0 rows, say so plainly — never invent numbers, never speculate. Suggest widening the window or switching scope.",
      "7. NEVER tell the user to run SQL, open the database, or query a dashboard manually. Never expose internal table or column names.",
      "8. For KB hits, cite article titles and link as `/{tenant_slug}/kb/{slug}` when a slug is known.",
      "9. If a question is outside reconciliations / runs / breaks / KB / workspace context, say what you can and cannot help with — do not fabricate.",
      "10. Reuse prior-turn filters for follow-ups (e.g. 'and how many are open?') unless the user overrides them.",
    ].join("\n");


    // Load prior turns (already PII-redacted at write time).
    const { data: hist } = await context.supabase
      .from("copilot_messages")
      .select("role, content")
      .eq("thread_id", data.thread_id)
      .order("created_at", { ascending: true })
      .limit(40);

    let reply = "";
    const toolCallSummary: { name: string; args: string; ok: boolean }[] = [];
    const toolTelemetry: Array<{ tool: string; latency_ms: number; status: "ok" | "error" }> = [];
    try {
      const { generateText, stepCountIs } = await import("ai");
      const { buildCopilotTools } = await import("./copilot-tools.server");
      const { buildModelHandle, resolveTenantProvider } = await import("@/lib/model-factory.server");

      // Phase 3 — unified provider factory: FVI-managed provider, Anthropic,
      // Muse, Azure, Vertex, Bedrock all return an AI SDK model handle
      // that supports tool calling. The legacy single-shot `callLLM`
      // fallback is removed.
      const resolved = await resolveTenantProvider(context.supabase, thread.tenant_id);
      if (!resolved) {
        reply = "No AI provider is configured. A tenant admin can add a BYO provider in Tenant management → AI & LLM, or configure the platform default provider.";
      } else {
        const model = buildModelHandle(resolved);
        const tools = buildCopilotTools(toolCtx);

        const result = await generateText({
          model,
          system: systemPrompt,
          messages: (hist ?? []).map((m: any) => ({ role: m.role, content: m.content })),
          tools: tools as any,
          toolChoice: initialCopilotToolChoice(data.content),
          prepareStep: prepareCopilotReadStep(data.content),
          stopWhen: stepCountIs(12),
          temperature: 0.2,
        });
        reply = result.text ?? "";

        // Audit each tool call.
        for (const step of result.steps ?? []) {
          for (const tc of (step as any).toolCalls ?? []) {
            toolCallSummary.push({ name: tc.toolName, args: JSON.stringify(tc.args ?? {}), ok: true });
            toolTelemetry.push({ tool: String(tc.toolName), latency_ms: 0, status: "ok" });
            await context.supabase.from("security_events").insert({
              tenant_id: thread.tenant_id,
              user_id: context.userId,
              event_type: "copilot.tool_call",
              severity: "info",
              context: {
                thread_id: data.thread_id,
                tool: tc.toolName,
                args: tc.args,
                scope: thread.scope,
              },
            } as any);
          }
        }
        if (toolTelemetry.length > 0) {
          await context.supabase.from("ai_usage_events").insert({
            tenant_id: thread.tenant_id,
            user_id: context.userId,
            model: resolved.model,
            provider: resolved.provider,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0,
            tool_calls: toolTelemetry,
            context: { surface: "copilot.sendMessage", thread_id: data.thread_id },
          } as any);
        }
      }
    } catch (e: any) {
      reply = `LLM call failed: ${e?.message ?? String(e)}`;
    }

    if (!reply || !reply.trim()) {
      reply = "I couldn't produce an answer for that just now. Try rephrasing, or ask about reconciliation counts, breaks, runs, or how-to topics from the knowledge base.";
    }

    await context.supabase.from("copilot_messages").insert({
      thread_id: data.thread_id,
      role: "assistant",
      content: reply,
    });
    await context.supabase.from("copilot_threads")
      .update({ updated_at: new Date().toISOString() }).eq("id", data.thread_id);
    return { ok: true, content: reply, tool_calls: toolCallSummary };
  });
