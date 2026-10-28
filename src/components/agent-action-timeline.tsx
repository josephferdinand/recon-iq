import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAgentActionTimeline, exportAgentActionTimeline } from "@/lib/agent-review.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Sparkles, ShieldCheck, XCircle, RotateCcw, Hash, Download } from "lucide-react";
import { exportCsv, exportPdf, type ExportColumn } from "@/lib/export-utils";


const ICONS: Record<string, any> = {
  plan: Sparkles,
  proposed: FileText,
  approved: ShieldCheck,
  rejected: XCircle,
  reverted: RotateCcw,
};

const COLORS: Record<string, string> = {
  plan: "bg-sky-100 text-sky-800 border-sky-300",
  proposed: "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
  rejected: "bg-rose-100 text-rose-800 border-rose-300",
  reverted: "bg-purple-100 text-purple-800 border-purple-300",
};

export function AgentActionTimeline({ tenantId, actionId }: { tenantId: string; actionId: string }) {
  const fetch = useServerFn(getAgentActionTimeline);
  const exportFn = useServerFn(exportAgentActionTimeline);
  const q = useQuery({
    queryKey: ["agent-action-timeline", actionId],
    queryFn: () => fetch({ data: { tenant_id: tenantId, action_id: actionId } }),
  });

  const buildEventsFromAction = (action: any): any[] => {
    const evs: any[] = [];
    if (action?.run?.created_at) evs.push({ at: action.run.created_at, kind: "plan", label: "Plan recorded by agent", actor: action.run.user_id, payload: { objective: action.run.objective, mode: action.run.mode } });
    evs.push({ at: action.created_at, kind: "proposed", label: `Proposed: ${action.tool}`, payload: { input: action.input, before_state: action.before_state, policy_ceiling: action.policy_ceiling } });
    if (action.status === "approved" || action.status === "completed") evs.push({ at: action.created_at, kind: "approved", label: "Approved & executed", actor: action.approved_by, payload: { reversal_token: action.reversal_token, output: action.output } });
    if (action.status === "rejected") evs.push({ at: action.created_at, kind: "rejected", label: "Rejected", actor: action.approved_by, payload: { reason: action.rejection_reason } });
    if (action.reverted_at) evs.push({ at: action.reverted_at, kind: "reverted", label: "Reverted via reversal token", actor: action.reverted_by, payload: { reversal_token: action.reversal_token } });
    return evs;
  };

  if (q.isLoading) return <div className="p-4 text-xs text-muted-foreground">Loading timeline…</div>;
  if (q.error) return <div className="p-4 text-xs text-destructive">Failed: {(q.error as any).message}</div>;
  const { events, action } = (q.data ?? {}) as any;

  const cols: ExportColumn<any>[] = [
    { key: "kind", header: "Kind" },
    { key: "label", header: "Label" },
    { key: "at", header: "When", value: (e) => (e.at ? new Date(e.at).toISOString() : "") },
    { key: "actor", header: "Actor" },
    { key: "payload", header: "Payload", value: (e) => (e.payload ? JSON.stringify(e.payload) : "") },
  ];
  const evs = (events ?? []) as any[];
  const subtitle =
    `Action ${actionId} · reversal token ${action?.reversal_token ?? "—"} · ${evs.length} event(s)`;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Reversal token:</span>
          <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono">{action?.reversal_token ?? "—"}</code>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm" variant="ghost"
            disabled={evs.length === 0}
            onClick={async () => {
              try {
                const r: any = await exportFn({ data: { tenant_id: tenantId, action_id: actionId, format: "csv" } });
                exportCsv(`agent-action-${actionId}-timeline.csv`, cols, buildEventsFromAction(r.action));
              } catch (e: any) { alert(e?.message ?? "Export forbidden — tenant_admin required"); }
            }}
          >
            <Download className="mr-1 h-3 w-3" /> CSV
          </Button>
          <Button
            size="sm" variant="ghost"
            disabled={evs.length === 0}
            onClick={async () => {
              try {
                const r: any = await exportFn({ data: { tenant_id: tenantId, action_id: actionId, format: "pdf" } });
                exportPdf(`agent-action-${actionId}-timeline.pdf`, "Agent action timeline", subtitle, cols, buildEventsFromAction(r.action));
              } catch (e: any) { alert(e?.message ?? "Export forbidden — tenant_admin required"); }
            }}
          >
            <FileText className="mr-1 h-3 w-3" /> PDF
          </Button>
        </div>
      </div>

      <ol className="relative space-y-3 border-l border-border pl-5">
        {(events ?? []).map((e: any, i: number) => {
          const Icon = ICONS[e.kind] ?? FileText;
          const color = COLORS[e.kind] ?? "bg-muted text-foreground border-border";
          return (
            <li key={i} className="relative">
              <span className={`absolute -left-[26px] flex h-5 w-5 items-center justify-center rounded-full border ${color}`}>
                <Icon className="h-3 w-3" />
              </span>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-[10px] uppercase">{e.kind}</Badge>
                <span className="font-medium">{e.label}</span>
                {e.at && <span className="text-muted-foreground">· {new Date(e.at).toLocaleString()}</span>}
                {e.actor && <span className="font-mono text-[10px] text-muted-foreground">actor:{String(e.actor).slice(0, 8)}</span>}
              </div>
              {e.payload && Object.keys(e.payload).length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
        {(events ?? []).length === 0 && <div className="text-xs text-muted-foreground">No events.</div>}
      </ol>
    </div>
  );
}
