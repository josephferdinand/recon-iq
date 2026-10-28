import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { compileNRL, listNRLRules, upsertNRLRule, deleteNRLRule } from "@/lib/nrl.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Trash2, Wand2, CheckCircle2, AlertCircle, Plus, Code2 } from "lucide-react";
import { toast } from "sonner";

/**
 * NRL Editor — Authoring surface for Natural Rule Language rules.
 *
 * Live-compiles the user's prose to canonical rule JSON via the compileNRL
 * server function, surfaces parse errors inline, and persists accepted rules
 * via upsertNRLRule. Designed for the ReconIQ Studio Wizard "Advanced rules"
 * tab so analysts can author Duco-style match logic in plain English.
 */
export function NRLEditor({
  tenantId,
  definitionId,
  canWrite,
}: { tenantId: string; definitionId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const compile = useServerFn(compileNRL);
  const list = useServerFn(listNRLRules);
  const upsert = useServerFn(upsertNRLRule);
  const del = useServerFn(deleteNRLRule);

  const rules = useQuery({
    queryKey: ["nrl-rules", tenantId, definitionId],
    queryFn: () => list({ data: { tenant_id: tenantId, definition_id: definitionId } }),
  });

  const [draft, setDraft] = useState({
    id: undefined as string | undefined,
    name: "",
    pass_order: 1,
    enabled: true,
    nrl_source: "match A.amount to B.amount with tolerance 0.01 where A.currency = B.currency pass 1",
  });

  const compileResult = useQuery({
    queryKey: ["nrl-compile", draft.nrl_source],
    queryFn: () => compile({ data: { source: draft.nrl_source } }),
    enabled: draft.nrl_source.trim().length > 0,
  });

  const saveMutation = useMutation({
    mutationFn: () => upsert({
      data: {
        id: draft.id,
        tenant_id: tenantId,
        definition_id: definitionId,
        name: draft.name || "Untitled NRL rule",
        nrl_source: draft.nrl_source,
        pass_order: draft.pass_order,
        enabled: draft.enabled,
      },
    }),
    onSuccess: () => {
      toast.success(draft.id ? "Rule updated" : "Rule created");
      setDraft({ id: undefined, name: "", pass_order: 1, enabled: true, nrl_source: "" });
      qc.invalidateQueries({ queryKey: ["nrl-rules", tenantId, definitionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      toast.success("Rule deleted");
      qc.invalidateQueries({ queryKey: ["nrl-rules", tenantId, definitionId] });
    },
  });

  const ok = compileResult.data?.ok ?? false;
  const errors = compileResult.data?.errors ?? [];
  const canonical = compileResult.data?.canonical;

  const samples = useMemo(() => [
    "match A.amount to B.amount with tolerance 0.01",
    "match A.amount to B.amount with tolerance 1% where A.currency = B.currency pass 1",
    "match A.trade_id to B.trade_ref where A.book = 'LON' pass 2",
    "roll up A by trade_id sum(quantity) pass 1",
  ], []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wand2 className="h-4 w-4" /> Natural Rule Language</CardTitle>
          <CardDescription>
            Author match logic in plain English. Live compiles to deterministic rule JSON; errors are highlighted before save.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <Label>Rule name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Cash-vs-Bank exact + 1c tolerance" />
            </div>
            <div>
              <Label>Pass order</Label>
              <Input type="number" min={1} max={50} value={draft.pass_order}
                onChange={(e) => setDraft({ ...draft, pass_order: Number(e.target.value) || 1 })} />
            </div>
          </div>
          <div>
            <Label>NRL source</Label>
            <Textarea
              rows={4}
              className="font-mono text-sm"
              value={draft.nrl_source}
              onChange={(e) => setDraft({ ...draft, nrl_source: e.target.value })}
              placeholder="e.g. match DemoBank_Citi.amount to DemoBank_GL.amount with tolerance 0.01 where DemoBank_Citi.currency = DemoBank_GL.currency pass 1"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2">
              {ok ? (
                <><CheckCircle2 className="h-4 w-4 text-emerald-600" /><span className="text-sm">Compiles cleanly</span></>
              ) : (
                <><AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm">{errors[0]?.message ?? "Compiling…"}</span></>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Enabled</Label>
              <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              <Button size="sm" disabled={!canWrite || !ok || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}>
                <Plus className="h-4 w-4 mr-1" /> {draft.id ? "Update" : "Save rule"}
              </Button>
            </div>
          </div>
          {canonical && (
            <div className="rounded-md bg-muted/40 p-3 text-xs font-mono">
              <div className="flex items-center gap-2 mb-1 text-muted-foreground"><Code2 className="h-3 w-3" />Canonical</div>
              {canonical}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {samples.map((s) => (
              <Badge key={s} variant="secondary" className="cursor-pointer"
                onClick={() => setDraft({ ...draft, nrl_source: s })}>
                {s.length > 60 ? s.slice(0, 57) + "…" : s}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved NRL rules</CardTitle>
          <CardDescription>Rules execute in pass order. Lower-pass rules run first.</CardDescription>
        </CardHeader>
        <CardContent>
          {rules.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
           (rules.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No rules yet. Example: “Match DemoBank_Citi.amount to DemoBank_GL.amount with tolerance 0.01 where currency = USD pass 1”.</p> :
            <div className="space-y-2">
              {(rules.data ?? []).map((r: { id: string; name: string; pass_order: number; enabled: boolean; nrl_source: string }) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Pass {r.pass_order}</Badge>
                      <span className="font-medium truncate">{r.name}</span>
                      {!r.enabled && <Badge variant="secondary">disabled</Badge>}
                    </div>
                    <code className="text-xs text-muted-foreground block truncate">{r.nrl_source}</code>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDraft({
                      id: r.id, name: r.name, pass_order: r.pass_order,
                      enabled: r.enabled, nrl_source: r.nrl_source,
                    })}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={!canWrite}
                      onClick={() => deleteMutation.mutate(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}
