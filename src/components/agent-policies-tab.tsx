import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listAgentPolicies, setAgentPolicy,
  listAgentPolicyVersions, rollbackAgentPolicy,
} from "@/lib/agent-policies.functions";
import { getTenantAgentDefaults, setTenantAgentDefaults } from "@/lib/agent-review.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";


type Row = {
  action_key: string;
  label: string;
  ceiling: "suggest" | "assist" | "auto";
  required_approvers: number;
  reversible: boolean;
  is_override: boolean;
};

export function AgentPoliciesTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listAgentPolicies);
  const setOne = useServerFn(setAgentPolicy);

  const q = useQuery({
    queryKey: ["agent-policies", tenantId],
    queryFn: () => list({ data: { tenantId } }),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (v: Row) => setOne({
      data: {
        tenantId,
        actionKey: v.action_key,
        ceiling: v.ceiling,
        requiredApprovers: v.required_approvers,
        reversible: v.reversible,
      },
    }),
    onSuccess: () => {
      toast.success("Policy updated");
      qc.invalidateQueries({ queryKey: ["agent-policies", tenantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const rows = (q.data ?? []) as Row[];
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <ScopeLimitsCard tenantId={tenantId} canWrite={canWrite} />
      <Card>
      <CardHeader>
        <CardTitle>Agent autonomy policies</CardTitle>
        <CardDescription>
          Per-action ceiling, required approvers (maker-checker), and reversibility for the
          ReconIQ AI agent. Defaults are conservative; only raise the ceiling after operational testing.
          Every change is versioned — open <strong>History</strong> on any row to audit or roll back.
        </CardDescription>

      </CardHeader>
      <CardContent className="p-0">

        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Ceiling</th>
              <th className="px-4 py-2">Approvers</th>
              <th className="px-4 py-2">Reversible</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2 text-right">History</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.action_key} className="border-b">
                <td className="px-4 py-2 font-medium">{r.label}</td>
                <td className="px-4 py-2">
                  <Select
                    value={r.ceiling}
                    disabled={!canWrite}
                    onValueChange={(v) => save.mutate({ ...r, ceiling: v as Row["ceiling"] })}
                  >
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="suggest">Suggest</SelectItem>
                      <SelectItem value="assist">Assist</SelectItem>
                      <SelectItem value="auto">Auto</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-2">
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    className="w-20"
                    value={r.required_approvers}
                    disabled={!canWrite}
                    onChange={(e) => save.mutate({ ...r, required_approvers: Number(e.target.value) })}
                  />
                </td>
                <td className="px-4 py-2">
                  <Switch
                    checked={r.reversible}
                    disabled={!canWrite}
                    onCheckedChange={(v) => save.mutate({ ...r, reversible: v })}
                  />
                </td>
                <td className="px-4 py-2">
                  {r.is_override ? <Badge>Override</Badge> : <Badge variant="outline">Default</Badge>}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => setHistoryKey(r.action_key)}>
                    <History className="mr-1 h-3 w-3" /> History
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
    <PolicyHistorySheet
      tenantId={tenantId}
      actionKey={historyKey}
      canWrite={canWrite}
      onClose={() => setHistoryKey(null)}
    />
    </div>
  );
}

function PolicyHistorySheet({
  tenantId, actionKey, canWrite, onClose,
}: { tenantId: string; actionKey: string | null; canWrite: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listAgentPolicyVersions);
  const rollback = useServerFn(rollbackAgentPolicy);
  const q = useQuery({
    queryKey: ["agent-policy-versions", tenantId, actionKey],
    queryFn: () => list({ data: { tenantId, actionKey: actionKey! } }),
    enabled: !!actionKey,
  });
  const [reason, setReason] = useState("");
  const [pendingRev, setPendingRev] = useState<number | null>(null);

  const doRollback = useMutation({
    mutationFn: (revision: number) => rollback({
      data: { tenantId, actionKey: actionKey!, revision, reason: reason.trim() || undefined },
    }),
    onSuccess: () => {
      toast.success(`Rolled back to revision ${pendingRev}`);
      setReason(""); setPendingRev(null);
      qc.invalidateQueries({ queryKey: ["agent-policies", tenantId] });
      qc.invalidateQueries({ queryKey: ["agent-policy-versions", tenantId, actionKey] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Rollback failed"),
  });

  const versions = (q.data ?? []) as any[];

  return (
    <Sheet open={!!actionKey} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Policy history</SheetTitle>
          <SheetDescription>
            <code className="font-mono">{actionKey}</code> — every revision is captured automatically.
            Roll back to restore any prior ceiling, approver count, or reversibility setting.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {versions.length === 0 && (
            <div className="rounded border bg-muted/30 p-4 text-xs text-muted-foreground">
              No version history yet. The first edit you make will create revision 1.
            </div>
          )}
          {versions.map((v) => (
            <div key={v.id} className="rounded border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Badge>rev {v.revision}</Badge>
                  <span className="font-mono text-xs uppercase">{v.ceiling}</span>
                  <span className="text-xs text-muted-foreground">· {v.required_approvers} approver(s)</span>
                  <span className="text-xs text-muted-foreground">· {v.reversible ? "reversible" : "irreversible"}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canWrite}
                  onClick={() => setPendingRev(v.revision)}
                >
                  <RotateCcw className="mr-1 h-3 w-3" /> Roll back
                </Button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{new Date(v.created_at).toLocaleString()}</span>
                {v.changed_by && <span className="font-mono">· actor:{String(v.changed_by).slice(0, 8)}</span>}
                {v.change_reason && <span>· {v.change_reason}</span>}
              </div>
            </div>
          ))}
          {pendingRev !== null && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3">
              <div className="text-sm font-medium">Confirm rollback to revision {pendingRev}</div>
              <Textarea
                className="mt-2"
                rows={2}
                placeholder="e.g. Demo Bank Internal Audit Q3 — sample 2026-06-26 EOD run"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPendingRev(null)}>Cancel</Button>
                <Button size="sm" disabled={doRollback.isPending} onClick={() => doRollback.mutate(pendingRev!)}>
                  Confirm rollback
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}


function ScopeLimitsCard({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const get = useServerFn(getTenantAgentDefaults);
  const set = useServerFn(setTenantAgentDefaults);
  const q = useQuery({
    queryKey: ["tenant-agent-defaults", tenantId],
    queryFn: () => get({ data: { tenant_id: tenantId } }),
  });
  const [maxActions, setMaxActions] = useState<number>(25);
  const [maxTables, setMaxTables] = useState<number>(3);
  useEffect(() => {
    if (q.data) {
      setMaxActions((q.data as any).agent_max_actions ?? 25);
      setMaxTables((q.data as any).agent_max_distinct_tables ?? 3);
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => set({ data: { tenant_id: tenantId, agent_max_actions: maxActions, agent_max_distinct_tables: maxTables } }),
    onSuccess: () => { toast.success("Scope defaults saved"); qc.invalidateQueries({ queryKey: ["tenant-agent-defaults", tenantId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run-level scope defaults</CardTitle>
        <CardDescription>
          Upper bounds enforced by the gateway for every agent run in this tenant. Individual runs may request smaller
          caps but never larger ones. These caps are independent of the per-action ceilings below.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Max actions / run</div>
          <Input type="number" min={1} max={500} value={maxActions} disabled={!canWrite}
                 onChange={(e) => setMaxActions(Number(e.target.value))} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Max distinct tables touched</div>
          <Input type="number" min={1} max={50} value={maxTables} disabled={!canWrite}
                 onChange={(e) => setMaxTables(Number(e.target.value))} />
        </div>
        <div className="flex items-end">
          <Button disabled={!canWrite || save.isPending} onClick={() => save.mutate()}>Save defaults</Button>
        </div>
      </CardContent>
    </Card>
  );
}
