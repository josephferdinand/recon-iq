import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import { listThreads, createThread, listMessages } from "@/lib/copilot.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Send, Sparkles, ShieldCheck, X, Pencil } from "lucide-react";

const SUGGESTIONS: { label: string; text: string }[] = [
  { label: "Recons this week", text: "How many reconciliations were created in the last 7 days?" },
  { label: "Open breaks", text: "How many breaks are open right now? Break it down by severity." },
  { label: "Run health", text: "Give me a runs summary for the last 24 hours: success rate and exception volume." },
  { label: "Top reasons", text: "What are the top 5 break reasons in the last 30 days?" },
  { label: "How to onboard", text: "Find KB articles about onboarding a new reconciliation." },
  { label: "My queue", text: "List the open breaks assigned to me." },
];

type ApprovalCard = {
  action_id: string;
  confirmation_token: string;
  expires_at: string;
  tool: string;
  description: string;
  preview: Record<string, unknown>;
};

function partsToText(m: UIMessage): string {
  const parts = (m as any).parts as Array<{ type: string; text?: string }> | undefined;
  if (Array.isArray(parts)) {
    return parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
  }
  return String((m as any).content ?? "");
}

/**
 * Extract `needs_approval` tool-result payloads from a UIMessage. AI SDK
 * emits tool results as parts with `type: 'tool-<name>'` and `output`.
 */
function extractApprovalCards(m: UIMessage): ApprovalCard[] {
  const parts = (m as any).parts as Array<{ type: string; output?: any; result?: any }> | undefined;
  if (!Array.isArray(parts)) return [];
  const out: ApprovalCard[] = [];
  for (const p of parts) {
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) continue;
    const payload = p.output ?? p.result;
    if (payload && payload.status === "awaiting_approval" && payload.confirmation_token) {
      out.push(payload as ApprovalCard);
    }
  }
  return out;
}


