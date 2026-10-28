import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  approveCollateralVmCall,
  calculateCollateralVmCall,
  createCollateralCsaDraft,
  decideCollateralCsaVersion,
  disputeCollateralVmCall,
  listCollateralCsaLifecycle,
  recordCollateralVmSettlement,
  resolveCollateralVmDispute,
  submitCollateralCsaVersion,
} from "@/lib/collateral-csa.functions";
import { listCollateralSchedules, upsertCollateralSchedule } from "@/lib/recon-templates.functions";
import { USER_FACING_ERRORS, userFacingErrorKind } from "@/lib/user-facing-errors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Shield, RefreshCw } from "lucide-react";

type Agreement = {
  id: string;
  agreement_key: string;
  own_legal_entity: string;
  counterparty: string;
  currency: string;
};
type Version = {
  id: string;
  agreement_id: string;
  version_no: number;
  status: string;
  threshold_amount: string;
  minimum_transfer: string;
  rounding_increment: string;
  effective_from: string;
  effective_to: string | null;
  created_by: string;
  submitted_by: string | null;
};
type Call = {
  id: string;
  agreement_id: string;
  version_id: string;
  valuation_date: string;
  calculated_at: string;
  calculated_by: string;
  gross_exposure: string;
  eligible_collateral_held: string;
  net_exposure: string;
  call_amount: string;
  direction: string;
  status: string;
  settled_amount: string;
  approved_by: string | null;
};
type Dispute = {
  id: string;
  call_id: string;
  disputed_amount: string;
  reason: string;
  raised_by: string;
  resolved_at: string | null;
};
type Settlement = {
  id: string;
  call_id: string;
  amount: string;
  settled_at: string;
  settlement_reference: string;
};
type CollateralSchedule = {
  id: string;
  counterparty: string;
  csa_id: string | null;
  schedule_type: string;
  threshold_amount: number;
  minimum_transfer: number;
  rounding: number;
};
type Lifecycle = {
  agreements: Agreement[];
  versions: Version[];
  calls: Call[];
  disputes: Dispute[];
  settlements: Settlement[];
  current_user_id: string;
};

function reportSafeError(error: unknown) {
  const kind = userFacingErrorKind(error);
  const copy = USER_FACING_ERRORS[kind];
  toast.error(copy.title, { description: `${copy.message} ${copy.action}` });
}

