import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Circle, Database, GitBranch, Play, Sparkles } from "lucide-react";
import { listDataSources } from "@/lib/data-sources.functions";
import { listRecons, listRuns } from "@/lib/recons.functions";

export function OnboardingChecklist({ tenantId, aiEnabled }: { tenantId: string; aiEnabled: boolean }) {
  const dsFn = useServerFn(listDataSources);
  const reconsFn = useServerFn(listRecons);
  const runsFn = useServerFn(listRuns);

  const ds = useQuery({ queryKey: ["onb-ds", tenantId], queryFn: () => dsFn({ data: { tenant_id: tenantId } }) });
  const recs = useQuery({ queryKey: ["onb-recs", tenantId], queryFn: () => reconsFn({ data: { tenant_id: tenantId } }) });
  const runs = useQuery({ queryKey: ["onb-runs", tenantId], queryFn: () => runsFn({ data: { tenant_id: tenantId } }) });

  if (ds.isLoading || recs.isLoading || runs.isLoading) {
    return (
      <Card><CardHeader><CardTitle>Getting started</CardTitle></CardHeader>
        <CardContent className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></CardContent>
      </Card>
    );
  }

  const hasDs = (ds.data ?? []).length > 0;
  const hasUpload = (ds.data ?? []).some((d: any) => d.row_count > 0);
  const hasRecon = (recs.data ?? []).length > 0;
  const hasRun = (runs.data ?? []).length > 0;
  const completed = [hasDs, hasUpload, hasRecon, hasRun].filter(Boolean).length;
  const total = 4;

  if (completed === total) return null;

  const steps = [
    { done: hasDs, icon: Database, label: "Create a data source", hint: "Open the Data sources tab → New data source." },
    { done: hasUpload, icon: Database, label: "Upload your first file", hint: "CSV/JSON — we auto-detect the schema and hash the file." },
    { done: hasRecon, icon: GitBranch, label: "Author a rekon", hint: "1-, 2-, or 3-sided. Pick sources and matching rules." },
    { done: hasRun, icon: Play, label: "Run it", hint: "Matches and exceptions land in the Exceptions inbox." },
  ];

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Getting started</CardTitle>
        <CardDescription>
          {completed}/{total} complete · Follow these steps to reconcile your first dataset.
          {!aiEnabled && " AI features can be enabled in Tenant management."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3 rounded-md border bg-background p-3">
              {s.done
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" aria-label="Done" />
                : <Circle className="mt-0.5 h-5 w-5 text-muted-foreground" aria-label="Not done" />}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${s.done ? "line-through opacity-60" : ""}`}>{s.label}</span>
                  {s.done && <Badge variant="outline" className="text-[10px]">Done</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{s.hint}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
