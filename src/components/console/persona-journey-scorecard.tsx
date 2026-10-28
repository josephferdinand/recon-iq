import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPersonaJourneys } from "@/lib/enterprise-transformation.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
  id: string;
  surface: string;
  persona: string;
  expected: string;
  status: string;
  priority: string;
  gap_notes: string | null;
};

function priorityVariant(p: string) {
  if (p === "P0") return "destructive" as const;
  if (p === "P1") return "default" as const;
  return "secondary" as const;
}

export function PersonaJourneyScorecard() {
  const fn = useServerFn(listPersonaJourneys);
  const q = useQuery({ queryKey: ["persona-journeys"], queryFn: () => fn() });

  const grouped = useMemo(() => {
    const rows: Row[] = (q.data?.rows as Row[] | undefined) ?? [];
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const arr = map.get(r.surface) ?? [];
      arr.push(r);
      map.set(r.surface, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [q.data]);

  const total = q.data?.rows?.length ?? 0;
  const p0 = (q.data?.rows as Row[] | undefined)?.filter((r) => r.priority === "P0" && r.status !== "ok").length ?? 0;
  const open = (q.data?.rows as Row[] | undefined)?.filter((r) => r.status !== "ok").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Tracked persona expectations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-foreground">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Open gaps</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-foreground">{open}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">P0 open</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-destructive">{p0}</div>
          </CardContent>
        </Card>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No persona journeys tracked yet. Batch-1 seed pending.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(([surface, rows]) => (
            <Card key={surface}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{surface}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-foreground">{r.expected}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.persona} · {r.gap_notes ?? ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={priorityVariant(r.priority)}>{r.priority}</Badge>
                        <Badge variant={r.status === "ok" ? "secondary" : "outline"}>{r.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
