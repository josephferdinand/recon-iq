// Cascading rule sets + tolerance ladder editor (P0 #1).
// Opens as a sheet attached to a specific reconciliation.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Layers, Plus, Trash2, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";
import {
  listCascadePasses,
  upsertCascadePass,
  deleteCascadePass,
  listToleranceLadders,
  upsertToleranceLadder,
  deleteToleranceLadder,
} from "@/lib/recon-cascade.functions";
import { DEFAULT_LADDER_RUNGS, type ToleranceRung } from "@/lib/recon-cascade";
import { CascadePolicyPanel } from "@/components/cascade-policy-panel";

const OUTCOMES = [
  { value: "auto_match", label: "Auto-match", tone: "default" as const },
  { value: "match_with_break", label: "Match w/ break", tone: "secondary" as const },
  { value: "suggest", label: "Suggest", tone: "outline" as const },
  { value: "review", label: "Review", tone: "destructive" as const },
];

interface Props {
  reconId: string;
  reconName: string;
  tenantId: string;
  canWrite: boolean;
}

export function CascadeRulesSheet({ reconId, reconName, tenantId, canWrite }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const list = useServerFn(listCascadePasses);
  const upsert = useServerFn(upsertCascadePass);
  const del = useServerFn(deleteCascadePass);
  const listL = useServerFn(listToleranceLadders);
  const upsertL = useServerFn(upsertToleranceLadder);
  const delL = useServerFn(deleteToleranceLadder);
  const [message, setMessage] = useState<UserMessage | null>(null);
  const [rulesJsonDraft, setRulesJsonDraft] = useState<Record<string, string>>({});
  const [rulesJsonErrors, setRulesJsonErrors] = useState<Record<string, string>>({});
  const [passesReadbackRequired, setPassesReadbackRequired] = useState(false);
  const [laddersReadbackRequired, setLaddersReadbackRequired] = useState(false);

  function writeFailure(error: unknown, action: string, source: "passes" | "ladders"): UserMessage {
    const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
    const code = typeof candidate.code === "string" ? candidate.code : undefined;
    const status = typeof candidate.status === "number" ? candidate.status : undefined;
    const mapped = mapKnownFailure(code, status);
    const definite = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
    const category: UserMessageCategory = definite ? mapped.category : "unknown_write_outcome";
    return formatUserMessage({
      ...mapped,
      category,
      action,
      code,
      status,
      availableActions: category === "unknown_write_outcome" ? [{ id: source === "passes" ? "refresh-passes" : "refresh-ladders", label: source === "passes" ? "Refresh passes" : "Refresh tolerance ladders" }] : [],
    });
  }

  const passesQ = useQuery({
    queryKey: ["cascade-passes", reconId],
    queryFn: () => list({ data: { tenant_id: tenantId, recon_id: reconId } }),
    enabled: open,
  });
  const laddersQ = useQuery({
    queryKey: ["tolerance-ladders", reconId],
    queryFn: () => listL({ data: { tenant_id: tenantId, recon_id: reconId } }),
    enabled: open,
  });

  const mAddPass = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          tenant_id: tenantId,
          recon_id: reconId,
          pass_order: (passesQ.data?.length ?? 0) + 1,
          label: `Pass ${(passesQ.data?.length ?? 0) + 1} — Exact`,
          outcome: "auto_match",
          rules_json: [],
          enabled: true,
        },
      }),
    onSuccess: () => {
      setMessage(null);
      qc.invalidateQueries({ queryKey: ["cascade-passes", reconId] });
      toast.success("Pass added");
    },
    onError: (error) => {
      const message = writeFailure(error, "add this reconciliation pass", "passes");
      setMessage(message);
      if (message.category === "unknown_write_outcome") setPassesReadbackRequired(true);
    },
  });

  const mUpdate = useMutation({
    mutationFn: (p: any) => upsert({ data: p }),
    onSuccess: () => { setMessage(null); qc.invalidateQueries({ queryKey: ["cascade-passes", reconId] }); },
    onError: (error) => {
      const message = writeFailure(error, "update this reconciliation pass", "passes");
      setMessage(message);
      if (message.category === "unknown_write_outcome") setPassesReadbackRequired(true);
    },
  });

  const mDel = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      setMessage(null);
      qc.invalidateQueries({ queryKey: ["cascade-passes", reconId] });
      toast.success("Pass removed");
    },
    onError: (error) => {
      const message = writeFailure(error, "remove this reconciliation pass", "passes");
      setMessage(message);
      if (message.category === "unknown_write_outcome") setPassesReadbackRequired(true);
    },
  });

  const mAddLadder = useMutation({
    mutationFn: () =>
      upsertL({
        data: {
          tenant_id: tenantId,
          recon_id: reconId,
          field_name: "amount",
          field_type: "numeric",
          rungs_json: DEFAULT_LADDER_RUNGS,
          enabled: true,
        },
      }),
    onSuccess: () => {
      setMessage(null);
      qc.invalidateQueries({ queryKey: ["tolerance-ladders", reconId] });
      toast.success("Ladder added — edit field name");
    },
    onError: (error) => {
      const message = writeFailure(error, "add this tolerance ladder", "ladders");
      setMessage(message);
      if (message.category === "unknown_write_outcome") setLaddersReadbackRequired(true);
    },
  });
  const mUpdateLadder = useMutation({
    mutationFn: (l: any) => upsertL({ data: l }),
    onSuccess: () => { setMessage(null); qc.invalidateQueries({ queryKey: ["tolerance-ladders", reconId] }); },
    onError: (error) => {
      const message = writeFailure(error, "update this tolerance ladder", "ladders");
      setMessage(message);
      if (message.category === "unknown_write_outcome") setLaddersReadbackRequired(true);
    },
  });
  const mDelLadder = useMutation({
    mutationFn: (id: string) => delL({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      setMessage(null);
      qc.invalidateQueries({ queryKey: ["tolerance-ladders", reconId] });
      toast.success("Ladder removed");
    },
    onError: (error) => {
      const message = writeFailure(error, "remove this tolerance ladder", "ladders");
      setMessage(message);
      if (message.category === "unknown_write_outcome") setLaddersReadbackRequired(true);
    },
  });

  function refreshExistingState(id: string) {
    const query = id === "refresh-passes" ? passesQ : laddersQ;
    void query.refetch().then((result) => {
      if (!result.isSuccess) return;
      setMessage(null);
      if (id === "refresh-passes") {
        setPassesReadbackRequired(false);
        setRulesJsonDraft({});
        setRulesJsonErrors({});
      } else setLaddersReadbackRequired(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <Layers className="mr-2 h-3.5 w-3.5" /> Cascade
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Cascading rule sets — {reconName}</SheetTitle>
          <SheetDescription>
            Run an ordered waterfall: pass 1 (exact) → pass 2 (penny tolerance) → pass 3
            (fuzzy reference). Records matched in one pass are removed before the next.
            Per-field tolerance ladders classify each break into <em>auto-match</em>,{" "}
            <em>match-with-break</em>, <em>suggest</em>, or <em>review</em>.
          </SheetDescription>
        </SheetHeader>
        {message ? <div role="alert" aria-live="assertive" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">{message.title}</p><p className="mt-1">{message.humanMessage}</p>{message.nextActions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2" onClick={() => refreshExistingState(action.id)}>{action.label}</Button>)}</div> : null}
        {/* ---------- Outcome policy + simulation (Step 2) ---------- */}
        <div className="mt-6">
          <CascadePolicyPanel
            tenantId={tenantId}
            reconDefinitionId={reconId}
          />
        </div>


        {/* ---------- Passes ---------- */}
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Passes (waterfall order)</h3>
            {canWrite && (
              <Button size="sm" variant="outline" disabled={passesReadbackRequired || mAddPass.isPending} onClick={() => mAddPass.mutate()}>
                <Plus className="mr-2 h-3.5 w-3.5" /> Add pass
              </Button>
            )}
          </div>

          {passesQ.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading cascade passes…</p> : null}
          {passesQ.isError ? <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm">Cascade passes could not be loaded. No empty state is shown until the list can be checked. <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => void passesQ.refetch()}>Refresh passes</Button></div> : null}

          {!passesQ.isPending && !passesQ.isError && (passesQ.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              No passes yet. Suggested Demo Bank Nostro template: <strong>Exact</strong>{" "}
              → <strong>Penny tolerance</strong> → <strong>Fuzzy + date window</strong>.
            </p>
          )}

          {(passesQ.data ?? []).map((p: any, i: number) => (
            <div key={p.id}>
              <div className="rounded-lg border bg-card p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">#{p.pass_order}</Badge>
                  <Input
                    className="flex-1"
                    value={p.label}
                    onChange={(e) =>
                      mUpdate.mutate({ ...p, label: e.target.value })
                    }
                    disabled={!canWrite || passesReadbackRequired}
                  />
                  <Select
                    value={p.outcome}
                    onValueChange={(v) => mUpdate.mutate({ ...p, outcome: v })}
                    disabled={!canWrite || passesReadbackRequired}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTCOMES.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(v) => mUpdate.mutate({ ...p, enabled: v })}
                    disabled={!canWrite || passesReadbackRequired}
                  />
                  {canWrite && (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={passesReadbackRequired || mDel.isPending}
                      onClick={() => mDel.mutate(p.id)}
                      aria-label="Remove pass"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Textarea
                  className="text-xs font-mono"
                  rows={3}
                  placeholder='[{"id":"k1","kind":"exact_match","fields":{"A":"ref","B":"reference"},"is_key":true}]'
                  aria-invalid={Boolean(rulesJsonErrors[p.id])}
                  aria-describedby={rulesJsonErrors[p.id] ? `cascade-rules-${p.id}-error` : undefined}
                  value={rulesJsonDraft[p.id] ?? JSON.stringify(p.rules_json ?? [], null, 0)}
                  onChange={(e) => {
                    setRulesJsonDraft((current) => ({ ...current, [p.id]: e.target.value }));
                    try {
                      const parsed = JSON.parse(e.target.value || "[]");
                      if (!Array.isArray(parsed)) throw new Error("shape");
                      setRulesJsonErrors((current) => { const next = { ...current }; delete next[p.id]; return next; });
                      mUpdate.mutate({ ...p, rules_json: parsed });
                    } catch {
                      setRulesJsonErrors((current) => ({ ...current, [p.id]: "Enter a valid JSON array of reconciliation rules. The current saved rules have not changed." }));
                    }
                  }}
                  disabled={!canWrite || passesReadbackRequired}
                />
                {rulesJsonErrors[p.id] ? <p id={`cascade-rules-${p.id}-error`} role="alert" className="text-xs text-destructive">{rulesJsonErrors[p.id]}</p> : null}
                <p className="text-[11px] text-muted-foreground">
                  Rules JSON uses the same shape as ReconIQ Studio. Tip: pass 1 = strict
                  keys + zero tolerance; pass 2 = same keys + numeric_tolerance_abs;
                  pass 3 = fuzzy_levenshtein / date_within_range.
                </p>
              </div>
              {i < (passesQ.data?.length ?? 0) - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>

        <Separator className="my-6" />

        {/* ---------- Tolerance ladders ---------- */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Per-field tolerance ladders</h3>
              <p className="text-xs text-muted-foreground">
                Each rung classifies a difference into an outcome. First matching rung
                wins. Outside all rungs ⇒ <strong>review</strong>.
              </p>
            </div>
            {canWrite && (
              <Button size="sm" variant="outline" disabled={laddersReadbackRequired || mAddLadder.isPending} onClick={() => mAddLadder.mutate()}>
                <Plus className="mr-2 h-3.5 w-3.5" /> Add ladder
              </Button>
            )}
          </div>

          {laddersQ.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading tolerance ladders…</p> : null}
          {laddersQ.isError ? <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm">Tolerance ladders could not be loaded. The existing ladder state is unknown. <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => void laddersQ.refetch()}>Refresh tolerance ladders</Button></div> : null}

          {(laddersQ.data ?? []).map((l: any) => (
            <div key={l.id} className="rounded-lg border bg-card p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Field</Label>
                  <Input
                    value={l.field_name}
                    onChange={(e) =>
                      mUpdateLadder.mutate({ ...l, field_name: e.target.value })
                    }
                    disabled={!canWrite || laddersReadbackRequired}
                  />
                </div>
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={l.field_type}
                    onValueChange={(v) =>
                      mUpdateLadder.mutate({ ...l, field_type: v })
                    }
                    disabled={!canWrite || laddersReadbackRequired}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="numeric">Numeric</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="string">String</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-end gap-2">
                  <Switch
                    checked={l.enabled}
                    onCheckedChange={(v) => mUpdateLadder.mutate({ ...l, enabled: v })}
                    disabled={!canWrite || laddersReadbackRequired}
                  />
                  {canWrite && (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={laddersReadbackRequired || mDelLadder.isPending}
                      onClick={() => mDelLadder.mutate(l.id)}
                      aria-label="Remove ladder"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {(l.rungs_json as ToleranceRung[]).map((r, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end rounded-md border bg-muted/30 p-2"
                  >
                    <div>
                      <Label className="text-[10px]">Label</Label>
                      <Input
                        className="h-8"
                        value={r.label ?? ""}
                        onChange={(e) => {
                          const next = [...l.rungs_json];
                          next[idx] = { ...r, label: e.target.value };
                          mUpdateLadder.mutate({ ...l, rungs_json: next });
                        }}
                        disabled={!canWrite || laddersReadbackRequired}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Max abs</Label>
                      <Input
                        className="h-8"
                        type="number"
                        step="0.01"
                        value={r.max_abs ?? ""}
                        onChange={(e) => {
                          const next = [...l.rungs_json];
                          next[idx] = {
                            ...r,
                            max_abs: e.target.value === "" ? undefined : Number(e.target.value),
                          };
                          mUpdateLadder.mutate({ ...l, rungs_json: next });
                        }}
                        disabled={!canWrite || laddersReadbackRequired}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Max %</Label>
                      <Input
                        className="h-8"
                        type="number"
                        step="0.01"
                        value={r.max_pct ?? ""}
                        onChange={(e) => {
                          const next = [...l.rungs_json];
                          next[idx] = {
                            ...r,
                            max_pct: e.target.value === "" ? undefined : Number(e.target.value),
                          };
                          mUpdateLadder.mutate({ ...l, rungs_json: next });
                        }}
                        disabled={!canWrite || laddersReadbackRequired}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Max days</Label>
                      <Input
                        className="h-8"
                        type="number"
                        value={r.max_days ?? ""}
                        onChange={(e) => {
                          const next = [...l.rungs_json];
                          next[idx] = {
                            ...r,
                            max_days: e.target.value === "" ? undefined : Number(e.target.value),
                          };
                          mUpdateLadder.mutate({ ...l, rungs_json: next });
                        }}
                        disabled={!canWrite || laddersReadbackRequired}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Outcome</Label>
                      <Select
                        value={r.outcome}
                        onValueChange={(v) => {
                          const next = [...l.rungs_json];
                          next[idx] = { ...r, outcome: v as any };
                          mUpdateLadder.mutate({ ...l, rungs_json: next });
                        }}
                        disabled={!canWrite || laddersReadbackRequired}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OUTCOMES.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end">
                      {canWrite && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            const next = l.rungs_json.filter((_: any, x: number) => x !== idx);
                            mUpdateLadder.mutate({ ...l, rungs_json: next });
                          }}
                          aria-label="Remove rung"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {canWrite && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = [
                        ...(l.rungs_json ?? []),
                        { max_abs: 0.01, outcome: "auto_match", severity: "low" },
                      ];
                      mUpdateLadder.mutate({ ...l, rungs_json: next });
                    }}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" /> Add rung
                  </Button>
                )}
              </div>
            </div>
          ))}

          {!laddersQ.isPending && !laddersQ.isError && (laddersQ.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              No ladders yet. Demo Bank Nostro default: <strong>amount</strong> field
              with rungs &lt;= 0.01 auto-match, &lt;= 1.00 match-with-break, &lt;= 100
              suggest.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
