// Exception auto-assignment rules tab (P0 #4)
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Plus, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  listAssignmentRules,
  upsertAssignmentRule,
  deleteAssignmentRule,
} from "@/lib/assignment-rules.functions";

const STRATEGIES = [
  { value: "round_robin", label: "Round-robin" },
  { value: "load_balanced", label: "Load-balanced (least open)" },
  { value: "by_severity", label: "By severity" },
  { value: "by_tag", label: "By tag" },
];

export function AssignmentRulesTab({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listAssignmentRules);
  const upsert = useServerFn(upsertAssignmentRule);
  const del = useServerFn(deleteAssignmentRule);

  const q = useQuery({
    queryKey: ["assignment-rules", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId } }),
  });

  const mUpsert = useMutation({
    mutationFn: (r: any) => upsert({ data: r }),
    onSuccess: (_row, vars: any) => {
      qc.invalidateQueries({ queryKey: ["assignment-rules", tenantId] });
      if (!vars?.id) toast.success("Rule added");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save rule"),
  });
  const mDel = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignment-rules", tenantId] });
      toast.success("Removed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to remove"),
  });

  const [newName, setNewName] = useState("");

  const addRule = () => {
    const name = newName.trim();
    if (!name || mUpsert.isPending) return;
    mUpsert.mutate({
      tenant_id: tenantId,
      name,
      strategy: "round_robin",
      assignee_pool: [],
      tag_routes: {},
      severity_routes: {},
      enabled: true,
    });
    setNewName("");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Exception auto-assignment
          </CardTitle>
          <CardDescription>
            Route new exceptions to the right analyst automatically. Round-robin
            keeps the queue fair; load-balanced sends the next break to whoever
            has fewest open items.
          </CardDescription>
        </CardHeader>
        {canWrite && (
          <CardContent className="border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Rule name, e.g. Demo Bank EMEA Cash Ops — round-robin"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRule();
                  }
                }}
                className="max-w-md"
              />
              <Button onClick={addRule} disabled={mUpsert.isPending || !newName.trim()}>
                <Plus className="mr-2 h-4 w-4" />
                {mUpsert.isPending ? "Adding…" : "Add rule"}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <div className="space-y-3">
        {(q.data ?? []).map((r: any) => (
          <Card key={r.id}>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-md"
                  value={r.name}
                  onChange={(e) =>
                    mUpsert.mutate({ ...r, name: e.target.value })
                  }
                  disabled={!canWrite}
                />
                <Select
                  value={r.strategy}
                  onValueChange={(v) => mUpsert.mutate({ ...r, strategy: v })}
                  disabled={!canWrite}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STRATEGIES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Switch
                  checked={r.enabled}
                  onCheckedChange={(v) =>
                    mUpsert.mutate({ ...r, enabled: v })
                  }
                  disabled={!canWrite}
                />
                <Badge variant="outline">
                  Pool {(r.assignee_pool ?? []).length} · cursor{" "}
                  {r.last_assigned_index ?? 0}
                </Badge>
                {canWrite && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => mDel.mutate(r.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div>
                <Label className="text-xs">
                  Assignee pool (user IDs, comma-separated)
                </Label>
                <Input
                  className="font-mono text-xs"
                  value={(r.assignee_pool ?? []).join(",")}
                  onChange={(e) =>
                    mUpsert.mutate({
                      ...r,
                      assignee_pool: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  disabled={!canWrite}
                  placeholder="11111111-1111-1111-1111-111111111111, 22222222-..."
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Tip: paste user IDs from <em>Tenant → Members</em>. Demo Bank
                  uses one rule per recon family (Nostro, Securities, GL).
                </p>
              </div>
              {r.strategy === "by_severity" && (
                <div>
                  <Label className="text-xs">
                    Severity routes (JSON: {"{ critical: userId, high: ... }"})
                  </Label>
                  <Input
                    className="font-mono text-xs"
                    value={JSON.stringify(r.severity_routes ?? {})}
                    onChange={(e) => {
                      try {
                        mUpsert.mutate({
                          ...r,
                          severity_routes: JSON.parse(e.target.value || "{}"),
                        });
                      } catch {
                        /* ignore */
                      }
                    }}
                    disabled={!canWrite}
                  />
                </div>
              )}
              {r.strategy === "by_tag" && (
                <div>
                  <Label className="text-xs">
                    Tag routes (JSON: {"{ nostro: userId, fx: ... }"})
                  </Label>
                  <Input
                    className="font-mono text-xs"
                    value={JSON.stringify(r.tag_routes ?? {})}
                    onChange={(e) => {
                      try {
                        mUpsert.mutate({
                          ...r,
                          tag_routes: JSON.parse(e.target.value || "{}"),
                        });
                      } catch {
                        /* ignore */
                      }
                    }}
                    disabled={!canWrite}
                  />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                <Sparkles className="mr-1 inline h-3 w-3" />
                Use this rule from the Exceptions tab → <strong>Auto-assign
                selected</strong> bulk action.
              </p>
            </CardContent>
          </Card>
        ))}
        {(q.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            No rules yet. Suggested Demo Bank baseline:{" "}
            <strong>Cash Ops EMEA</strong> (round-robin),{" "}
            <strong>Securities</strong> (load-balanced),{" "}
            <strong>Critical breaks</strong> (by-severity → senior controller).
          </p>
        )}
      </div>
    </div>
  );
}
