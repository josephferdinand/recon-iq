// Cascade outcome policy + simulation UI.
// Step 2 of Matching Engine v2.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
import { PlayCircle, Layers3, Activity } from "lucide-react";
import {
  listCascadePolicies,
  upsertCascadePolicy,
  runCascadeSimulation,
  listCascadeTelemetry,
} from "@/lib/cascade-policies.functions";

type Pol = Awaited<ReturnType<typeof listCascadePolicies>>[number];

export function CascadePolicyPanel({
  tenantId,
  reconDefinitionId,
  reconRunIdForSim,
}: {
  tenantId: string;
  reconDefinitionId: string;
  reconRunIdForSim?: string;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCascadePolicies);
  const upsertFn = useServerFn(upsertCascadePolicy);
  const simFn = useServerFn(runCascadeSimulation);
  const telFn = useServerFn(listCascadeTelemetry);

  const policies = useQuery({
    queryKey: ["cascade-policies", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId } }),
  });

  const telemetry = useQuery({
    queryKey: ["cascade-telemetry", tenantId],
    queryFn: () => telFn({ data: { tenant_id: tenantId, limit: 20 } }),
  });

  const [draft, setDraft] = useState<{
    name: string;
    passes: string;
    on_match: "stop" | "continue" | "next_pass";
    on_no_match: "stop" | "next_pass" | "escalate";
    carry: boolean;
    max_passes: number;
  }>({
    name: "Default cascade",
    passes: "exact, fuzzy, ml",
    on_match: "stop",
    on_no_match: "next_pass",
    carry: true,
    max_passes: 5,
  });

  const save = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          tenant_id: tenantId,
          recon_definition_id: reconDefinitionId,
          name: draft.name,
          pass_order: draft.passes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          on_match: draft.on_match,
          on_no_match: draft.on_no_match,
          carry_forward_unmatched: draft.carry,
          max_passes: draft.max_passes,
        },
      }),
    onSuccess: () => {
      toast.success("Cascade policy saved");
      qc.invalidateQueries({ queryKey: ["cascade-policies", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sim = useMutation({
    mutationFn: (policyId: string) =>
      simFn({
        data: {
          tenant_id: tenantId,
          policy_id: policyId,
          recon_run_id: reconRunIdForSim ?? policyId, // demo fallback
        },
      }),
    onSuccess: (r: { matches_projected: number; passes_evaluated: number }) =>
      toast.success(
        `Simulation done — ${r.matches_projected} matches projected across ${r.passes_evaluated} passes`,
      ),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers3 className="h-4 w-4" /> Cascade outcome policy
          </CardTitle>
          <CardDescription>
            Decide how each cascade pass feeds the next, and whether unmatched
            items carry forward. Dry-run before promoting to production.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((s) => ({ ...s, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Pass order (comma-separated keys)</Label>
              <Input
                value={draft.passes}
                onChange={(e) =>
                  setDraft((s) => ({ ...s, passes: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>On match</Label>
              <Select
                value={draft.on_match}
                onValueChange={(v) =>
                  setDraft((s) => ({ ...s, on_match: v as typeof draft.on_match }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stop">Stop cascade</SelectItem>
                  <SelectItem value="continue">Continue (allocate more)</SelectItem>
                  <SelectItem value="next_pass">Go to next pass</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>On no-match</Label>
              <Select
                value={draft.on_no_match}
                onValueChange={(v) =>
                  setDraft((s) => ({
                    ...s,
                    on_no_match: v as typeof draft.on_no_match,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stop">Stop (raise exceptions)</SelectItem>
                  <SelectItem value="next_pass">Go to next pass</SelectItem>
                  <SelectItem value="escalate">Escalate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.carry}
                onCheckedChange={(v) => setDraft((s) => ({ ...s, carry: v }))}
              />
              <Label className="text-xs">Carry-forward unmatched to next pass</Label>
            </div>
            <div className="space-y-1">
              <Label>Max passes</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={draft.max_passes}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    max_passes: Number(e.target.value) || 1,
                  }))
                }
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save policy"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Saved policies</CardTitle>
          <CardDescription>
            Simulate any policy against the latest recon run before activating
            it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {(policies.data ?? []).length === 0 && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              No cascade policies yet. Save one above to get started.
            </div>
          )}
          {(policies.data ?? []).map((p: Pol) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {p.max_passes} max passes · {p.on_match}/{p.on_no_match} ·{" "}
                  {p.carry_forward_unmatched ? "carry-fwd" : "no carry"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={p.is_active ? "secondary" : "outline"}>
                  {p.is_active ? "active" : "inactive"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={sim.isPending}
                  onClick={() => sim.mutate(p.id)}
                >
                  <PlayCircle className="mr-1 h-3 w-3" />
                  Simulate
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" /> Cascade telemetry
          </CardTitle>
          <CardDescription>
            Most recent per-pass effectiveness recorded by the matcher.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(telemetry.data ?? []).length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              No telemetry yet — runs with `telemetry_enabled` policies will
              populate this card.
            </div>
          ) : (
            <div className="space-y-1">
              {(telemetry.data ?? []).map((t: any) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-xs"
                >
                  <div className="truncate">
                    <span className="font-medium">
                      Pass #{t.pass_ordinal}
                    </span>{" "}
                    {t.pass_name && (
                      <span className="text-muted-foreground">
                        — {t.pass_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {t.matches_out}/{t.candidates_in} matched
                    </Badge>
                    <Badge variant="secondary">
                      {(Number(t.match_rate ?? 0) * 100).toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
