/**
 * AttestationsPanel — Consolidated SOC 2 evidence + EOD sign-off attestations
 * view for the Scale Console (COO / CISO persona).
 *
 * - SOC 2 controls with latest evidence status
 * - EOD sign-off attestations for the tenant, ready for auditor export
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ShieldCheck, FileText, CheckCircle2 } from "lucide-react";
import { EmptyStateAction } from "@/components/console-header";
import { listSoc2Controls, listSoc2Runs, exportSoc2Bundle } from "@/lib/soc2.functions";
import { listSignoffs } from "@/lib/signoff.functions";
import { toast } from "sonner";

type Control = { id: string; control_code: string; tsc: string; title: string; owner?: string | null };
type Run = { id: string; control_id: string; status: string; collected_at?: string | null; evidence_sha256?: string | null };
type Signoff = { id: string; period_date: string; scope: string; status: string; prepared_at?: string | null; approved_at?: string | null };

const STATUS_TONE: Record<string, string> = {
  passed: "border-emerald-500/40 text-emerald-600",
  approved: "border-emerald-500/40 text-emerald-600",
  prepared: "border-sky-500/40 text-sky-600",
  draft: "border-muted text-muted-foreground",
  failed: "border-rose-500/40 text-rose-600",
  rejected: "border-rose-500/40 text-rose-600",
  warning: "border-amber-500/40 text-amber-600",
};

export function AttestationsPanel({ tenantId, canExport = true }: { tenantId: string; canExport?: boolean }) {
  const lc = useServerFn(listSoc2Controls);
  const lr = useServerFn(listSoc2Runs);
  const ls = useServerFn(listSignoffs);
  const exportFn = useServerFn(exportSoc2Bundle);

  const ctrlQ = useQuery({ queryKey: ["soc2-controls"], queryFn: () => lc() });
  const runsQ = useQuery({ queryKey: ["soc2-runs-90"], queryFn: () => lr({ data: { since_days: 90 } }) });
  const soQ = useQuery({ queryKey: ["signoffs", tenantId], queryFn: () => ls({ data: { tenant_id: tenantId } }) });

  const controls = (ctrlQ.data ?? []) as unknown as Control[];
  const runs = (runsQ.data ?? []) as unknown as Run[];
  const signoffs = (soQ.data ?? []) as unknown as Signoff[];

  const latestByControl = useMemo(() => {
    const m = new Map<string, Run>();
    for (const r of runs) if (!m.has(r.control_id)) m.set(r.control_id, r);
    return m;
  }, [runs]);

  const coverage = controls.length === 0 ? 0 : Math.round((latestByControl.size / controls.length) * 100);
  const passing = Array.from(latestByControl.values()).filter((r) => r.status === "passed").length;
  const approvedSignoffs = signoffs.filter((s) => s.status === "approved").length;

  async function onExport() {
    try {
      const r = await exportFn();
      const blob = new Blob([JSON.stringify(r.bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `soc2-bundle-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Bundle exported · sha256 ${r.sha256.slice(0, 12)}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  }

  const loading = ctrlQ.isLoading || runsQ.isLoading || soQ.isLoading;
  if (loading) return <Skeleton className="h-96 w-full mt-4" />;

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="SOC 2 controls" value={controls.length} hint={`${latestByControl.size} with recent evidence`} />
        <Kpi label="Evidence coverage" value={`${coverage}%`} hint="last 90 days" toneClass={coverage >= 90 ? "text-emerald-600" : coverage >= 70 ? "text-amber-600" : "text-rose-600"} />
        <Kpi label="Passing controls" value={passing} hint={`of ${latestByControl.size} evidenced`} toneClass={passing === latestByControl.size && passing > 0 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Approved sign-offs" value={approvedSignoffs} hint={`${signoffs.length} periods on file`} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                SOC 2 evidence register
              </CardTitle>
              <CardDescription>Latest harvested evidence run per control. Export a signed bundle for auditors.</CardDescription>
            </div>
            <Button size="sm" onClick={onExport} disabled={!canExport} title={!canExport ? "Requires tenant_admin" : ""}>
              <FileText className="h-4 w-4 mr-1" /> Export bundle
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {controls.length === 0 ? (
            <EmptyStateAction title="No SOC 2 controls loaded" description="Seed the soc2_controls catalog before harvesting evidence." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-3">Control</th>
                    <th className="py-1 pr-3">TSC</th>
                    <th className="py-1 pr-3">Title</th>
                    <th className="py-1 pr-3">Owner</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1 pr-3">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {controls.slice(0, 40).map((c) => {
                    const r = latestByControl.get(c.id);
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="py-1 pr-3 font-mono">{c.control_code}</td>
                        <td className="py-1 pr-3">{c.tsc}</td>
                        <td className="py-1 pr-3 truncate max-w-[20rem]">{c.title}</td>
                        <td className="py-1 pr-3">{c.owner ?? "—"}</td>
                        <td className="py-1 pr-3">
                          {r ? (
                            <Badge variant="outline" className={STATUS_TONE[r.status] ?? ""}>{r.status}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">no evidence</Badge>
                          )}
                        </td>
                        <td className="py-1 pr-3 text-muted-foreground">
                          {r?.collected_at ? new Date(r.collected_at).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            EOD sign-off attestations
          </CardTitle>
          <CardDescription>Period-close attestations from preparers and approvers — anchored to the audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          {signoffs.length === 0 ? (
            <EmptyStateAction
              title="No sign-offs yet"
              description="Prepare and approve an EOD period from the Signoffs module to build an attestation trail."
              actions={[{ label: "Open Signoffs", href: `/`}]}
            />
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
              {signoffs.slice(0, 12).map((s) => (
                <div key={s.id} className="rounded border p-2 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono">{s.period_date}</span>
                    <Badge variant="outline" className={STATUS_TONE[s.status] ?? ""}>{s.status}</Badge>
                  </div>
                  <p className="text-muted-foreground">scope: {s.scope}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {s.prepared_at ? `prep ${new Date(s.prepared_at).toLocaleDateString()}` : "—"}
                    {s.approved_at ? ` · appr ${new Date(s.approved_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint, toneClass }: { label: string; value: string | number; hint?: string; toneClass?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold mt-1 ${toneClass ?? ""}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}