function money(value: string | number, currency?: string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `${currency ? `${currency} ` : ""}${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
    : "Unavailable";
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function CollateralTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listScheduleFn = useServerFn(listCollateralSchedules);
  const saveScheduleFn = useServerFn(upsertCollateralSchedule);
  const listCsaFn = useServerFn(listCollateralCsaLifecycle);
  const draftFn = useServerFn(createCollateralCsaDraft);
  const submitFn = useServerFn(submitCollateralCsaVersion);
  const decideVersionFn = useServerFn(decideCollateralCsaVersion);
  const calculateFn = useServerFn(calculateCollateralVmCall);
  const approveCallFn = useServerFn(approveCollateralVmCall);
  const disputeFn = useServerFn(disputeCollateralVmCall);
  const resolveDisputeFn = useServerFn(resolveCollateralVmDispute);
  const settlementFn = useServerFn(recordCollateralVmSettlement);
  const scheduleQ = useQuery({
    queryKey: ["collateral-schedules", tenantId],
    queryFn: () => listScheduleFn({ data: { tenant_id: tenantId } }),
  });
  const csaQ = useQuery({
    queryKey: ["collateral-csa-lifecycle", tenantId],
    queryFn: () => listCsaFn({ data: { tenant_id: tenantId } }),
  });
  const lifecycle = (csaQ.data ?? {
    agreements: [],
    versions: [],
    calls: [],
    disputes: [],
    settlements: [],
    current_user_id: "",
  }) as Lifecycle;

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    counterparty: "",
    csa_id: "",
    schedule_type: "VM" as "VM" | "IM" | "Triparty",
    threshold_amount: 0,
    minimum_transfer: 0,
    rounding: 0,
  });
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftAgreement, setDraftAgreement] = useState<Agreement | null>(null);
  const [draftForm, setDraftForm] = useState({
    agreement_key: "",
    own_legal_entity: "",
    counterparty: "",
    currency: "USD",
    threshold_amount: "0",
    minimum_transfer: "0",
    rounding_increment: "0",
    effective_from: todayUtc(),
    effective_to: "",
  });
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [calcForm, setCalcForm] = useState({
    valuation_date: todayUtc(),
    gross_exposure: "",
    eligible_collateral_held: "0",
  });
  const [activeCallId, setActiveCallId] = useState("");
  const [actionForm, setActionForm] = useState({ amount: "", reason: "", reference: "" });
  const [resolveId, setResolveId] = useState("");
  const [resolution, setResolution] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["collateral-schedules", tenantId] });
    void qc.invalidateQueries({ queryKey: ["collateral-csa-lifecycle", tenantId] });
  };
  const scheduleMutation = useMutation({
    mutationFn: () => saveScheduleFn({ data: { tenant_id: tenantId, ...scheduleForm } }),
    onSuccess: () => {
      toast.success("Schedule saved");
      setScheduleOpen(false);
      refresh();
    },
    onError: reportSafeError,
  });
  const actionMutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      toast.success("Change recorded");
      setDraftOpen(false);
      setActiveCallId("");
      setResolveId("");
      refresh();
    },
    onError: reportSafeError,
  });

  const selectedVersion = lifecycle.versions.find((version) => version.id === selectedVersionId);
  const selectedAgreement = selectedVersion
    ? lifecycle.agreements.find((agreement) => agreement.id === selectedVersion.agreement_id)
    : undefined;

  function openNewDraft(agreement?: Agreement) {
    setDraftAgreement(agreement ?? null);
    setDraftForm({
      agreement_key: agreement?.agreement_key ?? "",
      own_legal_entity: agreement?.own_legal_entity ?? "",
      counterparty: agreement?.counterparty ?? "",
      currency: agreement?.currency ?? "USD",
      threshold_amount: "0",
      minimum_transfer: "0",
      rounding_increment: "0",
      effective_from: todayUtc(),
      effective_to: "",
    });
    setDraftOpen(true);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" /> Collateral schedules
            </CardTitle>
            <CardDescription>
              Existing schedule register. These rows are not consumed by the CSA call lifecycle
              below.
            </CardDescription>
          </div>
          {canWrite && (
            <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1 h-3.5 w-3.5" /> New schedule
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New collateral schedule</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3">
                  <div>
                    <Label htmlFor="schedule-counterparty">Counterparty</Label>
                    <Input
                      id="schedule-counterparty"
                      value={scheduleForm.counterparty}
                      onChange={(e) =>
                        setScheduleForm({ ...scheduleForm, counterparty: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="schedule-csa-id">CSA ID</Label>
                    <Input
                      id="schedule-csa-id"
                      value={scheduleForm.csa_id}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, csa_id: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Type</Label>
                    <Select
                      value={scheduleForm.schedule_type}
                      onValueChange={(v: "VM" | "IM" | "Triparty") =>
                        setScheduleForm({ ...scheduleForm, schedule_type: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="VM">Variation margin (VM)</SelectItem>
                        <SelectItem value="IM">Initial margin (IM)</SelectItem>
                        <SelectItem value="Triparty">Triparty</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["Threshold", "threshold_amount"],
                        ["MTA", "minimum_transfer"],
                        ["Rounding", "rounding"],
                      ] as const
                    ).map(([label, key]) => (
                      <div key={key}>
                        <Label htmlFor={`schedule-${key}`}>{label}</Label>
                        <Input
                          id={`schedule-${key}`}
                          type="number"
                          min="0"
                          value={scheduleForm[key]}
                          onChange={(e) =>
                            setScheduleForm({ ...scheduleForm, [key]: Number(e.target.value) })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    disabled={!scheduleForm.counterparty.trim() || scheduleMutation.isPending}
                    onClick={() => scheduleMutation.mutate()}
                  >
                    Save schedule
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {scheduleQ.isError ? (
            <div
              role="alert"
              className="flex items-center justify-between rounded-md border border-destructive/40 p-3 text-sm"
            >
              <span>Schedules could not be loaded. Retry to check the service again.</span>
              <Button variant="outline" size="sm" onClick={() => void scheduleQ.refetch()}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          ) : scheduleQ.isPending ? (
            <p className="text-sm text-muted-foreground">Loading schedules…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>CSA</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead className="text-right">MTA</TableHead>
                  <TableHead className="text-right">Rounding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(scheduleQ.data ?? []).map((row: CollateralSchedule) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.counterparty}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.csa_id ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.schedule_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{money(row.threshold_amount)}</TableCell>
                    <TableCell className="text-right">{money(row.minimum_transfer)}</TableCell>
                    <TableCell className="text-right">{money(row.rounding)}</TableCell>
                  </TableRow>
                ))}
                {scheduleQ.data?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      Nothing to display yet.{" "}
                      {canWrite
                        ? "Create a schedule when you have the approved terms."
                        : "Ask a tenant administrator to add a schedule when approved terms are available."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Governed CSA agreements and VM calls</CardTitle>
            <CardDescription>
              Persisted agreement versions and workflow records. The database enforces tenant-admin
              access and maker/checker separation.
            </CardDescription>
          </div>
          {canWrite && (
            <Button size="sm" onClick={() => openNewDraft()}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New bilateral VM agreement
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <strong>Scope in this source slice:</strong> bilateral VM terms and calculation from
            manually supplied exposure and already-valued eligible collateral held. ReconIQ does not
            source valuations, determine eligibility, calculate haircuts or FX, or link calls to
            reconciliation evidence. IM and Triparty lifecycle controls are unavailable. Agreement
            terms require tenant-admin permission; maker and checker must be different users.
          </div>
          {csaQ.isError ? (
            <div
              role="alert"
              className="flex items-center justify-between rounded-md border border-destructive/40 p-3 text-sm"
            >
              <span>
                CSA lifecycle records could not be loaded. Permission or service availability could
                not be confirmed; retry or contact your administrator.
              </span>
              <Button variant="outline" size="sm" onClick={() => void csaQ.refetch()}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          ) : csaQ.isPending ? (
            <p className="text-sm text-muted-foreground">Loading governed CSA records…</p>
          ) : (
            <>
              <section aria-label="CSA agreement register" className="space-y-2">
                <h3 className="font-medium">Agreements and versions</h3>
                {lifecycle.agreements.length === 0 ? (
                  <p className="rounded-md border p-4 text-sm text-muted-foreground">
                    No governed agreements are recorded yet.{" "}
                    {canWrite
                      ? "Create a bilateral VM draft to begin the approval workflow."
                      : "Ask a tenant administrator to create a bilateral VM draft when terms are approved."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {lifecycle.agreements.map((agreement) => {
                      const versions = lifecycle.versions.filter(
                        (version) => version.agreement_id === agreement.id,
                      );
                      return (
                        <div key={agreement.id} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="font-medium">
                                {agreement.agreement_key} · {agreement.own_legal_entity} ↔{" "}
                                {agreement.counterparty}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {agreement.currency} · {versions.length} version
                                {versions.length === 1 ? "" : "s"}
                              </div>
                            </div>
                            {canWrite && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openNewDraft(agreement)}
                              >
                                New version
                              </Button>
                            )}
                          </div>
                          <div className="mt-3 overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Version</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead>Effective period</TableHead>
                                  <TableHead>Threshold</TableHead>
                                  <TableHead>MTA</TableHead>
                                  <TableHead>Rounding increment</TableHead>
                                  <TableHead>Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {versions.map((version) => (
                                  <TableRow key={version.id}>
                                    <TableCell>v{version.version_no}</TableCell>
                                    <TableCell>
                                      <Badge
                                        variant={
                                          version.status === "active" ? "default" : "outline"
                                        }
                                      >
                                        {version.status.replaceAll("_", " ")}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      {version.effective_from} – {version.effective_to ?? "open"}
                                    </TableCell>
                                    <TableCell>
                                      {money(version.threshold_amount, agreement.currency)}
                                    </TableCell>
                                    <TableCell>
                                      {money(version.minimum_transfer, agreement.currency)}
                                    </TableCell>
                                    <TableCell>
                                      {money(version.rounding_increment, agreement.currency)}
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex flex-wrap gap-2">
                                        {canWrite &&
                                          version.status === "draft" &&
                                          version.created_by === lifecycle.current_user_id && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                actionMutation.mutate(() =>
                                                  submitFn({
                                                    data: {
                                                      tenant_id: tenantId,
                                                      version_id: version.id,
                                                    },
                                                  }),
                                                )
                                              }
                                            >
                                              Submit
                                            </Button>
                                          )}
                                        {canWrite &&
                                          version.status === "pending_approval" &&
                                          version.created_by !== lifecycle.current_user_id &&
                                          version.submitted_by !== lifecycle.current_user_id && (
                                            <>
                                              <Button
                                                size="sm"
                                                onClick={() =>
                                                  actionMutation.mutate(() =>
                                                    decideVersionFn({
                                                      data: {
                                                        tenant_id: tenantId,
                                                        version_id: version.id,
                                                        approve: true,
                                                        reason: "",
                                                      },
                                                    }),
                                                  )
                                                }
                                              >
                                                Approve version
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                  actionMutation.mutate(() =>
                                                    decideVersionFn({
                                                      data: {
                                                        tenant_id: tenantId,
                                                        version_id: version.id,
                                                        approve: false,
                                                        reason: "Returned for revision",
                                                      },
                                                    }),
                                                  )
                                                }
                                              >
                                                Request changes
                                              </Button>
                                            </>
                                          )}
                                        {version.status === "active" && canWrite && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                              setSelectedVersionId(version.id);
                                              setCalcForm({
                                                valuation_date: todayUtc(),
                                                gross_exposure: "",
                                                eligible_collateral_held: "0",
                                              });
                                            }}
                                          >
                                            Calculate VM call
                                          </Button>
                                        )}
                                        {version.status !== "draft" &&
                                          version.status !== "pending_approval" &&
                                          version.status !== "active" && (
                                            <span className="text-xs text-muted-foreground">
                                              Historical version
                                            </span>
                                          )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {selectedVersion && selectedAgreement && (
                <section aria-label="VM calculation form" className="rounded-md border p-4">
                  <div className="mb-3">
                    <h3 className="font-medium">
                      Calculate a variation margin proposal · {selectedAgreement.agreement_key} v
                      {selectedVersion.version_no}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      The governed function stores the supplied inputs and agreement snapshot.
                      Provide exposure and eligible collateral held in {selectedAgreement.currency};
                      MTA is applied before rounding. Amounts support up to 16 integer and 4 decimal
                      places.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <Label htmlFor="vm-date">Valuation date</Label>
                      <Input
                        id="vm-date"
                        type="date"
                        value={calcForm.valuation_date}
                        onChange={(e) =>
                          setCalcForm({ ...calcForm, valuation_date: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="vm-exposure">
                        Gross exposure / MTM ({selectedAgreement.currency})
                      </Label>
                      <Input
                        id="vm-exposure"
                        inputMode="decimal"
                        value={calcForm.gross_exposure}
                        onChange={(e) =>
                          setCalcForm({ ...calcForm, gross_exposure: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="vm-held">
                        Eligible collateral held, already valued ({selectedAgreement.currency})
                      </Label>
                      <Input
                        id="vm-held"
                        inputMode="decimal"
                        value={calcForm.eligible_collateral_held}
                        onChange={(e) =>
                          setCalcForm({ ...calcForm, eligible_collateral_held: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      disabled={
                        !canWrite || !calcForm.gross_exposure.trim() || actionMutation.isPending
                      }
                      onClick={() =>
                        actionMutation.mutate(() =>
                          calculateFn({
                            data: {
                              tenant_id: tenantId,
                              version_id: selectedVersion.id,
                              valuation_date: calcForm.valuation_date,
                              gross_exposure: calcForm.gross_exposure,
                              eligible_collateral_held: calcForm.eligible_collateral_held,
                              idempotency_key: crypto.randomUUID(),
                            },
                          }),
                        )
                      }
                    >
                      Save calculation for checker review
                    </Button>
                    <Button variant="outline" onClick={() => setSelectedVersionId("")}>
                      Close
                    </Button>
                  </div>
                </section>
              )}

              <section aria-label="VM call register" className="space-y-2">
                <h3 className="font-medium">Calls, disputes and settlements</h3>
                {lifecycle.calls.length === 0 ? (
                  <p className="rounded-md border p-4 text-sm text-muted-foreground">
                    No VM calls are recorded. A calculation can be made from an active agreement
                    version.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Valuation date</TableHead>
                          <TableHead>Agreement</TableHead>
                          <TableHead>Net exposure</TableHead>
                          <TableHead>Proposed call</TableHead>
                          <TableHead>Direction</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Settled</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lifecycle.calls.map((call) => {
                          const agreement = lifecycle.agreements.find(
                            (row) => row.id === call.agreement_id,
                          );
                          const openDisputes = lifecycle.disputes.filter(
                            (dispute) => dispute.call_id === call.id && !dispute.resolved_at,
                          );
                          return (
                            <TableRow key={call.id}>
                              <TableCell>{call.valuation_date}</TableCell>
                              <TableCell>
                                {agreement?.agreement_key ?? "Agreement unavailable"}
                              </TableCell>
                              <TableCell>{money(call.net_exposure, agreement?.currency)}</TableCell>
                              <TableCell>{money(call.call_amount, agreement?.currency)}</TableCell>
                              <TableCell>
                                {call.direction === "counterparty_to_us"
                                  ? "Counterparty pays us"
                                  : call.direction === "us_to_counterparty"
                                    ? "We pay counterparty"
                                    : "No transfer"}
                              </TableCell>
                              <TableCell>
                                <Badge variant={call.status === "settled" ? "default" : "outline"}>
                                  {call.status.replaceAll("_", " ")}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {money(call.settled_amount, agreement?.currency)}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-2">
                                  {canWrite &&
                                    call.status === "pending_approval" &&
                                    call.calculated_by !== lifecycle.current_user_id && (
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          actionMutation.mutate(() =>
                                            approveCallFn({
                                              data: { tenant_id: tenantId, call_id: call.id },
                                            }),
                                          )
                                        }
                                      >
                                        Approve call
                                      </Button>
                                    )}
                                  {canWrite &&
                                    ["approved", "partially_settled"].includes(call.status) && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setActiveCallId(activeCallId === call.id ? "" : call.id);
                                          setActionForm({ amount: "", reason: "", reference: "" });
                                        }}
                                      >
                                        Record settlement / dispute
                                      </Button>
                                    )}
                                  {openDisputes.map(
                                    (dispute) =>
                                      canWrite &&
                                      dispute.raised_by !== lifecycle.current_user_id && (
                                        <Button
                                          key={dispute.id}
                                          size="sm"
                                          variant="outline"
                                          onClick={() => {
                                            setResolveId(dispute.id);
                                            setResolution("");
                                          }}
                                        >
                                          Resolve dispute
                                        </Button>
                                      ),
                                  )}
                                  {!canWrite && (
                                    <span className="text-xs text-muted-foreground">Read only</span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {activeCallId && (
                  <div className="mt-3 rounded-md border p-4">
                    <h4 className="font-medium">Settlement or dispute</h4>
                    <p className="mb-3 text-sm text-muted-foreground">
                      Record only activity supported by the governed workflow. The settlement
                      reference is an operator supplied reference; no custody or payment instruction
                      is sent.
                    </p>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <Label htmlFor="call-amount">Amount</Label>
                        <Input
                          id="call-amount"
                          inputMode="decimal"
                          value={actionForm.amount}
                          onChange={(e) => setActionForm({ ...actionForm, amount: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="call-reference">Settlement reference</Label>
                        <Input
                          id="call-reference"
                          value={actionForm.reference}
                          onChange={(e) =>
                            setActionForm({ ...actionForm, reference: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="call-reason">Dispute reason</Label>
                        <Input
                          id="call-reason"
                          value={actionForm.reason}
                          onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        disabled={!actionForm.amount || !actionForm.reference.trim()}
                        onClick={() =>
                          actionMutation.mutate(() =>
                            settlementFn({
                              data: {
                                tenant_id: tenantId,
                                call_id: activeCallId,
                                amount: actionForm.amount,
                                reference: actionForm.reference,
                                idempotency_key: crypto.randomUUID(),
                              },
                            }),
                          )
                        }
                      >
                        Record settlement
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!actionForm.amount || !actionForm.reason.trim()}
                        onClick={() =>
                          actionMutation.mutate(() =>
                            disputeFn({
                              data: {
                                tenant_id: tenantId,
                                call_id: activeCallId,
                                amount: actionForm.amount,
                                reason: actionForm.reason,
                                idempotency_key: crypto.randomUUID(),
                              },
                            }),
                          )
                        }
                      >
                        Raise dispute
                      </Button>
                      <Button variant="ghost" onClick={() => setActiveCallId("")}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {resolveId && (
                  <div className="mt-3 rounded-md border p-4">
                    <Label htmlFor="dispute-resolution">Resolution reason</Label>
                    <Input
                      id="dispute-resolution"
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    />
                    <div className="mt-3 flex gap-2">
                      <Button
                        disabled={!resolution.trim()}
                        onClick={() =>
                          actionMutation.mutate(() =>
                            resolveDisputeFn({
                              data: { tenant_id: tenantId, dispute_id: resolveId, resolution },
                            }),
                          )
                        }
                      >
                        Resolve dispute
                      </Button>
                      <Button variant="outline" onClick={() => setResolveId("")}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {lifecycle.disputes.length > 0 && (
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer font-medium">
                      Dispute history ({lifecycle.disputes.length})
                    </summary>
                    <ul className="mt-2 space-y-2 text-sm">
                      {lifecycle.disputes.map((dispute) => {
                        const call = lifecycle.calls.find((row) => row.id === dispute.call_id);
                        const agreement = call
                          ? lifecycle.agreements.find((row) => row.id === call.agreement_id)
                          : undefined;
                        return (
                          <li key={dispute.id}>
                            {agreement?.agreement_key ?? "Agreement"} ·{" "}
                            {call?.valuation_date ?? "Date unavailable"} ·{" "}
                            {money(dispute.disputed_amount, agreement?.currency)} ·{" "}
                            {dispute.resolved_at ? "Resolved" : "Open"} · {dispute.reason}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
                {lifecycle.settlements.length > 0 && (
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer font-medium">
                      Settlement history ({lifecycle.settlements.length})
                    </summary>
                    <ul className="mt-2 space-y-2 text-sm">
                      {lifecycle.settlements.map((settlement) => (
                        <li key={settlement.id}>
                          {settlement.settled_at.slice(0, 10)} · {money(settlement.amount)} ·
                          Reference {settlement.settlement_reference}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {draftAgreement
                ? `New version · ${draftAgreement.agreement_key}`
                : "New bilateral VM agreement draft"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="csa-key">Agreement / netting-set ID</Label>
              <Input
                id="csa-key"
                disabled={!!draftAgreement}
                value={draftForm.agreement_key}
                onChange={(e) => setDraftForm({ ...draftForm, agreement_key: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="csa-entity">Our legal entity</Label>
              <Input
                id="csa-entity"
                disabled={!!draftAgreement}
                value={draftForm.own_legal_entity}
                onChange={(e) => setDraftForm({ ...draftForm, own_legal_entity: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="csa-counterparty">Counterparty</Label>
              <Input
                id="csa-counterparty"
                disabled={!!draftAgreement}
                value={draftForm.counterparty}
                onChange={(e) => setDraftForm({ ...draftForm, counterparty: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="csa-currency">Agreement currency (ISO 4217)</Label>
              <Input
                id="csa-currency"
                maxLength={3}
                disabled={!!draftAgreement}
                value={draftForm.currency}
                onChange={(e) =>
                  setDraftForm({ ...draftForm, currency: e.target.value.toUpperCase() })
                }
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["Threshold", "threshold_amount"],
                  ["Minimum transfer amount", "minimum_transfer"],
                  ["Rounding increment (0 = none)", "rounding_increment"],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <Label htmlFor={`csa-${key}`}>{label}</Label>
                  <Input
                    id={`csa-${key}`}
                    inputMode="decimal"
                    value={draftForm[key]}
                    onChange={(e) => setDraftForm({ ...draftForm, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="csa-from">Effective from</Label>
                <Input
                  id="csa-from"
                  type="date"
                  value={draftForm.effective_from}
                  onChange={(e) => setDraftForm({ ...draftForm, effective_from: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="csa-to">Effective to (optional)</Label>
                <Input
                  id="csa-to"
                  type="date"
                  value={draftForm.effective_to}
                  onChange={(e) => setDraftForm({ ...draftForm, effective_to: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This creates an immutable draft version. A separate tenant administrator must approve
              it before calls can use it. Asset eligibility, custody and haircut terms are not
              represented in this first supported scope.
            </p>
            <Button
              disabled={
                !canWrite ||
                !draftForm.agreement_key.trim() ||
                !draftForm.own_legal_entity.trim() ||
                !draftForm.counterparty.trim() ||
                !/^[A-Z]{3}$/.test(draftForm.currency) ||
                !draftForm.effective_from ||
                actionMutation.isPending
              }
              onClick={() =>
                actionMutation.mutate(() =>
                  draftFn({
                    data: {
                      tenant_id: tenantId,
                      agreement_id: draftAgreement?.id ?? null,
                      ...draftForm,
                      effective_to: draftForm.effective_to || null,
                      idempotency_key: crypto.randomUUID(),
                    },
                  }),
                )
              }
            >
              Save draft version
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
