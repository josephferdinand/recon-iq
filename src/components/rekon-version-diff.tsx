import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listDefinitionVersions } from "@/lib/gtm.functions";
import { compareReconVersions } from "@/lib/rekon-wizard.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitCompare, History, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function RekonVersionDiffDialog({
  reconDefinitionId, reconName, trigger,
}: { reconDefinitionId: string; reconName: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitCompare className="h-5 w-5 text-primary" /> Version history — {reconName}</DialogTitle>
            <DialogDescription>Pick any two versions to see exactly what changed between them.</DialogDescription>
          </DialogHeader>
          <DiffBody reconDefinitionId={reconDefinitionId} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DiffBody({ reconDefinitionId }: { reconDefinitionId: string }) {
  const list = useServerFn(listDefinitionVersions);
  const cmp = useServerFn(compareReconVersions);
  const versions = useQuery({
    queryKey: ["recon-versions", reconDefinitionId],
    queryFn: () => list({ data: { recon_definition_id: reconDefinitionId } }),
  });
  const rows = (versions.data ?? []) as any[];
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);

  useMemo(() => {
    if (rows.length >= 2 && a === null && b === null) {
      setA(rows[1].version_number);
      setB(rows[0].version_number);
    } else if (rows.length === 1 && a === null) {
      setA(rows[0].version_number);
      setB(rows[0].version_number);
    }
  }, [rows]);

  const diff = useQuery({
    queryKey: ["recon-version-diff", reconDefinitionId, a, b],
    queryFn: () => cmp({ data: { recon_definition_id: reconDefinitionId, version_a: a!, version_b: b! } }),
    enabled: a !== null && b !== null,
  });

  if (versions.isLoading) return <p className="text-sm text-muted-foreground">Loading versions…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No versions yet for this reconciliation. Versions are created automatically when you edit the ReconIQ recon definition.</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Compare</span>
            <Select value={a?.toString() ?? ""} onValueChange={(v) => setA(Number(v))}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="e.g. v12 (Demo Bank Nostro USD — pre-tolerance change)" /></SelectTrigger>
              <SelectContent>
                {rows.map((r) => (
                  <SelectItem key={r.id} value={String(r.version_number)}>
                    v{r.version_number} · {new Date(r.created_at).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Select value={b?.toString() ?? ""} onValueChange={(v) => setB(Number(v))}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="e.g. v13 (Demo Bank Nostro USD — post-tolerance change)" /></SelectTrigger>
              <SelectContent>
                {rows.map((r) => (
                  <SelectItem key={r.id} value={String(r.version_number)}>
                    v{r.version_number} · {new Date(r.created_at).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {diff.isLoading && <p className="text-sm text-muted-foreground">Computing diff…</p>}
      {diff.error && <p className="text-sm text-destructive">{(diff.error as any).message}</p>}
      {diff.data && <DiffView d={diff.data as any} />}
    </div>
  );
}

function DiffView({ d }: { d: any }) {
  const Pill = ({ n, label, tone }: { n: number; label: string; tone: string }) => (
    <div className={cn("rounded-md border px-3 py-2 text-xs", tone)}>
      <div className="font-mono text-base font-semibold">{n}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        <Pill n={d.summary.scalars_changed} label="Fields changed" tone="border-amber-300 bg-amber-50 text-amber-900" />
        <Pill n={d.summary.sides_changed} label="Connectors changed" tone="border-sky-300 bg-sky-50 text-sky-900" />
        <Pill n={d.summary.mappings_changed} label="Mappings changed" tone="border-violet-300 bg-violet-50 text-violet-900" />
        <Pill n={d.summary.keys_changed} label="Keys added/removed" tone="border-emerald-300 bg-emerald-50 text-emerald-900" />
      </div>

      <Section title="Scalars">
        <table className="w-full text-xs">
          <thead className="bg-muted/40"><tr><th className="text-left px-3 py-1">Field</th><th className="text-left px-3 py-1">v{d.a.version_number}</th><th className="text-left px-3 py-1">v{d.b.version_number}</th></tr></thead>
          <tbody>
            {d.scalars.map((s: any) => (
              <tr key={s.field} className={cn("border-t", s.changed && "bg-amber-50")}>
                <td className="px-3 py-1 font-mono">{s.field}</td>
                <td className="px-3 py-1 font-mono">{fmt(s.before)}</td>
                <td className="px-3 py-1 font-mono">{fmt(s.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Keys">
        <div className="p-3 text-xs space-y-1">
          {d.keys_added.length > 0 && <div><Badge className="mr-2 bg-emerald-600">+ added</Badge><span className="font-mono">{d.keys_added.join(", ")}</span></div>}
          {d.keys_removed.length > 0 && <div><Badge variant="destructive" className="mr-2">− removed</Badge><span className="font-mono">{d.keys_removed.join(", ")}</span></div>}
          {d.keys_added.length === 0 && d.keys_removed.length === 0 && <span className="text-muted-foreground">No key changes</span>}
        </div>
      </Section>

      <Section title="Connectors (sides)">
        <table className="w-full text-xs">
          <thead className="bg-muted/40"><tr><th className="text-left px-3 py-1">Side</th><th className="text-left px-3 py-1">v{d.a.version_number}</th><th className="text-left px-3 py-1">v{d.b.version_number}</th></tr></thead>
          <tbody>
            {d.sides.map((s: any) => (
              <tr key={s.side_id} className={cn("border-t", s.changed && "bg-sky-50")}>
                <td className="px-3 py-1 font-mono">{s.side_id}</td>
                <td className="px-3 py-1">{s.before ? <ConnSpec s={s.before} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-1">{s.after ? <ConnSpec s={s.after} /> : <span className="text-muted-foreground">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`Mappings (${d.mappings.filter((m: any) => m.changed).length} changed)`}>
        <ScrollArea className="max-h-[300px]">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 sticky top-0">
              <tr><th className="text-left px-3 py-1">Field</th><th className="text-left px-3 py-1">v{d.a.version_number}</th><th className="text-left px-3 py-1">v{d.b.version_number}</th></tr>
            </thead>
            <tbody>
              {d.mappings.map((m: any) => (
                <tr key={m.field} className={cn("border-t", m.changed && "bg-violet-50")}>
                  <td className="px-3 py-1 font-mono">{m.field}</td>
                  <td className="px-3 py-1 font-mono">{m.before ? Object.entries(m.before).map(([k, v]) => `${k}=${v || "—"}`).join(" · ") : "—"}</td>
                  <td className="px-3 py-1 font-mono">{m.after ? Object.entries(m.after).map(([k, v]) => `${k}=${v || "—"}`).join(" · ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="px-3 py-2 border-b text-sm font-semibold">{title}</div>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}
function ConnSpec({ s }: { s: any }) {
  return <span className="font-mono"><Badge variant="outline" className="mr-1 text-[10px]">{s.source_type}</Badge>{s.ref_id ?? "(inline)"}</span>;
}
function fmt(v: any) { if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">∅</span>; return String(v); }
