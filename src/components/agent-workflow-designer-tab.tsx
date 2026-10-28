import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listWorkflows, upsertWorkflow, listWorkflowRuns } from "@/lib/agent-workflows.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Workflow, Save, Play, ArrowRight } from "lucide-react";
import { toast } from "sonner";

type GraphNode = { id: string; role: string; prompt?: string; next: string[] };
type Graph = { entry: string; nodes: GraphNode[] };

const FALCON_STARTER: Graph = {
  entry: "researcher",
  nodes: [
    {
      id: "researcher",
      role: "researcher",
      prompt: "Investigate Demo Bank Nostro break: pull GL entries and counterparty statement lines.",
      next: ["matcher"],
    },
    {
      id: "matcher",
      role: "matcher",
      prompt: "Propose probabilistic matches with confidence ≥ 0.85.",
      next: ["narrator"],
    },
    {
      id: "narrator",
      role: "narrator",
      prompt: "Summarise root cause and write a draft sign-off note.",
      next: ["approver"],
    },
    { id: "approver", role: "approver", prompt: "Human approval required.", next: [] },
  ],
};

export function AgentWorkflowDesignerTab({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listWorkflows);
  const save = useServerFn(upsertWorkflow);
  const runs = useServerFn(listWorkflowRuns);

  const q = useQuery({ queryKey: ["wf", tenantId], queryFn: () => list({ data: { tenantId } }) });

  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    description: string;
    enabled: boolean;
    graphJson: string;
  }>({
    name: "Demo Bank Nostro triage",
    description: "Three-agent pipeline that drafts a sign-off note for Demo Bank EMEA Cash Ops.",
    enabled: false,
    graphJson: JSON.stringify(FALCON_STARTER, null, 2),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const runsQ = useQuery({
    queryKey: ["wf-runs", selectedId],
    queryFn: () => runs({ data: { workflowId: selectedId!, limit: 10 } }),
    enabled: !!selectedId,
  });

  const mSave = useMutation({
    mutationFn: () => {
      let graph: Graph;
      try {
        graph = JSON.parse(editing.graphJson);
      } catch {
        throw new Error("Graph must be valid JSON");
      }
      return save({
        data: {
          id: editing.id,
          tenantId,
          name: editing.name,
          description: editing.description,
          enabled: editing.enabled,
          graph,
        },
      });
    },
    onSuccess: () => {
      toast.success("Workflow saved");
      qc.invalidateQueries({ queryKey: ["wf", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewGraph = useMemo<Graph | null>(() => {
    try {
      return JSON.parse(editing.graphJson);
    } catch {
      return null;
    }
  }, [editing.graphJson]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4" /> Multi-agent workflow designer
          </CardTitle>
          <CardDescription>
            Compose a DAG of role-bound agents. Example for Demo Bank: <em>researcher → matcher → narrator → approver</em>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div className="flex items-end justify-between rounded border p-2">
              <span className="text-sm">Enabled</span>
              <Switch
                checked={editing.enabled}
                onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                disabled={!canWrite}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Input
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="space-y-1">
            <Label>Graph (JSON)</Label>
            <Textarea
              rows={14}
              className="font-mono text-xs"
              value={editing.graphJson}
              onChange={(e) => setEditing({ ...editing, graphJson: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          {previewGraph && (
            <div className="rounded border bg-muted/30 p-3">
              <div className="mb-2 text-xs text-muted-foreground">Pipeline preview</div>
              <div className="flex flex-wrap items-center gap-2">
                {previewGraph.nodes.map((n, i) => (
                  <div key={n.id} className="flex items-center gap-2">
                    <Badge variant={n.id === previewGraph.entry ? "default" : "secondary"}>
                      {n.role}:{n.id}
                    </Badge>
                    {i < previewGraph.nodes.length - 1 && (
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {editing.id && (
              <Button variant="outline" onClick={() => setEditing({ ...editing, id: undefined })}>
                New workflow
              </Button>
            )}
            <Button onClick={() => mSave.mutate()} disabled={!canWrite || mSave.isPending}>
              <Save className="mr-2 h-4 w-4" /> Save workflow
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workflows</CardTitle>
          <CardDescription>Click a workflow to load it or inspect recent runs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(q.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No workflows yet for Demo Bank.</p>
          )}
          {(q.data ?? []).map((w: any) => (
            <div key={w.id} className="rounded border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{w.name}</span>
                    {w.enabled ? <Badge>Enabled</Badge> : <Badge variant="secondary">Disabled</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{w.description}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditing({
                        id: w.id,
                        name: w.name,
                        description: w.description ?? "",
                        enabled: w.enabled,
                        graphJson: JSON.stringify(w.graph, null, 2),
                      })
                    }
                  >
                    Load
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedId(w.id)}>
                    <Play className="mr-1 h-3.5 w-3.5" /> Runs
                  </Button>
                </div>
              </div>
              {selectedId === w.id && (
                <div className="mt-3 rounded bg-muted/30 p-2 text-xs">
                  {runsQ.isLoading && <span className="text-muted-foreground">Loading…</span>}
                  {runsQ.data?.length === 0 && (
                    <span className="text-muted-foreground">No runs yet.</span>
                  )}
                  {(runsQ.data ?? []).map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between border-b py-1 last:border-0">
                      <span>{new Date(r.started_at).toLocaleString()}</span>
                      <Badge variant={r.status === "succeeded" ? "default" : "secondary"}>
                        {r.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