export function CopilotChat({
  scope, tenantId, title = "Copilot",
}: {
  scope: "platform" | "tenant" | "workspace";
  tenantId?: string;
  title?: string;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listThreads);
  const create = useServerFn(createThread);
  const msgs = useServerFn(listMessages);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const threadsQ = useQuery({
    queryKey: ["copilot-threads", scope, tenantId ?? null],
    queryFn: () => list({ data: { scope, tenant_id: tenantId } }),
  });
  const messagesQ = useQuery({
    queryKey: ["copilot-messages", active],
    queryFn: () => active ? msgs({ data: { thread_id: active } }) : Promise.resolve([]),
    enabled: !!active,
  });

  const createM = useMutation({
    mutationFn: () => create({ data: { scope, tenant_id: tenantId } }),
    onSuccess: (t: any) => {
      setActive(t.id);
      qc.invalidateQueries({ queryKey: ["copilot-threads", scope, tenantId ?? null] });
    },
  });

  // Streaming transport — attaches the user's Supabase bearer so the
  // server route can authorize the call and apply RLS.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/copilot/stream",
        body: { thread_id: active },
        fetch: async (input, init) => {
          const { data: { session } } = await supabase.auth.getSession();
          const headers = new Headers(init?.headers);
          if (session?.access_token) {
            headers.set("authorization", `Bearer ${session.access_token}`);
          }
          headers.set("content-type", "application/json");
          return fetch(input, { ...init, headers });
        },
      }),
    [active],
  );

  const { messages, sendMessage, status } = useChat({
    id: active ?? undefined,
    transport,
    onFinish: () => {
      qc.invalidateQueries({ queryKey: ["copilot-messages", active] });
    },
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messagesQ.data, messages]);

  const isStreaming = status === "submitted" || status === "streaming";
  const persisted = (messagesQ.data ?? []) as Array<{ id: string; role: string; content: string }>;

  return (
    <Card className="flex h-[600px] flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => createM.mutate()}>
          <Plus className="mr-1 h-3 w-3" /> New
        </Button>
      </CardHeader>
      <CardContent className="grid flex-1 grid-cols-[180px_1fr] gap-3 overflow-hidden p-3">
        <div className="space-y-1 overflow-y-auto border-r pr-2 text-sm">
          {(threadsQ.data ?? []).map((t: any) => (
            <button key={t.id} onClick={() => setActive(t.id)}
              className={`w-full truncate rounded px-2 py-1.5 text-left ${active === t.id ? "bg-accent" : "hover:bg-muted"}`}>
              {t.title}
            </button>
          ))}
          {threadsQ.data && threadsQ.data.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No conversations yet. Ask Copilot e.g. “Why did Demo Bank Nostro USD recon fail this morning?”</p>
          ) : null}
        </div>
        <div className="flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-2">
            {!active ? (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">Pick or start a conversation, then try one of these:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <Button
                      key={s.label}
                      size="sm"
                      variant="outline"
                      className="h-auto whitespace-normal py-1.5 text-xs"
                      onClick={async () => {
                        const t: any = await createM.mutateAsync();
                        setActive(t.id);
                        setTimeout(() => sendMessage({ text: s.text }), 50);
                        setDraft("");
                      }}
                    >
                      <Sparkles className="mr-1 h-3 w-3" /> {s.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {persisted.map((m) => (
                  <div key={`p-${m.id}`} className={`rounded-md p-3 text-sm ${m.role === "user" ? "bg-muted" : "bg-accent/40"}`}>
                    <div className="mb-1 text-[10px] uppercase text-muted-foreground">{m.role}</div>
                    {m.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(m.content ?? "")}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    )}
                  </div>
                ))}
                {messages.map((m: UIMessage) => {
                  const cards = extractApprovalCards(m);
                  return (
                    <div key={`s-${m.id}`} className={`rounded-md p-3 text-sm ${m.role === "user" ? "bg-muted" : "bg-accent/40"}`}>
                      <div className="mb-1 text-[10px] uppercase text-muted-foreground">{m.role} (live)</div>
                      {m.role === "assistant" ? (
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{partsToText(m)}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{partsToText(m)}</div>
                      )}
                      {cards.map((c) => (
                        <ApprovalCardView key={c.action_id} card={c} tenantId={tenantId ?? null}
                          onActioned={() => qc.invalidateQueries({ queryKey: ["copilot-messages", active] })} />
                      ))}
                    </div>
                  );
                })}
                {isStreaming ? <div className="text-xs text-muted-foreground">Copilot streaming…</div> : null}
              </>
            )}
          </div>
          {active ? (
            <div className="mt-2 flex gap-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about reconciliations, breaks, runs, or how-to topics… (⌘/Ctrl+Enter to send)" rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                    sendMessage({ text: draft });
                    setDraft("");
                  }
                }} />
              <Button
                onClick={() => {
                  if (!draft.trim()) return;
                  sendMessage({ text: draft });
                  setDraft("");
                }}
                disabled={isStreaming || !draft.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Phase 2 — Approve / Modify / Cancel card for mutating agent tool-calls.
 * The token is single-use and expires after 5 minutes; the server enforces
 * 4-eyes (approver !== requester) via DB trigger + app-layer guard.
 */
function ApprovalCardView({
  card,
  tenantId,
  onActioned,
}: {
  card: ApprovalCard;
  tenantId: string | null;
  onActioned: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "cancel" | null>(null);
  const [done, setDone] = useState<{ ok: boolean; message: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState(() => JSON.stringify(card.preview, null, 2));
  const expiresIn = Math.max(0, Math.round((new Date(card.expires_at).getTime() - Date.now()) / 1000));

  async function call(mode: "approve" | "cancel") {
    if (!tenantId) return;
    setBusy(mode);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/copilot/approve", {
        method: "POST",
        headers,
        body: JSON.stringify({
          tenant_id: tenantId,
          action_id: card.action_id,
          confirmation_token: card.confirmation_token,
          mode,
        }),
      });
      const body = await res.json().catch(() => ({}));
      setDone({
        ok: res.ok,
        message: res.ok
          ? mode === "approve" ? "Approved and executed." : "Cancelled."
          : `Failed: ${body?.error ?? res.statusText}`,
      });
      onActioned();
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className={`mt-2 rounded-md border p-2 text-xs ${done.ok ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-destructive/40 text-destructive"}`}>
        {done.message}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <div className="mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-300">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span className="font-semibold uppercase tracking-wide">Needs approval · {card.tool}</span>
        <span className="ml-auto text-muted-foreground">expires in {expiresIn}s</span>
      </div>
      <p className="mb-2">{card.description}</p>
      {editing ? (
        <Textarea value={editJson} onChange={(e) => setEditJson(e.target.value)} rows={6} className="mb-2 font-mono text-[11px]" />
      ) : (
        <pre className="mb-2 max-h-32 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px]">{JSON.stringify(card.preview, null, 2)}</pre>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="default" disabled={busy !== null || editing} onClick={() => call("approve")}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setEditing((v) => !v)}>
          <Pencil className="mr-1 h-3 w-3" /> {editing ? "Stop editing" : "Modify"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => call("cancel")}>
          <X className="mr-1 h-3 w-3" /> {busy === "cancel" ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
      {editing ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Modify edits are advisory — re-ask Copilot with the adjusted parameters; the original proposal still requires explicit Cancel or it will expire.
        </p>
      ) : null}
    </div>
  );
}
