import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listThreads, createThread, listMessages, sendMessage } from "@/lib/copilot.functions";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Plus, Send, MessageSquare, Bot, User as UserIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Scope = "platform" | "tenant" | "workspace";

export function CopilotSheetButton({
  scope = "workspace",
  tenantId,
}: {
  scope?: Scope;
  tenantId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open Copilot"
          title="Copilot"
          className="relative gap-1.5"
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline text-xs font-medium">Copilot</span>
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[480px]"
      >
        <CopilotPanel scope={scope} tenantId={tenantId} />
      </SheetContent>
    </Sheet>
  );
}

function CopilotPanel({ scope, tenantId }: { scope: Scope; tenantId?: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listThreads);
  const create = useServerFn(createThread);
  const msgs = useServerFn(listMessages);
  const send = useServerFn(sendMessage);

  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showThreads, setShowThreads] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const threadsQ = useQuery({
    queryKey: ["copilot-threads", scope, tenantId ?? null],
    queryFn: () => list({ data: { scope, tenant_id: tenantId } }),
  });

  // Auto-select most recent thread for persistent memory
  useEffect(() => {
    if (!active && threadsQ.data && threadsQ.data.length > 0) {
      setActive(threadsQ.data[0].id);
    }
  }, [threadsQ.data, active]);

  const messagesQ = useQuery({
    queryKey: ["copilot-messages", active],
    queryFn: () => (active ? msgs({ data: { thread_id: active } }) : Promise.resolve([])),
    enabled: !!active,
  });

  const createM = useMutation({
    mutationFn: () => create({ data: { scope, tenant_id: tenantId } }),
    onSuccess: (t: any) => {
      setActive(t.id);
      setShowThreads(false);
      qc.invalidateQueries({ queryKey: ["copilot-threads", scope, tenantId ?? null] });
    },
  });
  const sendM = useMutation({
    mutationFn: (content: string) => send({ data: { thread_id: active!, content } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["copilot-messages", active] });
      requestAnimationFrame(() => composerRef.current?.focus());
    },
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messagesQ.data, sendM.isPending]);

  useEffect(() => {
    composerRef.current?.focus();
  }, [active]);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    if (!active) {
      create({ data: { scope, tenant_id: tenantId } }).then((th: any) => {
        setActive(th.id);
        qc.invalidateQueries({ queryKey: ["copilot-threads", scope, tenantId ?? null] });
        send({ data: { thread_id: th.id, content: t } }).then(() => {
          setDraft("");
          qc.invalidateQueries({ queryKey: ["copilot-messages", th.id] });
        });
      });
      return;
    }
    sendM.mutate(t);
  };

  const messages = messagesQ.data ?? [];
  const threads = threadsQ.data ?? [];
  const activeThread = threads.find((t: any) => t.id === active);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b bg-gradient-to-br from-primary/8 via-background to-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold tracking-tight">ReconIQ - Copilot</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {activeThread?.title ?? "New conversation"} · {scope}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowThreads((v) => !v)}
            aria-label="Conversation history"
            title="History"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => createM.mutate()}
            aria-label="New conversation"
            title="New"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Thread list overlay */}
      {showThreads ? (
        <div className="border-b bg-muted/30 px-2 py-2">
          <ScrollArea className="max-h-48">
            <div className="space-y-0.5 p-1">
              {threads.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet. Ask Copilot e.g. “Why did Demo Bank Nostro USD recon fail this morning?”. Ask Copilot e.g. “Why did Demo Bank Nostro USD recon fail this morning?”</p>
              ) : null}
              {threads.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActive(t.id);
                    setShowThreads(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-xs",
                    active === t.id
                      ? "bg-primary/15 text-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  <MessageSquare className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="truncate">{t.title}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : null}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState scope={scope} onPick={(s) => setDraft(s)} />
        ) : (
          <div className="space-y-4">
            {messages.map((m: any) => (
              <MessageBubble key={m.id} role={m.role} content={m.content} />
            ))}
            {sendM.isPending ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Copilot is thinking…
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t bg-card/40 p-3">
        <div className="relative rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask Copilot about ReconIQ Studio, breaks, AI usage…"
            rows={2}
            className="min-h-[60px] resize-none border-0 bg-transparent pr-12 focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button
            size="icon"
            className="absolute bottom-2 right-2 h-8 w-8 rounded-lg"
            onClick={submit}
            disabled={sendM.isPending || !draft.trim()}
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
          Enter to send · Shift+Enter for newline · Respects your RLS & RBAC
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm bg-muted",
        )}
      >
        {content}
      </div>
    </div>
  );
}

function EmptyState({ scope, onPick }: { scope: Scope; onPick: (s: string) => void }) {
  const suggestions = {
    workspace: [
      "What reconciliations have the most breaks this week?",
      "Summarize my open exceptions by severity.",
      "Suggest a matching rule for cash vs ledger.",
    ],
    tenant: [
      "Which workspaces consumed the most AI credits?",
      "Show me failed logins in the last 7 days.",
      "Draft an SLA policy for high-priority tickets.",
    ],
    platform: [
      "Which tenants are nearing their budget?",
      "Summarize platform audit events today.",
      "List tenants without MFA enforcement.",
    ],
  }[scope];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
        <Sparkles className="h-6 w-6" />
      </div>
      <div>
        <h3 className="font-display text-base font-semibold">How can I help?</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          I work within your role & data scope.
        </p>
      </div>
      <div className="w-full space-y-1.5 px-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="w-full rounded-lg border bg-card px-3 py-2 text-left text-xs hover:border-primary/40 hover:bg-accent"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
