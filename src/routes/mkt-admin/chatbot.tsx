import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { chatKpis, assertMktRolesFn } from "@/lib/mkt-admin.functions";
import {
  listChatbotPrompts,
  upsertChatbotPrompt,
  deleteChatbotPrompt,
  type ChatbotPrompt,
} from "@/lib/mkt-chatbot-prompts.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, Save, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/mkt-admin/chatbot")({
  beforeLoad: async () => {
    try {
      await assertMktRolesFn({ data: { allowed: MKT_TAB_ROLES.chatbot } });
    } catch {
      throw redirect({ to: "/mkt-admin" });
    }
  },
  component: ChatbotDash,
});

type Draft = {
  id?: string;
  key: string;
  label: string;
  system_prompt: string;
  greeting: string;
  model_hint: string;
  temperature: number;
  is_active: boolean;
};

const EMPTY: Draft = {
  key: "",
  label: "",
  system_prompt: "",
  greeting: "",
  model_hint: "",
  temperature: 0.2,
  is_active: true,
};

function toDraft(p: ChatbotPrompt): Draft {
  return {
    id: p.id,
    key: p.key,
    label: p.label,
    system_prompt: p.system_prompt,
    greeting: p.greeting ?? "",
    model_hint: p.model_hint ?? "",
    temperature: Number(p.temperature),
    is_active: p.is_active,
  };
}

function ChatbotDash() {
  const kpiFn = useServerFn(chatKpis);
  const listFn = useServerFn(listChatbotPrompts);
  const saveFn = useServerFn(upsertChatbotPrompt);
  const delFn = useServerFn(deleteChatbotPrompt);
  const qc = useQueryClient();

  const kpi = useQuery({ queryKey: ["mkt", "chatbot", "kpi"], queryFn: () => kpiFn({ data: undefined }) });
  const prompts = useQuery({ queryKey: ["mkt", "chatbot", "prompts"], queryFn: () => listFn({ data: undefined }) });

  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const selected = useMemo(() => {
    if (!selectedId || selectedId === "new") return null;
    return prompts.data?.find((p) => p.id === selectedId) ?? null;
  }, [selectedId, prompts.data]);

  const save = useMutation({
    mutationFn: async () =>
      saveFn({
        data: {
          id: draft.id,
          key: draft.key,
          label: draft.label,
          system_prompt: draft.system_prompt,
          greeting: draft.greeting || null,
          model_hint: draft.model_hint || null,
          temperature: draft.temperature,
          is_active: draft.is_active,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt", "chatbot", "prompts"] });
      setSelectedId(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt", "chatbot", "prompts"] });
      setSelectedId(null);
    },
  });

  const c = kpi.data;
  const editing = selectedId !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">ReconIQ Copilot</h1>
          <p className="text-sm text-muted-foreground">Chatbot prompts, greeting, and runtime settings.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-6">
        <Kpi label="Sessions" value={c?.totalSessions ?? "—"} />
        <Kpi label="Messages" value={c?.totalMessages ?? "—"} />
        <Kpi label="Escalations" value={c?.escalated ?? "—"} />
        <Kpi label="CSAT" value={c?.csat != null ? c.csat.toFixed(2) : "—"} />
        <Kpi label="Tokens" value={c?.totalTokens ?? "—"} />
        <Kpi label="Cost (USD)" value={c ? (c.totalCost != null ? c.totalCost.toFixed(4) : "Unavailable") : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prompts</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedId("new");
                setDraft(EMPTY);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> New
            </Button>
          </div>
          {prompts.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : (prompts.data ?? []).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No prompts yet.</div>
          ) : (
            <div className="space-y-1">
              {(prompts.data ?? []).map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedId(p.id);
                    setDraft(toDraft(p));
                  }}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${
                    selectedId === p.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.key} · {p.is_active ? "active" : "disabled"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          {!editing ? (
            <div className="p-6 text-sm text-muted-foreground">
              Select a prompt to edit, or create a new one.
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="key">Key</Label>
                  <Input
                    id="key"
                    value={draft.key}
                    onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                    placeholder="dr_falcon_default"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="label">Label</Label>
                  <Input
                    id="label"
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="system_prompt">System prompt</Label>
                <Textarea
                  id="system_prompt"
                  className="min-h-[220px] font-mono text-xs"
                  value={draft.system_prompt}
                  onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="greeting">Greeting</Label>
                <Textarea
                  id="greeting"
                  className="min-h-[80px]"
                  value={draft.greeting}
                  onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
                  placeholder="First message shown to visitors"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label htmlFor="model_hint">Model hint</Label>
                  <Input
                    id="model_hint"
                    value={draft.model_hint}
                    onChange={(e) => setDraft({ ...draft, model_hint: e.target.value })}
                    placeholder="google/gemini-2.5-flash"
                  />
                </div>
                <div>
                  <Label htmlFor="temperature">Temperature</Label>
                  <Input
                    id="temperature"
                    type="number"
                    step="0.05"
                    min={0}
                    max={2}
                    value={draft.temperature}
                    onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="is_active"
                      checked={draft.is_active}
                      onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                    />
                    <Label htmlFor="is_active">Active</Label>
                  </div>
                </div>
              </div>

              {save.isError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {(save.error as Error).message}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={save.isPending}>
                  <Save className="mr-1 h-4 w-4" />
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
                {selected && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDraft(toDraft(selected))}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" /> Revert
                  </Button>
                )}
                {selected && (
                  <Button
                    type="button"
                    variant="destructive"
                    className="ml-auto"
                    disabled={del.isPending}
                    onClick={() => {
                      if (confirm(`Delete prompt "${selected.label}"?`)) del.mutate(selected.id);
                    }}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Delete
                  </Button>
                )}
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}
