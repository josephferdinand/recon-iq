import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, X, Send, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";

/**
 * ReconIQ Copilot — the Virtual ReconIQ Product Advisor.
 * Floating widget mounted on every public marketing route.
 */
export function DrFalconWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/public/mkt-chat" }),
  });

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("dr-falcon:open", h);
    return () => window.removeEventListener("dr-falcon:open", h);
  }, []);

  useEffect(() => {
    if (open && messages.length === 0) {
      // seed greeting locally so opening feels instant; the model will drive the real conversation after first user message
    }
  }, [open, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const busy = status === "submitted" || status === "streaming";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-5 z-40 flex items-center gap-2 rounded-full border border-white/15 bg-white px-4 py-3 text-sm font-medium text-black shadow-lg transition-colors hover:bg-white/85 md:bottom-24"
          aria-label="Talk to ReconIQ Copilot"
        >
          <Sparkles className="h-4 w-4" />
          Talk to ReconIQ Copilot
        </button>
      )}

      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[620px] w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl md:bottom-24">

          <header className="flex items-center justify-between border-b border-border bg-white/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">ReconIQ Copilot</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Virtual Product Advisor</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-foreground">
                <MessageSquare className="mb-2 h-4 w-4 text-primary" />
                Welcome to ReconIQ. Are you looking to improve reconciliation processes,
                automate workflows, reduce manual effort, or evaluate our platform for your organization?
              </div>
            )}
            {messages.map((m) => {
              const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
              const isUser = m.role === "user";
              return (
                <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className={
                      isUser
                        ? "max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                        : "max-w-[92%] rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm text-foreground"
                    }
                  >
                    {isUser ? (
                      <div className="whitespace-pre-wrap leading-relaxed">{text}</div>
                    ) : text ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed
                        prose-p:my-2 prose-p:leading-relaxed
                        prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold
                        prose-h1:text-base prose-h2:text-sm prose-h3:text-sm
                        prose-ul:my-2 prose-ul:pl-5 prose-ol:my-2 prose-ol:pl-5
                        prose-li:my-1 prose-li:marker:text-primary
                        prose-strong:text-foreground prose-strong:font-semibold
                        prose-a:text-primary prose-a:underline-offset-2
                        prose-code:rounded prose-code:bg-background/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none
                        prose-hr:my-3">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                      </div>
                    ) : busy ? (
                      <span className="opacity-60">…</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={submit} className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }}
                placeholder="Ask about the platform, book a demo…"
                rows={1}
                className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button type="submit" size="sm" disabled={busy || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              ReconIQ Copilot may make mistakes. For contractual matters, please confirm with a ReconIQ rep.
            </p>
          </form>
        </div>
      )}
    </>
  );
}
