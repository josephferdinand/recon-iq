import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getResilienceTier,
  upsertResilienceTier,
  listDrDrills,
  createDrDrill,
  recordDrillEvidence,
  listMaintenanceWindows,
  upsertMaintenanceWindow,
  listChangeFreezes,
  upsertChangeFreeze,
  listTenantSloSnapshots,
} from "@/lib/resilience.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Activity,
  Calendar,
  ShieldAlert,
  Snowflake,
  Zap,
} from "lucide-react";

interface Props {
  tenantId: string;
  isPlatformAdmin?: boolean;
}

const TIERS = ["standard", "premium", "platinum", "mission_critical"] as const;
const STRATEGIES = ["manual", "assisted", "automatic"] as const;

export function ResilienceTab({ tenantId, isPlatformAdmin = false }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Operational Resilience
          </h2>
          <p className="text-sm text-muted-foreground">
            DORA / OCC-grade controls: RPO/RTO targets, DR drills, maintenance
            windows, change freezes, per-tenant SLOs.
          </p>
        </div>
      </div>

      <Tabs defaultValue="tier">
        <TabsList>
          <TabsTrigger value="tier">
            <Zap className="mr-2 h-4 w-4" />
            Resilience Tier
          </TabsTrigger>
          <TabsTrigger value="drills">
            <ShieldAlert className="mr-2 h-4 w-4" />
            DR / Chaos Drills
          </TabsTrigger>
          <TabsTrigger value="maintenance">
            <Calendar className="mr-2 h-4 w-4" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="freeze">
            <Snowflake className="mr-2 h-4 w-4" />
            Change Freeze
          </TabsTrigger>
          <TabsTrigger value="slo">
            <Activity className="mr-2 h-4 w-4" />
            Tenant SLO
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tier" className="mt-4">
          <TierPanel tenantId={tenantId} canWrite={isPlatformAdmin} />
        </TabsContent>
        <TabsContent value="drills" className="mt-4">
          <DrillsPanel tenantId={tenantId} canWrite={isPlatformAdmin} />
        </TabsContent>
        <TabsContent value="maintenance" className="mt-4">
          <MaintenancePanel tenantId={tenantId} canWrite={isPlatformAdmin} />
        </TabsContent>
        <TabsContent value="freeze" className="mt-4">
          <FreezePanel tenantId={tenantId} canWrite={isPlatformAdmin} />
        </TabsContent>
        <TabsContent value="slo" className="mt-4">
          <SloPanel tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Tier ----------
function TierPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getResilienceTier);
  const upsertFn = useServerFn(upsertResilienceTier);
  const { data: tier } = useQuery({
    queryKey: ["resilience-tier", tenantId],
    queryFn: () => getFn({ data: { tenantId } }),
  });

  const [form, setForm] = useState({
    tier: (tier?.tier as (typeof TIERS)[number]) ?? "standard",
    rpoSeconds: tier?.rpo_seconds ?? 900,
    rtoSeconds: tier?.rto_seconds ?? 3600,
    primaryRegion: tier?.primary_region ?? "us-east-1",
    secondaryRegion: tier?.secondary_region ?? "",
    activeActive: tier?.active_active ?? false,
    failoverStrategy:
      (tier?.failover_strategy as (typeof STRATEGIES)[number]) ?? "manual",
    notes: tier?.notes ?? "",
  });

  async function save() {
    try {
      await upsertFn({
        data: {
          tenantId,
          ...form,
          secondaryRegion: form.secondaryRegion || null,
          notes: form.notes || null,
        },
      });
      toast.success("Resilience tier saved");
      qc.invalidateQueries({ queryKey: ["resilience-tier", tenantId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Tier & RPO/RTO targets</span>
          {tier?.tier && (
            <Badge variant="outline" className="uppercase">
              {tier.tier.replace("_", " ")}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Tier</Label>
          <Select
            value={form.tier}
            onValueChange={(v) =>
              setForm({ ...form, tier: v as (typeof TIERS)[number] })
            }
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Failover strategy</Label>
          <Select
            value={form.failoverStrategy}
            onValueChange={(v) =>
              setForm({
                ...form,
                failoverStrategy: v as (typeof STRATEGIES)[number],
              })
            }
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>RPO (seconds)</Label>
          <Input
            type="number"
            value={form.rpoSeconds}
            onChange={(e) =>
              setForm({ ...form, rpoSeconds: Number(e.target.value) })
            }
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>RTO (seconds)</Label>
          <Input
            type="number"
            value={form.rtoSeconds}
            onChange={(e) =>
              setForm({ ...form, rtoSeconds: Number(e.target.value) })
            }
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Primary region</Label>
          <Input
            value={form.primaryRegion}
            onChange={(e) => setForm({ ...form, primaryRegion: e.target.value })}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Secondary region</Label>
          <Input
            value={form.secondaryRegion ?? ""}
            onChange={(e) =>
              setForm({ ...form, secondaryRegion: e.target.value })
            }
            disabled={!canWrite}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={form.activeActive}
            onCheckedChange={(v) => setForm({ ...form, activeActive: v })}
            disabled={!canWrite}
          />
          <Label>Active-active multi-region</Label>
        </div>
        <div className="md:col-span-2">
          <Label>Notes</Label>
          <Textarea
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            disabled={!canWrite}
          />
        </div>
        <div className="md:col-span-2 flex justify-end">
          <Button onClick={save} disabled={!canWrite}>
            Save tier
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Drills ----------
function DrillsPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listDrDrills);
  const createFn = useServerFn(createDrDrill);
  const recordFn = useServerFn(recordDrillEvidence);
  const { data: drills = [] } = useQuery({
    queryKey: ["dr-drills", tenantId],
    queryFn: () => listFn({ data: { tenantId } }),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    drillType: "failover" as const,
    title: "",
    description: "",
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
    targetRpoSeconds: 900,
    targetRtoSeconds: 3600,
  });

  async function submit() {
    try {
      await createFn({
        data: {
          tenantId,
          drillType: form.drillType,
          title: form.title,
          description: form.description || null,
          scheduledAt: new Date(form.scheduledAt).toISOString(),
          targetRpoSeconds: form.targetRpoSeconds,
          targetRtoSeconds: form.targetRtoSeconds,
        },
      });
      toast.success("DR drill scheduled");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["dr-drills", tenantId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>DR / Chaos drill schedule</span>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Schedule drill</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Schedule DR / chaos drill</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Type</Label>
                    <Select
                      value={form.drillType}
                      onValueChange={(v) =>
                        setForm({
                          ...form,
                          drillType: v as typeof form.drillType,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          "failover",
                          "chaos",
                          "backup_restore",
                          "tabletop",
                          "region_evac",
                          "data_corruption",
                        ].map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label>Scheduled at</Label>
                      <Input
                        type="datetime-local"
                        value={form.scheduledAt}
                        onChange={(e) =>
                          setForm({ ...form, scheduledAt: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>Target RPO (s)</Label>
                      <Input
                        type="number"
                        value={form.targetRpoSeconds}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            targetRpoSeconds: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Target RTO (s)</Label>
                      <Input
                        type="number"
                        value={form.targetRtoSeconds}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            targetRtoSeconds: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={submit} disabled={!form.title}>
                    Schedule
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {drills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No drills scheduled yet.
          </p>
        ) : (
          <div className="space-y-2">
            {drills.map((d) => (
              <DrillRow
                key={d.id}
                drill={d}
                canWrite={canWrite}
                onRecord={async (input) => {
                  await recordFn({
                    data: { drillId: d.id, ...input },
                  });
                  toast.success("Drill evidence recorded");
                  qc.invalidateQueries({ queryKey: ["dr-drills", tenantId] });
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DrillRow({
  drill,
  canWrite,
  onRecord,
}: {
  drill: Awaited<ReturnType<typeof listDrDrills>>[number];
  canWrite: boolean;
  onRecord: (input: {
    status: "in_progress" | "passed" | "failed" | "cancelled";
    observedRpoSeconds?: number;
    observedRtoSeconds?: number;
    evidenceUrl?: string;
    evidenceSha256?: string;
    findings?: string;
    remediation?: string;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState({
    status: "passed" as "in_progress" | "passed" | "failed" | "cancelled",
    observedRpoSeconds: drill.target_rpo_seconds ?? 0,
    observedRtoSeconds: drill.target_rto_seconds ?? 0,
    evidenceUrl: "",
    evidenceSha256: "",
    findings: "",
    remediation: "",
  });

  const statusColor: Record<string, string> = {
    scheduled: "outline",
    in_progress: "secondary",
    passed: "default",
    failed: "destructive",
    cancelled: "outline",
  };

  return (
    <div className="flex items-start justify-between rounded-md border p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant={statusColor[drill.status] as never}>
            {drill.status}
          </Badge>
          <span className="font-medium">{drill.title}</span>
          <span className="text-xs text-muted-foreground">
            {drill.drill_type}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Scheduled {new Date(drill.scheduled_at).toLocaleString()}
        </p>
        {drill.observed_rpo_seconds != null && (
          <p className="text-xs">
            Observed RPO {drill.observed_rpo_seconds}s · RTO{" "}
            {drill.observed_rto_seconds}s
          </p>
        )}
      </div>
      {canWrite && drill.status !== "passed" && drill.status !== "cancelled" && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              Record evidence
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record drill evidence</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Status</Label>
                <Select
                  value={evidence.status}
                  onValueChange={(v) =>
                    setEvidence({
                      ...evidence,
                      status: v as typeof evidence.status,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="passed">Passed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Observed RPO (s)</Label>
                  <Input
                    type="number"
                    value={evidence.observedRpoSeconds}
                    onChange={(e) =>
                      setEvidence({
                        ...evidence,
                        observedRpoSeconds: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Observed RTO (s)</Label>
                  <Input
                    type="number"
                    value={evidence.observedRtoSeconds}
                    onChange={(e) =>
                      setEvidence({
                        ...evidence,
                        observedRtoSeconds: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>Evidence URL</Label>
                <Input
                  value={evidence.evidenceUrl}
                  onChange={(e) =>
                    setEvidence({ ...evidence, evidenceUrl: e.target.value })
                  }
                  placeholder="https://..."
                />
              </div>
              <div>
                <Label>Evidence SHA-256</Label>
                <Input
                  value={evidence.evidenceSha256}
                  onChange={(e) =>
                    setEvidence({
                      ...evidence,
                      evidenceSha256: e.target.value,
                    })
                  }
                  placeholder="64-hex chars"
                />
              </div>
              <div>
                <Label>Findings</Label>
                <Textarea
                  value={evidence.findings}
                  onChange={(e) =>
                    setEvidence({ ...evidence, findings: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Remediation</Label>
                <Textarea
                  value={evidence.remediation}
                  onChange={(e) =>
                    setEvidence({ ...evidence, remediation: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={async () => {
                  await onRecord(evidence);
                  setOpen(false);
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------- Maintenance ----------
function MaintenancePanel({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMaintenanceWindows);
  const upsertFn = useServerFn(upsertMaintenanceWindow);
  const { data: rows = [] } = useQuery({
    queryKey: ["maintenance-windows", tenantId],
    queryFn: () => listFn({ data: { tenantId } }),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    scope: "tenant" as "platform" | "tenant" | "region" | "component",
    title: "",
    description: "",
    startsAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
    endsAt: new Date(Date.now() + 90_000_000).toISOString().slice(0, 16),
    impact: "minor" as "none" | "minor" | "major" | "full_outage",
    status: "scheduled" as "scheduled" | "in_progress" | "completed" | "cancelled",
    notifyCustomers: true,
  });

  async function submit() {
    try {
      await upsertFn({
        data: {
          tenantId: form.scope === "platform" ? null : tenantId,
          scope: form.scope,
          title: form.title,
          description: form.description || null,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          impact: form.impact,
          status: form.status,
          notifyCustomers: form.notifyCustomers,
        },
      });
      toast.success("Maintenance window saved");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["maintenance-windows", tenantId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Maintenance window calendar</span>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Add window</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Schedule maintenance window</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Scope</Label>
                      <Select
                        value={form.scope}
                        onValueChange={(v) =>
                          setForm({ ...form, scope: v as typeof form.scope })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["platform", "tenant", "region", "component"].map(
                            (s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Impact</Label>
                      <Select
                        value={form.impact}
                        onValueChange={(v) =>
                          setForm({
                            ...form,
                            impact: v as typeof form.impact,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["none", "minor", "major", "full_outage"].map((i) => (
                            <SelectItem key={i} value={i}>
                              {i.replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Starts at</Label>
                      <Input
                        type="datetime-local"
                        value={form.startsAt}
                        onChange={(e) =>
                          setForm({ ...form, startsAt: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>Ends at</Label>
                      <Input
                        type="datetime-local"
                        value={form.endsAt}
                        onChange={(e) =>
                          setForm({ ...form, endsAt: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.notifyCustomers}
                      onCheckedChange={(v) =>
                        setForm({ ...form, notifyCustomers: v })
                      }
                    />
                    <Label>Notify customers</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={submit} disabled={!form.title}>
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No windows scheduled.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{w.scope}</Badge>
                    <Badge
                      variant={
                        w.impact === "full_outage"
                          ? "destructive"
                          : w.impact === "major"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {w.impact.replace("_", " ")}
                    </Badge>
                    <span className="font-medium">{w.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(w.starts_at).toLocaleString()} —{" "}
                    {new Date(w.ends_at).toLocaleString()}
                  </p>
                </div>
                <Badge variant="outline">{w.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Change freeze ----------
function FreezePanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listChangeFreezes);
  const upsertFn = useServerFn(upsertChangeFreeze);
  const { data: rows = [] } = useQuery({
    queryKey: ["change-freezes", tenantId],
    queryFn: () => listFn({ data: { tenantId } }),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    scope: "tenant" as "platform" | "tenant",
    reason: "",
    startsAt: new Date().toISOString().slice(0, 16),
    endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16),
    blocksDeploys: true,
    blocksConfigChanges: true,
    blocksSchemaChanges: true,
    breakGlassRole: "platform_admin",
    active: true,
  });

  async function submit() {
    try {
      await upsertFn({
        data: {
          tenantId: form.scope === "platform" ? null : tenantId,
          scope: form.scope,
          reason: form.reason,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          blocksDeploys: form.blocksDeploys,
          blocksConfigChanges: form.blocksConfigChanges,
          blocksSchemaChanges: form.blocksSchemaChanges,
          breakGlassRole: form.breakGlassRole || null,
          active: form.active,
        },
      });
      toast.success("Change freeze saved");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["change-freezes", tenantId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const now = Date.now();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Change-freeze windows</span>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Declare freeze</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Declare change freeze</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Scope</Label>
                    <Select
                      value={form.scope}
                      onValueChange={(v) =>
                        setForm({ ...form, scope: v as typeof form.scope })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="platform">platform</SelectItem>
                        <SelectItem value="tenant">tenant</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Reason</Label>
                    <Textarea
                      value={form.reason}
                      onChange={(e) =>
                        setForm({ ...form, reason: e.target.value })
                      }
                      placeholder="e.g. Year-end close 2026"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Starts at</Label>
                      <Input
                        type="datetime-local"
                        value={form.startsAt}
                        onChange={(e) =>
                          setForm({ ...form, startsAt: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>Ends at</Label>
                      <Input
                        type="datetime-local"
                        value={form.endsAt}
                        onChange={(e) =>
                          setForm({ ...form, endsAt: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.blocksDeploys}
                        onCheckedChange={(v) =>
                          setForm({ ...form, blocksDeploys: v })
                        }
                      />
                      <Label>Block deploys</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.blocksConfigChanges}
                        onCheckedChange={(v) =>
                          setForm({ ...form, blocksConfigChanges: v })
                        }
                      />
                      <Label>Block config changes</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.blocksSchemaChanges}
                        onCheckedChange={(v) =>
                          setForm({ ...form, blocksSchemaChanges: v })
                        }
                      />
                      <Label>Block schema changes</Label>
                    </div>
                  </div>
                  <div>
                    <Label>Break-glass role</Label>
                    <Input
                      value={form.breakGlassRole}
                      onChange={(e) =>
                        setForm({ ...form, breakGlassRole: e.target.value })
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={submit} disabled={!form.reason}>
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No freezes declared.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((f) => {
              const start = new Date(f.starts_at).getTime();
              const end = new Date(f.ends_at).getTime();
              const isActive = f.active && now >= start && now <= end;
              return (
                <div
                  key={f.id}
                  className="flex items-start justify-between rounded-md border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isActive ? "destructive" : "outline"}>
                        {isActive ? "ACTIVE" : f.active ? "scheduled" : "off"}
                      </Badge>
                      <Badge variant="outline">{f.scope}</Badge>
                      <span className="font-medium">{f.reason}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(f.starts_at).toLocaleString()} —{" "}
                      {new Date(f.ends_at).toLocaleString()}
                    </p>
                    <p className="text-xs">
                      Blocks: {[
                        f.blocks_deploys && "deploys",
                        f.blocks_config_changes && "config",
                        f.blocks_schema_changes && "schema",
                      ]
                        .filter(Boolean)
                        .join(", ") || "nothing"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- SLO ----------
function SloPanel({ tenantId }: { tenantId: string }) {
  const listFn = useServerFn(listTenantSloSnapshots);
  const { data: rows = [] } = useQuery({
    queryKey: ["tenant-slo", tenantId],
    queryFn: () => listFn({ data: { tenantId, hours: 24 } }),
  });

  const latest = rows[rows.length - 1];
  const avgUptime =
    rows.length > 0
      ? (
          rows.reduce((s, r) => s + Number(r.uptime_pct ?? 100), 0) / rows.length
        ).toFixed(3)
      : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-tenant SLO (last 24h)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Current status" value={latest?.status ?? "operational"} />
          <Metric label="Avg uptime" value={`${avgUptime}%`} />
          <Metric
            label="p95 latency"
            value={latest?.p95_latency_ms ? `${latest.p95_latency_ms} ms` : "—"}
          />
          <Metric
            label="Error budget"
            value={
              latest?.error_budget_remaining_pct != null
                ? `${latest.error_budget_remaining_pct}%`
                : "—"
            }
          />
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No SLO snapshots ingested for this tenant yet. The platform SLO
            collector populates this hourly.
          </p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Bucket</th>
                  <th className="p-2">Uptime %</th>
                  <th className="p-2">p50</th>
                  <th className="p-2">p95</th>
                  <th className="p-2">p99</th>
                  <th className="p-2">Errors %</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .reverse()
                  .map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">
                        {new Date(r.bucket_start).toLocaleString()}
                      </td>
                      <td className="p-2">{r.uptime_pct}</td>
                      <td className="p-2">{r.p50_latency_ms ?? "—"}</td>
                      <td className="p-2">{r.p95_latency_ms ?? "—"}</td>
                      <td className="p-2">{r.p99_latency_ms ?? "—"}</td>
                      <td className="p-2">{r.error_rate_pct}</td>
                      <td className="p-2">{r.status}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
