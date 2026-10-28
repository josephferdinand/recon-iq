import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listPipelines, upsertPipeline, deletePipeline, runPipeline, listPipelineRuns,
  approvePipeline, revertPipelineToDraft,
  cloneAsStaging, requestPromotion, approvePromotion, rejectPromotion, discardStaging,
  diffStaging, listAffectedRecons,
} from "@/lib/data-prep.functions";
import { listDataSourceOptions } from "@/lib/data-sources.functions";
import { getResourceAccessSummaries } from "@/lib/resource-access-summaries.functions";
import { ResourceIdentitySummary } from "@/components/resource-identity-summary";
import { getResourceActorSummaries } from "@/lib/resource-actor-summaries.functions";
import { ResourceActorSummary as ResourceActorSummaryView } from "@/components/resource-actor-summary";
import { FviDetailDialogLayout } from "@/components/fvi-detail-dialog-layout";
import { TRANSFORM_CATALOG, TRANSFORM_BY_KIND, TRANSFORM_CATEGORIES, type TransformParam } from "@/lib/data-prep-transforms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Plus, Play, Trash2, Workflow, CheckCircle2, RotateCcw, Copy, Lock, GitBranch, GitPullRequest, ShieldCheck, X, Search } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";

const RULE_KINDS = ["not_null","unique","regex","min","max","in_set","is_number","is_date","currency"] as const;
const PAGE_SIZE = 25;

function dataPrepWriteFailure(error: unknown, action: string, actionId: string, actionLabel: string): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definitelyRejected = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
  const category: UserMessageCategory = definitelyRejected ? mapped.category : "unknown_write_outcome";
  return formatUserMessage({
    ...mapped,
    category,
    action,
    code,
    status,
    availableActions: category === "unknown_write_outcome" || mapped.reason === "duplicate"
      ? [{ id: actionId, label: actionLabel }]
      : [],
  });
}

function dataPrepReadFailure(error: unknown, action: string, actionId: string, actionLabel: string): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const category: UserMessageCategory = ["auth", "session", "mfa", "network", "timeout", "dependency"].includes(mapped.category)
    ? mapped.category
    : "system";
  return formatUserMessage({
    ...mapped,
    category,
    action,
    code,
    status,
    retryable: true,
    availableActions: [{ id: actionId, label: actionLabel }],
  });
}

function emptyDraft(tenantId: string) {
  return {
    tenant_id: tenantId, name: "", description: "",
    source_data_source_id: null, output_data_source_id: null,
    steps: [], dq_rules: [], on_failure: "warn", enabled: true,
  } as any;
}

function StatusBadge({ status }: { status?: string }) {
  if (status === "approved") return <Badge className="bg-emerald-600 gap-1"><CheckCircle2 className="h-3 w-3" /> Approved</Badge>;
  if (status === "archived") return <Badge variant="secondary">Archived</Badge>;
  if (status === "pending_approval") return <Badge className="bg-amber-600">Pending approval</Badge>;
  return <Badge variant="outline">Draft</Badge>;
}

function ParamField({ param, value, onChange, id, invalid, errorId }: { param: TransformParam; value: any; onChange: (v: any) => void; id: string; invalid: boolean; errorId?: string }) {
  if (param.kind === "select") {
    return (
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-8" aria-invalid={invalid} aria-describedby={errorId}><SelectValue placeholder={param.label} /></SelectTrigger>
        <SelectContent>{param.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (param.kind === "number") {
    return <Input id={id} aria-invalid={invalid} aria-describedby={errorId} className="h-8" type="number" placeholder={param.label} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
  }
  if (param.kind === "csv") {
    const txt = Array.isArray(value) ? value.join(",") : (value ?? "");
    return <Input id={id} aria-invalid={invalid} aria-describedby={errorId} className="h-8 font-mono text-xs" placeholder={param.placeholder ?? param.label} value={txt} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />;
  }
  return <Input id={id} aria-invalid={invalid} aria-describedby={errorId} className="h-8" placeholder={param.placeholder ?? param.label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

export function DataPrepTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const invalidatePipelineActorSummaries = () => qc.invalidateQueries({ queryKey: ["resource-actor-summaries", "data_prep_pipeline", tenantId] });
  const lp = useServerFn(listPipelines);
  const up = useServerFn(upsertPipeline);
  const del = useServerFn(deletePipeline);
  const run = useServerFn(runPipeline);
  const lr = useServerFn(listPipelineRuns);
  const lds = useServerFn(listDataSourceOptions);
  const getAccessSummaries = useServerFn(getResourceAccessSummaries);
  const getActorSummaries = useServerFn(getResourceActorSummaries);
  const approve = useServerFn(approvePipeline);
  const revert = useServerFn(revertPipelineToDraft);
  const { confirm: requestConfirm, ConfirmDialog } = useConfirm();

  const [pipelineSearch, setPipelineSearch] = useState("");
  const [pipelineStatus, setPipelineStatus] = useState<"all" | "draft" | "pending_approval" | "approved" | "archived">("all");
  const [stepsFilter, setStepsFilter] = useState<"all" | "zero" | "one_two" | "three_plus">("all");
  const [dqFilter, setDqFilter] = useState<"all" | "zero" | "one_plus">("all");
  const [lastRunFilter, setLastRunFilter] = useState<"all" | "7d" | "30d" | "90d" | "never">("all");
  const [pipelineSort, setPipelineSort] = useState<"updated_desc" | "updated_asc" | "name_asc" | "last_run_desc">("updated_desc");
  const [pipelinePage, setPipelinePage] = useState(0);
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedThrough, setUpdatedThrough] = useState("");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [viewPipelineId, setViewPipelineId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<UserMessage | null>(null);
  const [actionMessageContext, setActionMessageContext] = useState<"workspace" | "editor" | "view" | "promo" | "diff">("workspace");
  const [draftFieldErrors, setDraftFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [retryComparisonId, setRetryComparisonId] = useState<string | null>(null);
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewTransitionRef = useRef(false);
  const returnToViewAfterChildRef = useRef(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const pipes = useQuery({
    queryKey: ["pipes", tenantId, pipelinePage, pipelineSearch, pipelineStatus, stepsFilter, dqFilter, lastRunFilter, pipelineSort, updatedFrom, updatedThrough],
    queryFn: () => lp({ data: { tenant_id: tenantId, page: pipelinePage, page_size: PAGE_SIZE, search: pipelineSearch, status: pipelineStatus, steps: stepsFilter, dq: dqFilter, last_run: lastRunFilter, sort: pipelineSort, updated_from: updatedFrom || undefined, updated_through: updatedThrough || undefined } }),
    enabled: !updatedFrom || !updatedThrough || updatedFrom <= updatedThrough,
  });
  const runs = useQuery({ queryKey: ["pipe-runs", tenantId], queryFn: () => lr({ data: { tenant_id: tenantId } }) });
  const pipelineRows = pipes.data?.rows ?? [];
  const pipelineActorIds = [...new Set(pipelineRows.map((row: any) => row.id))].slice(0, 100);
  const accessQ = useQuery({
    queryKey: ["resource-access-summary", tenantId, "data_prep_pipeline", pipelineRows.map((row: any) => row.id)],
    queryFn: () => getAccessSummaries({ data: { resource_type: "data_prep_pipeline", resource_ids: pipelineRows.map((row: any) => row.id) } }),
    enabled: pipelineRows.length > 0,
  });
  const accessById = new Map((accessQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const actorQ = useQuery({
    queryKey: ["resource-actor-summaries", "data_prep_pipeline", tenantId, pipelineActorIds],
    queryFn: () => getActorSummaries({ data: { resource_type: "data_prep_pipeline", resource_ids: pipelineActorIds } }),
    enabled: pipelineActorIds.length > 0,
    retry: false,
  });
  const actorsById = new Map((actorQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const selectedPipeline = pipes.data?.rows.find((p: any) => p.id === selectedPipelineId) ?? pipes.data?.rows[0] ?? null;
  const viewedPipeline = pipes.data?.rows.find((p: any) => p.id === viewPipelineId) ?? null;
  const selectedRuns = useQuery({
    queryKey: ["pipe-runs", tenantId, viewedPipeline?.id],
    queryFn: () => lr({ data: { tenant_id: tenantId, pipeline_id: viewedPipeline!.id } }),
    enabled: Boolean(viewedPipeline),
  });
  const selectedRun = selectedRuns.data?.[0] ?? null;
  const selectedRunDq: any[] = Array.isArray(selectedRun?.dq_results) ? selectedRun.dq_results as any[] : [];
  const resetPipelinePage = () => { setPipelinePage(0); setSelectedPipelineId(null); };
  const updatedRangeInvalid = Boolean(updatedFrom && updatedThrough && updatedFrom > updatedThrough);
  useEffect(() => {
    if (pipes.data && pipelinePage * PAGE_SIZE >= pipes.data.total && pipes.data.total > 0) {
      setPipelinePage(Math.max(0, Math.ceil(pipes.data.total / PAGE_SIZE) - 1));
    }
  }, [pipes.data?.total, pipelinePage]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(emptyDraft(tenantId));
  const sourceIds = [...new Set([draft.source_data_source_id, draft.output_data_source_id, selectedPipeline?.source_data_source_id, selectedPipeline?.output_data_source_id].filter(Boolean))].slice(0, 10);
  const sources = useQuery({
    queryKey: ["data-source-options", tenantId, sourceSearch, sourceIds],
    queryFn: () => lds({ data: {
      tenant_id: tenantId,
      search: sourceSearch,
      selected_ids: sourceIds,
    } }),
  });
  const sourceOptions = [...(sources.data?.rows ?? []), ...(sources.data?.selected ?? [])]
    .filter((source, index, all) => all.findIndex((candidate) => candidate.id === source.id) === index);

  const isApproved = draft?.status === "approved";

  const save = useMutation({
    mutationFn: (v: any) => up({ data: v }),
    onSuccess: (r: any) => {
      setActionMessage(null);
      setDraftFieldErrors({});
      toast.success(r?.public_uid ? `Saved · ${r.public_uid}` : "Saved");
      qc.invalidateQueries({ queryKey: ["pipes", tenantId] });
      void invalidatePipelineActorSummaries();
      setOpen(false);
    },
    onError: (error) => {
      setActionMessageContext("editor");
      setActionMessage(dataPrepWriteFailure(error, "save this pipeline", "refresh-pipelines", "Refresh pipelines"));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { setActionMessage(null); toast.success("Pipeline archived"); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); void invalidatePipelineActorSummaries(); },
    onError: (error) => { setActionMessageContext("view"); setActionMessage(dataPrepWriteFailure(error, "archive this pipeline", "refresh-pipelines", "Refresh pipelines")); },
  });
  const exec = useMutation({
    mutationFn: (id: string) => run({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r: any) => { setActionMessage(null); toast.success(`Pipeline ${r.status} — ${r.run_uid}`); qc.invalidateQueries({ queryKey: ["pipe-runs", tenantId] }); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); },
    onError: (error) => { setActionMessageContext("view"); setActionMessage(dataPrepWriteFailure(error, "run this pipeline", "check-run-history", "Refresh run history")); },
  });
  const mApprove = useMutation({
    mutationFn: (id: string) => approve({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r: any) => { setActionMessage(null); toast.success(`Approved · ${r.public_uid}`); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); void invalidatePipelineActorSummaries(); },
    onError: (error) => { setActionMessageContext("view"); setActionMessage(dataPrepWriteFailure(error, "approve this pipeline", "refresh-pipelines", "Refresh pipeline status")); },
  });
  const mRevert = useMutation({
    mutationFn: (id: string) => revert({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { setActionMessage(null); toast.success("Reverted to draft"); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); void invalidatePipelineActorSummaries(); },
    onError: (error) => { setActionMessageContext("view"); setActionMessage(dataPrepWriteFailure(error, "revert this pipeline", "refresh-pipelines", "Refresh pipeline status")); },
  });

  // ── Staging copies + 4-eyes promotion ──
  const sfClone = useServerFn(cloneAsStaging);
  const sfReqPromo = useServerFn(requestPromotion);
  const sfApprovePromo = useServerFn(approvePromotion);
  const sfRejectPromo = useServerFn(rejectPromotion);
  const sfDiscard = useServerFn(discardStaging);
  const sfDiff = useServerFn(diffStaging);
  const sfAffected = useServerFn(listAffectedRecons);

  const mClone = useMutation({
    mutationFn: (id: string) => sfClone({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r: any) => { setActionMessage(null); toast.success(`Staging copy created · ${r.public_uid ?? ""}`); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); void invalidatePipelineActorSummaries(); },
    onError: (error) => { setActionMessageContext("view"); setActionMessage(dataPrepWriteFailure(error, "create a staging copy", "refresh-pipelines", "Refresh pipelines")); },
  });
  const mReqPromo = useMutation({
    mutationFn: (v: { staging_id: string; note?: string }) => sfReqPromo({ data: { ...v, tenant_id: tenantId } }),
    onSuccess: () => { setActionMessage(null); toast.success("Promotion requested — awaiting a second admin"); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); void invalidatePipelineActorSummaries(); setPromoOpen(false); },
    onError: (error) => { setActionMessageContext("promo"); setActionMessage(dataPrepWriteFailure(error, "request this promotion", "refresh-pipelines", "Refresh promotion status")); },
  });
  const mApprovePromo = useMutation({
    mutationFn: (id: string) => sfApprovePromo({ data: { staging_id: id, tenant_id: tenantId } }),
    onSuccess: () => { setActionMessage(null); toast.success("Promoted to production"); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); void invalidatePipelineActorSummaries(); },
    onError: (error) => { setActionMessageContext("view"); setActionMessage(dataPrepWriteFailure(error, "approve this promotion", "refresh-pipelines", "Refresh promotion status")); },
  });
  const mRejectPromo = useMutation({
    mutationFn: (id: string) => sfRejectPromo({ data: { staging_id: id, tenant_id: tenantId } }),
    onSuccess: () => { setActionMessage(null); toast.success("Promotion rejected"); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); void invalidatePipelineActorSummaries(); },
    onError: (error) => { setActionMessageContext("view"); setActionMessage(dataPrepWriteFailure(error, "reject this promotion", "refresh-pipelines", "Refresh promotion status")); },
  });
  const mDiscard = useMutation({
    mutationFn: (id: string) => sfDiscard({ data: { staging_id: id, tenant_id: tenantId } }),
    onSuccess: () => { setActionMessage(null); toast.success("Staging discarded"); qc.invalidateQueries({ queryKey: ["pipes", tenantId] }); void invalidatePipelineActorSummaries(); },
    onError: (error) => { setActionMessageContext("view"); setActionMessage(dataPrepWriteFailure(error, "discard this staging copy", "refresh-pipelines", "Refresh pipeline status")); },
  });

  const [promoOpen, setPromoOpen] = useState(false);

  const confirm = (options: Parameters<typeof requestConfirm>[0]) => {
    const returnToView = Boolean(viewPipelineId);
    if (viewPipelineId) {
      viewTransitionRef.current = true;
      setViewPipelineId(null);
    }
    return requestConfirm(options).finally(() => { if (returnToView) viewTriggerRef.current?.focus(); });
  };

  const [promoTarget, setPromoTarget] = useState<any>(null);
  const [promoNote, setPromoNote] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState<any>(null);
  const [affected, setAffected] = useState<any[]>([]);

  useLayoutEffect(() => {
    if (viewPipelineId && (open || diffOpen || promoOpen)) {
      viewTransitionRef.current = true;
      returnToViewAfterChildRef.current = true;
      setViewPipelineId(null);
    }
  }, [open, diffOpen, promoOpen, viewPipelineId]);

  async function openDiff(stagingId: string) {
    if (viewPipelineId) {
      viewTransitionRef.current = true;
      returnToViewAfterChildRef.current = true;
      setViewPipelineId(null);
    }
    setRetryComparisonId(stagingId);
    try {
      const d = await sfDiff({ data: { staging_id: stagingId, tenant_id: tenantId } });
      const aff = await sfAffected({ data: { pipeline_id: stagingId, tenant_id: tenantId } });
      setDiffData(d); setAffected(aff ?? []); setDiffOpen(true);
    } catch (error) {
      setActionMessageContext("diff");
      setActionMessage(dataPrepReadFailure(error, "compare this staging copy with production", "retry-comparison", "Retry comparison"));
    }
  }

  function setStep(i: number, patch: any) {
    const s = [...(draft.steps ?? [])]; s[i] = { ...s[i], ...patch }; setDraft({ ...draft, steps: s });
    setDraftFieldErrors({});
  }

  function submitDraft() {
    const fields: Array<{ field: string; issue: "required" | "invalid_format" | "unsupported_value" | "too_long" | "too_large"; limit?: number; allowedValues?: readonly string[] }> = [];
    const name = String(draft.name ?? "").trim();
    if (!name) fields.push({ field: "Name", issue: "required" });
    else if (name.length < 2) fields.push({ field: "Name", issue: "invalid_format" });
    else if (name.length > 120) fields.push({ field: "Name", issue: "too_long", limit: 120 });
    if (String(draft.description ?? "").length > 1000) fields.push({ field: "Description", issue: "too_long", limit: 1000 });
    if ((draft.steps ?? []).length > 100) fields.push({ field: "Transformation steps", issue: "too_large", limit: 100 });
    if ((draft.dq_rules ?? []).length > 50) fields.push({ field: "Data quality rules", issue: "too_large", limit: 50 });
    (draft.steps ?? []).forEach((step: any, index: number) => {
      const definition = TRANSFORM_BY_KIND[step.kind];
      if (!definition) {
        fields.push({ field: `Step ${index + 1} transformation type`, issue: "unsupported_value", allowedValues: TRANSFORM_CATALOG.map((item) => item.kind) });
        return;
      }
      definition.params.forEach((param) => {
        const value = step[param.name] ?? step.params?.[param.name];
        const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
        const field = `Step ${index + 1} ${param.label}`;
        if (param.required && empty) fields.push({ field, issue: "required" });
        else if (!empty && param.kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) fields.push({ field, issue: "invalid_format" });
        else if (!empty && param.kind === "select" && !param.options.includes(String(value))) fields.push({ field, issue: "unsupported_value", allowedValues: param.options });
        else if (!empty && param.kind === "csv" && (!Array.isArray(value) || value.some((item: unknown) => typeof item !== "string" || !item.trim()))) fields.push({ field, issue: "invalid_format" });
      });
    });
    (draft.dq_rules ?? []).forEach((rule: any, index: number) => {
      if (!String(rule.id ?? "").trim()) fields.push({ field: `Rule ${index + 1} ID`, issue: "required" });
      else if (String(rule.id).length > 64) fields.push({ field: `Rule ${index + 1} ID`, issue: "too_long", limit: 64 });
      if (!String(rule.field ?? "").trim()) fields.push({ field: `Rule ${index + 1} field`, issue: "required" });
      else if (String(rule.field).length > 120) fields.push({ field: `Rule ${index + 1} field`, issue: "too_long", limit: 120 });
      if (rule.kind === "regex" && !String(rule.params?.pattern ?? "")) fields.push({ field: `Rule ${index + 1} regex pattern`, issue: "required" });
      if (["min", "max"].includes(rule.kind) && (typeof rule.params?.value !== "number" || !Number.isFinite(rule.params.value))) fields.push({ field: `Rule ${index + 1} numeric limit`, issue: "required" });
      if (rule.kind === "in_set" && (!Array.isArray(rule.params?.values) || rule.params.values.length === 0)) fields.push({ field: `Rule ${index + 1} allowed values`, issue: "required" });
    });
    if (fields.length) {
      const formatted = formatUserMessage({ category: "input", action: "save this pipeline", fields });
      setDraftFieldErrors(formatted.fieldErrors);
      setActionMessageContext("editor");
      setActionMessage(formatted);
      return;
    }
    setDraftFieldErrors({});
    setActionMessage(null);
    save.mutate({
      ...draft,
      name,
      source_data_source_id: draft.source_data_source_id || null,
      output_data_source_id: draft.output_data_source_id || null,
    });
  }

  function performMessageAction(id: string) {
    if (id === "refresh-pipelines") {
      void pipes.refetch();
      void qc.invalidateQueries({ queryKey: ["pipe-runs", tenantId] });
      setOpen(false);
      setPromoOpen(false);
      setViewPipelineId(null);
      setActionMessageContext("workspace");
    }
    if (id === "check-run-history") {
      void runs.refetch();
      if (viewedPipeline) void selectedRuns.refetch();
      setViewPipelineId(null);
      setActionMessageContext("workspace");
    }
    if (id === "retry-comparison" && retryComparisonId) void openDiff(retryComparisonId);
  }

  function messageView(context: typeof actionMessageContext) {
    if (!actionMessage || actionMessageContext !== context) return null;
    return (
      <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="font-medium">{actionMessage.title}</p>
        <p className="mt-1">{actionMessage.humanMessage}</p>
        {context !== "editor" ? Object.entries(actionMessage.fieldErrors).map(([field, copy]) => <p key={field} className="mt-1 text-destructive">{copy}</p>) : null}
        {actionMessage.nextActions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2 mr-2" onClick={() => performMessageAction(action.id)}>{action.label}</Button>)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {messageView("workspace")}
      <div className="relative">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Workflow className="h-4 w-4" /> Data Prep pipelines</CardTitle>
            <CardDescription>
              Governed transformations and data-quality checks. Only approved pipelines with an output source are consumable in ReconIQ Studio.
            </CardDescription>
          </div>
          {canWrite ? (
            <Button onClick={() => { setDraft(emptyDraft(tenantId)); setDraftFieldErrors({}); setActionMessage(null); setOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> New pipeline
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
            <div className="relative md:col-span-2 xl:col-span-1"><Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search pipelines by name or Public ID (Pub UID)" className="pl-9" placeholder="Name or Public ID (Pub UID)" value={pipelineSearch} onChange={(e) => { setPipelineSearch(e.target.value); resetPipelinePage(); }} /></div>
            <Select value={pipelineStatus} onValueChange={(v) => { setPipelineStatus(v as typeof pipelineStatus); resetPipelinePage(); }}><SelectTrigger aria-label="Filter pipeline status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="pending_approval">Pending approval</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select>
            <Select value={stepsFilter} onValueChange={(v) => { setStepsFilter(v as typeof stepsFilter); resetPipelinePage(); }}><SelectTrigger aria-label="Filter by configured steps"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All steps</SelectItem><SelectItem value="zero">0 steps</SelectItem><SelectItem value="one_two">1–2 steps</SelectItem><SelectItem value="three_plus">3+ steps</SelectItem></SelectContent></Select>
            <Select value={dqFilter} onValueChange={(v) => { setDqFilter(v as typeof dqFilter); resetPipelinePage(); }}><SelectTrigger aria-label="Filter by configured DQ rules"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All DQ rule counts</SelectItem><SelectItem value="zero">0 rules</SelectItem><SelectItem value="one_plus">1+ configured rules</SelectItem></SelectContent></Select>
            <Select value={lastRunFilter} onValueChange={(v) => { setLastRunFilter(v as typeof lastRunFilter); resetPipelinePage(); }}><SelectTrigger aria-label="Filter last run date"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any last run</SelectItem><SelectItem value="7d">Run in last 7 days</SelectItem><SelectItem value="30d">Run in last 30 days</SelectItem><SelectItem value="90d">Run in last 90 days</SelectItem><SelectItem value="never">Never run</SelectItem></SelectContent></Select>
            <Select value={pipelineSort} onValueChange={(v) => { setPipelineSort(v as typeof pipelineSort); resetPipelinePage(); }}><SelectTrigger aria-label="Sort pipelines"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated_desc">Last updated (newest)</SelectItem><SelectItem value="updated_asc">Last updated (oldest)</SelectItem><SelectItem value="name_asc">Name (A–Z)</SelectItem><SelectItem value="last_run_desc">Last run (newest)</SelectItem></SelectContent></Select>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Updated from (UTC)</span><Input aria-label="Updated from (UTC)" title="UTC date, inclusive" type="date" value={updatedFrom} onChange={(event) => { setUpdatedFrom(event.target.value); resetPipelinePage(); }} /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Updated through (UTC)</span><Input aria-label="Updated through (UTC)" title="UTC date, inclusive" type="date" value={updatedThrough} onChange={(event) => { setUpdatedThrough(event.target.value); resetPipelinePage(); }} /></label>
          </div>
          <p className="text-xs text-muted-foreground">Updated date range uses inclusive UTC calendar dates.</p>
          <p className="text-xs text-muted-foreground">Steps and DQ filters count configured items. A configured DQ rule is not a passing run result.</p>
          {updatedRangeInvalid ? <p role="alert" className="py-4 text-sm text-destructive">Updated through must be on or after Updated from.</p> : pipes.isPending ? <div className="py-8 text-center text-sm text-muted-foreground">Loading pipelines…</div> : pipes.isError ? <div role="alert" className="py-8 text-center text-sm text-destructive">Pipelines could not be loaded. Retry to check again.<Button className="ml-3" size="sm" variant="outline" onClick={() => pipes.refetch()}>Retry</Button></div> : pipes.data.total === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">{pipelineSearch || pipelineStatus !== "all" || stepsFilter !== "all" || dqFilter !== "all" || lastRunFilter !== "all" || updatedFrom || updatedThrough ? "No pipelines match these filters." : "No pipelines yet. Create a pipeline to configure transformation steps and DQ rules."}</div> :
          <div className="overflow-x-auto"><table className="w-full min-w-[1240px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Public ID</th><th className="px-4 py-2">Pipeline</th><th className="px-4 py-2">Business units</th><th className="px-4 py-2">User groups</th>
                <th className="px-4 py-2">Status</th><th className="px-4 py-2">Steps</th>
                <th className="px-4 py-2">DQ rules</th><th className="px-4 py-2">Last run</th><th className="px-4 py-2">Updated</th><th className="fvi-sticky-view-cell px-4 py-2 text-right">View</th>
              </tr>
            </thead>
            <tbody>
              {pipes.data.rows.map((p: any) => (
                <tr key={p.id} className={`border-b ${selectedPipeline?.id === p.id ? "fvi-selected-row" : ""}`} aria-selected={selectedPipeline?.id === p.id}>
                  <td className="px-4 py-2"><ResourceIdentitySummary section="identity" publicIdFallback={p.public_uid} summary={accessById.get(p.id)} available={accessQ.data?.available === true} /><button className={`mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] ${selectedPipeline?.id === p.id ? "bg-transparent text-[var(--fvi-selected-row-fg)] hover:bg-transparent" : "bg-muted hover:bg-accent"}`} onClick={() => { navigator.clipboard.writeText(p.public_uid ?? ""); toast.success("Copied"); }} title="Copy pipeline ID">Copy <Copy className="h-3 w-3" /></button><div className="text-[10px] text-muted-foreground">v{p.version ?? 1}</div></td>
                  <td className="px-4 py-2">
                    <button className="text-left font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setSelectedPipelineId(p.id)} aria-label={`Select ${p.name}`}>{p.name}</button>
                    <div className="text-xs text-muted-foreground">{p.description ?? ""}</div>
                  </td>
                  <td className="px-4 py-2"><ResourceIdentitySummary section="business-units" summary={accessById.get(p.id)} available={accessQ.data?.available === true} /></td><td className="px-4 py-2"><ResourceIdentitySummary section="user-groups" summary={accessById.get(p.id)} available={accessQ.data?.available === true} /></td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={p.status} />
                      {p.lifecycle_state === "staging" && (
                        <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-300">
                          <GitBranch className="h-3 w-3" /> Staging
                        </Badge>
                      )}
                      {p.lifecycle_state === "archived" && <Badge variant="secondary">Archived</Badge>}
                      {p.promotion_status === "pending" && (
                        <Badge className="gap-1 bg-amber-600"><GitPullRequest className="h-3 w-3" /> Promotion pending</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">{(p.steps ?? []).length}</td>
                  <td className="px-4 py-2">{(p.dq_rules ?? []).length} <span className="text-xs text-muted-foreground">configured</span></td>
                  <td className="px-4 py-2 text-xs">
                    {p.last_status ? <Badge variant={p.last_status === "failed" ? "destructive" : "outline"}>{p.last_status}</Badge> : "—"}
                    <div className="text-muted-foreground">{p.last_run_at ? new Date(p.last_run_at).toLocaleString() : ""}</div>
                  </td>
                  <td className="px-4 py-2 text-xs"><div>{p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}</div><ResourceActorSummaryView mode="updated-line" summary={actorsById.get(p.id)} available={actorQ.data?.available === true} /></td>
                  <td className="fvi-sticky-view-cell px-4 py-2 text-right"><Button type="button" size="sm" variant="default" className="fvi-row-view-action" aria-label={`View ${p.name}`} aria-haspopup="dialog" aria-expanded={viewPipelineId === p.id} onClick={(event) => { viewTriggerRef.current = event.currentTarget; setSelectedPipelineId(p.id); setViewPipelineId(p.id); }}>View</Button></td>
                </tr>
              ))}
            </tbody>
          </table></div>}
          {!pipes.isPending && !pipes.isError && pipes.data?.total > 0 ? <div className="flex items-center justify-between border-t pt-3 text-sm text-muted-foreground"><span>{pipelinePage * PAGE_SIZE + 1}–{Math.min((pipelinePage + 1) * PAGE_SIZE, pipes.data.total)} of {pipes.data.total}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={pipelinePage === 0} onClick={() => { setPipelinePage(pipelinePage - 1); setSelectedPipelineId(null); }}>Previous</Button><Button size="sm" variant="outline" disabled={(pipelinePage + 1) * PAGE_SIZE >= pipes.data.total} onClick={() => { setPipelinePage(pipelinePage + 1); setSelectedPipelineId(null); }}>Next</Button></div></div> : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(viewPipelineId)} onOpenChange={(isOpen) => { if (!isOpen) setViewPipelineId(null); }}>
        <DialogContent id={viewedPipeline ? `pipeline-details-${viewedPipeline.id}` : undefined} className="h-[min(92dvh,64rem)] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[min(96vw,88rem)] overflow-hidden gap-0 p-0" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); if (viewTransitionRef.current) { viewTransitionRef.current = false; return; } viewTriggerRef.current?.focus(); }}>
          {viewedPipeline ? <FviDetailDialogLayout
            railEyebrow="DATA PREP"
            railTitle="PIPELINE"
            railStatus={<div className="flex flex-wrap gap-2">{viewedPipeline.status === "draft" ? <Badge variant="outline" className="border-[var(--fvi-gold)] bg-[var(--fvi-gold)] text-[var(--ink-2)]">Draft</Badge> : <StatusBadge status={viewedPipeline.status} />}{viewedPipeline.lifecycle_state === "staging" ? <Badge variant="outline" className="border-[var(--fvi-gold)] text-[var(--fvi-gold-hi)]">Staging</Badge> : null}</div>}
            railFields={[
              { label: "Pipeline ID", value: <span className="font-mono">{viewedPipeline.public_uid ?? "ID pending setup"}</span> },
              { label: "Version", value: `v${viewedPipeline.version ?? 1}` },
              { label: "Lifecycle", value: viewedPipeline.lifecycle_state ?? "Unavailable" },
              { label: "Pipeline approval", value: "Governed approve action; independent checking is not established by this screen." },
              ...(viewedPipeline.lifecycle_state === "staging" ? [{ label: "Promotion", value: viewedPipeline.promotion_status === "pending" ? "Awaiting a different approver" : "Not requested" }] : []),
              { label: "Run configuration", value: `${viewedPipeline.on_failure ?? "Failure policy unavailable"} · ${viewedPipeline.enabled === true ? "Enabled" : viewedPipeline.enabled === false ? "Disabled" : "Run state unavailable"}` },
              { label: "Change history", value: "Change trail unavailable" },
              { label: "Last run", value: viewedPipeline.last_run_at ? new Date(viewedPipeline.last_run_at).toLocaleString() : "Not run" },
              { label: "Last run status", value: viewedPipeline.last_status ?? "Not available" },
              { label: "Last run DQ results", value: viewedPipeline.id === selectedPipeline?.id && selectedRun ? selectedRunDq.length ? selectedRunDq.map((r) => `${r.kind}: ${r.failures ?? 0} failures / ${r.total ?? 0}`).join("; ") : "No rule results recorded" : "No run result available" },
            ]}
            title={viewedPipeline.name}
            description="Source access, run configuration, transformation steps, data-quality rules, latest results, and available actions."
            content={<div className="space-y-6">
              {messageView("view")}
              {selectedRuns.isError ? <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm">The selected pipeline run could not be refreshed. Its recent run details may be incomplete. <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => void selectedRuns.refetch()}>Refresh run details</Button></div> : null}
              <ResourceActorSummaryView mode="detail" summary={actorsById.get(viewedPipeline.id)} available={actorQ.data?.available === true} />
              <ResourceIdentitySummary summary={accessById.get(viewedPipeline.id)} available={accessQ.data?.available === true} publicIdFallback={viewedPipeline.public_uid} mode="detail" />
              <section aria-labelledby="viewed-pipeline-sources" className="space-y-2 border-b pb-5 text-sm">
                <h3 id="viewed-pipeline-sources" className="font-semibold">Configured sources</h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Input source</dt><dd className="mt-1 break-words">{sourceOptions.find((source) => source.id === viewedPipeline.source_data_source_id)?.name ?? "Source name unavailable"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Output source</dt><dd className="mt-1 break-words">{sourceOptions.find((source) => source.id === viewedPipeline.output_data_source_id)?.name ?? "Source name unavailable"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Failure behavior</dt><dd className="mt-1">{viewedPipeline.on_failure ?? "Unavailable"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Run state</dt><dd className="mt-1">{viewedPipeline.enabled === true ? "Enabled" : viewedPipeline.enabled === false ? "Disabled" : "Unavailable"}</dd></div>
                </dl>
              </section>
              <div className="divide-y divide-border text-sm">
              <section className="flex gap-4 py-5 first:pt-0 sm:gap-6 sm:py-7">
                <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:flex"><Workflow className="h-6 w-6" /></div>
                <div className="min-w-0"><h3 className="font-semibold">Configured steps ({(viewedPipeline.steps ?? []).length})</h3>{(viewedPipeline.steps ?? []).length ? <ol className="mt-2 list-decimal space-y-1 pl-5">{viewedPipeline.steps.map((step: any, index: number) => <li key={step.id ?? index}>{TRANSFORM_BY_KIND[step.kind]?.label ?? step.kind}</li>)}</ol> : <p className="mt-2 text-muted-foreground">No steps are configured. This draft is not runnable or approvable yet.</p>}</div>
              </section>
              <section className="flex gap-4 py-5 sm:gap-6 sm:py-7">
                <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:flex"><CheckCircle2 className="h-6 w-6" /></div>
                <div className="min-w-0"><h3 className="font-semibold">Configured DQ rules ({(viewedPipeline.dq_rules ?? []).length})</h3>{(viewedPipeline.dq_rules ?? []).length ? <ul className="mt-2 list-disc space-y-1 pl-5">{viewedPipeline.dq_rules.map((rule: any, index: number) => <li key={rule.id ?? index}>{rule.kind} · {rule.field} · {rule.severity ?? "warning"}</li>)}</ul> : <p className="mt-2 text-muted-foreground">No DQ rules are configured.</p>}<p className="mt-2 text-xs text-muted-foreground">Configured rules are not a passing run result.</p></div>
              </section>
              </div>
            </div>}
            actions={<>
              <Button className="min-w-36 flex-1 sm:flex-none" variant="outline" disabled={!canWrite || exec.isPending || viewedPipeline.lifecycle_state === "archived" || !(viewedPipeline.steps ?? []).length} onClick={() => exec.mutate(viewedPipeline.id)}><Play className="mr-2 h-4 w-4" />Run</Button>
              {viewedPipeline.lifecycle_state !== "archived" && viewedPipeline.status !== "approved" ? <Button className="min-w-40 flex-1 sm:flex-none" variant={canWrite && (viewedPipeline.steps ?? []).length ? "default" : "outline"} disabled={!canWrite || mApprove.isPending || !(viewedPipeline.steps ?? []).length} onClick={() => mApprove.mutate(viewedPipeline.id)}><CheckCircle2 className="mr-2 h-4 w-4" />Approve pipeline</Button> : null}
              {viewedPipeline.lifecycle_state === "production" && viewedPipeline.status === "approved" ? <><Button className="min-w-36 flex-1 sm:flex-none" variant="outline" disabled={!canWrite || mClone.isPending} onClick={() => mClone.mutate(viewedPipeline.id)}><GitBranch className="mr-2 h-4 w-4" />Clone as staging</Button><Button className="min-w-36 flex-1 sm:flex-none" variant="outline" disabled={!canWrite || mRevert.isPending} onClick={() => mRevert.mutate(viewedPipeline.id)}><RotateCcw className="mr-2 h-4 w-4" />Revert to draft</Button></> : null}
              {viewedPipeline.lifecycle_state === "staging" ? <><Button className="min-w-36 flex-1 sm:flex-none" variant="outline" onClick={() => openDiff(viewedPipeline.id)}><GitBranch className="mr-2 h-4 w-4" />Compare with production</Button>{viewedPipeline.promotion_status !== "pending" ? <Button className="min-w-40 flex-1 sm:flex-none" disabled={!canWrite || !(viewedPipeline.steps ?? []).length} onClick={() => { setPromoTarget(viewedPipeline); setPromoNote(""); setPromoOpen(true); }}><GitPullRequest className="mr-2 h-4 w-4" />Request promotion</Button> : <><Button className="min-w-40 flex-1 sm:flex-none" disabled={!canWrite || mApprovePromo.isPending || !(viewedPipeline.steps ?? []).length} onClick={() => mApprovePromo.mutate(viewedPipeline.id)}><ShieldCheck className="mr-2 h-4 w-4" />Approve promotion</Button><Button className="min-w-36 flex-1 sm:flex-none" variant="outline" disabled={!canWrite || mRejectPromo.isPending} onClick={() => mRejectPromo.mutate(viewedPipeline.id)}><X className="mr-2 h-4 w-4" />Reject promotion</Button></>}<Button className="min-w-36 flex-1 sm:flex-none" variant="outline" disabled={!canWrite} onClick={async () => { if (await confirm({ title: "Discard staging copy?" })) mDiscard.mutate(viewedPipeline.id); }}><Trash2 className="mr-2 h-4 w-4" />Discard staging</Button></> : null}
              {viewedPipeline.lifecycle_state !== "archived" && !(viewedPipeline.lifecycle_state === "production" && viewedPipeline.status === "approved") ? <Button className="min-w-36 flex-1 sm:flex-none" variant="outline" disabled={!canWrite} onClick={() => { setDraft({ ...viewedPipeline, tenant_id: tenantId }); setOpen(true); }}>Edit pipeline</Button> : null}
              {viewedPipeline.lifecycle_state === "production" ? <Button className="min-w-40 flex-1 sm:flex-none" variant="outline" disabled={!canWrite} onClick={async () => { if (await confirm({ title: "Archive pipeline?", description: "The pipeline and its run evidence will be retained." })) remove.mutate(viewedPipeline.id); }}><Trash2 className="mr-2 h-4 w-4" />Archive pipeline</Button> : null}
            </>}
          /> : <p className="p-6 text-sm text-muted-foreground">This pipeline is no longer on the current page. Close this view and locate it again.</p>}
        </DialogContent>
      </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent pipeline runs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Run ID</th><th className="px-4 py-2">Pipeline</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Rows in→out</th><th className="px-4 py-2">DQ</th><th className="px-4 py-2">Started</th></tr>
            </thead>
            <tbody>
              {(runs.data ?? []).map((r: any) => {
                const fails = (r.dq_results ?? []).reduce((a: number, x: any) => a + (x.failures ?? 0), 0);
                return (
                  <tr key={r.id} className="border-b">
                    <td className="px-4 py-2"><span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide">{r.run_uid ? String(r.run_uid).toUpperCase() : "—"}</span></td>
                    <td className="px-4 py-2">{r.pipeline?.name ?? "—"}</td>
                    <td className="px-4 py-2"><Badge variant={r.status === "failed" ? "destructive" : "outline"}>{r.status}</Badge></td>
                    <td className="px-4 py-2 text-xs">{r.rows_in} → {r.rows_out}</td>
                    <td className="px-4 py-2 text-xs">{fails} failures</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.started_at).toLocaleString()}</td>
                  </tr>
                );
              })}
              {runs.isError ? <tr><td colSpan={6} role="alert" className="px-4 py-4 text-center text-destructive">Recent pipeline run history could not be refreshed. The run list may be incomplete. <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => void runs.refetch()}>Refresh run history</Button></td></tr> : null}
              {!runs.isError && runs.data && runs.data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No runs yet. Run an approved pipeline to see its status, row counts, data quality results, and start time here.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { if (returnToViewAfterChildRef.current) { event.preventDefault(); returnToViewAfterChildRef.current = false; viewTriggerRef.current?.focus(); } }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {draft?.id ? "Edit pipeline" : "New pipeline"}
              {draft?.public_uid && <Badge variant="outline" className="font-mono text-xs">{draft.public_uid}</Badge>}
              {draft?.status && <StatusBadge status={draft.status} />}
            </DialogTitle>
          </DialogHeader>
          {messageView("editor")}
          {isApproved && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
              <Lock className="h-3.5 w-3.5" /> This pipeline is approved and consumable in ReconIQ Studio. Saving edits reverts it to <strong>draft</strong> and bumps the version.
            </div>
          )}
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="data-prep-pipeline-name">Name</Label>
                <Input id="data-prep-pipeline-name" value={draft.name} aria-invalid={Boolean(draftFieldErrors.Name)} aria-describedby={draftFieldErrors.Name ? "data-prep-name-error" : "data-prep-name-help"} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDraftFieldErrors((current) => { const next = { ...current }; delete next.Name; return next; }); setActionMessage(null); }} />
                <p id="data-prep-name-help" className="mt-1 text-xs text-muted-foreground">Use 2–120 characters.</p>
                {draftFieldErrors.Name ? <p id="data-prep-name-error" className="mt-1 text-xs text-destructive">{draftFieldErrors.Name}</p> : null}
              </div>
              <div>
                <Label>On failure</Label>
                <Select value={draft.on_failure} onValueChange={(v) => setDraft({ ...draft, on_failure: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="block">Block run</SelectItem>
                    <SelectItem value="warn">Warn & continue</SelectItem>
                    <SelectItem value="drop_rows">Drop failing rows</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="data-prep-pipeline-description">Description</Label>
              <Textarea id="data-prep-pipeline-description" rows={2} maxLength={1000} value={draft.description ?? ""} aria-invalid={Boolean(draftFieldErrors.Description)} aria-describedby={draftFieldErrors.Description ? "data-prep-description-error" : "data-prep-description-help"} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); setDraftFieldErrors((current) => { const next = { ...current }; delete next.Description; return next; }); setActionMessage(null); }} />
              <p id="data-prep-description-help" className="mt-1 text-xs text-muted-foreground">Up to 1,000 characters.</p>
              {draftFieldErrors.Description ? <p id="data-prep-description-error" className="mt-1 text-xs text-destructive">{draftFieldErrors.Description}</p> : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="data-prep-source-search">Find a data source</Label>
              <Input id="data-prep-source-search" value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} placeholder="Search source names" />
              {sources.data?.truncated ? <p className="text-xs text-muted-foreground">Showing the first {sources.data.limit} results; search by name to narrow the list.</p> : null}
              {sources.isError ? <p role="alert" className="text-xs text-destructive">Data source choices could not be loaded.</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Source data source</Label>
                <Select value={draft.source_data_source_id ?? ""} onValueChange={(v) => setDraft({ ...draft, source_data_source_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {sourceOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Output data source (required for ReconIQ Studio)</Label>
                <Select value={draft.output_data_source_id ?? ""} onValueChange={(v) => setDraft({ ...draft, output_data_source_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {sourceOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Transformation steps · {TRANSFORM_CATALOG.length}-rule catalog</div>
                <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, steps: [...(draft.steps ?? []), { kind: "trim", field: "" }] })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add step
                </Button>
              </div>
              {(draft.steps ?? []).length === 0 && <div className="text-xs text-muted-foreground">No steps yet. Example for Demo Bank Nostro USD: 1) trim whitespace 2) FX-convert to USD 3) dedupe by FITID 4) map to canonical_account.</div>}
              {(draft.steps ?? []).map((st: any, i: number) => {
                const def = TRANSFORM_BY_KIND[st.kind];
                return (
                  <div key={i} className="rounded border bg-muted/20 p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                      <Select value={st.kind} onValueChange={(v) => { const d = TRANSFORM_BY_KIND[v]; const cleaned: any = { kind: v }; (d?.params ?? []).forEach((p) => { if (st[p.name] != null) cleaned[p.name] = st[p.name]; }); setStep(i, cleaned); }}>
                        <SelectTrigger className="h-8 w-72"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-80">
                          {TRANSFORM_CATEGORIES.map((cat) => (
                            <SelectGroup key={cat}>
                              <SelectLabel className="text-[10px] uppercase">{cat}</SelectLabel>
                              {TRANSFORM_CATALOG.filter((t) => t.category === cat).map((t) => (
                                <SelectItem key={t.kind} value={t.kind}>{t.label}</SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <Badge variant="outline" className="text-[10px]">{def?.category ?? "?"}</Badge>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" onClick={() => { const s = [...draft.steps]; s.splice(i,1); setDraft({ ...draft, steps: s }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    {def?.description && <p className="ml-7 mt-1 text-[11px] text-muted-foreground">{def.description}</p>}
                    {(def?.params?.length ?? 0) > 0 && (
                      <div className="ml-7 mt-2 grid grid-cols-2 gap-2">
                        {def!.params.map((p) => (
                          <div key={p.name}>
                            <Label htmlFor={`data-prep-step-${i + 1}-${p.name}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.label}{p.required ? " *" : ""}</Label>
                            <ParamField id={`data-prep-step-${i + 1}-${p.name}`} errorId={draftFieldErrors[`Step ${i + 1} ${p.label}`] ? `data-prep-step-${i + 1}-${p.name}-error` : undefined} invalid={Boolean(draftFieldErrors[`Step ${i + 1} ${p.label}`])} param={p} value={st[p.name]} onChange={(v) => setStep(i, { [p.name]: v })} />
                            {draftFieldErrors[`Step ${i + 1} ${p.label}`] ? <p id={`data-prep-step-${i + 1}-${p.name}-error`} role="alert" className="mt-1 text-xs text-destructive">{draftFieldErrors[`Step ${i + 1} ${p.label}`]}</p> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Data quality rules</div>
                <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, dq_rules: [...(draft.dq_rules ?? []), { id: `r${(draft.dq_rules?.length ?? 0)+1}`, field: "", kind: "not_null", severity: "warning", params: {} }] })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add rule
                </Button>
              </div>
              {(draft.dq_rules ?? []).map((r: any, i: number) => (
                <div key={i} className="space-y-2 rounded-md border bg-muted/10 p-2">
              <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-2">
                      <Label className="text-[10px] uppercase text-muted-foreground">Rule ID</Label>
                      <Input aria-label={`DQ rule ${i + 1} ID`} placeholder="demo-dq-001" value={r.id} aria-invalid={Boolean(draftFieldErrors[`Rule ${i + 1} ID`])} onChange={(e) => { const rr = [...draft.dq_rules]; rr[i] = { ...rr[i], id: e.target.value }; setDraft({ ...draft, dq_rules: rr }); setDraftFieldErrors((current) => { const next = { ...current }; delete next[`Rule ${i + 1} ID`]; return next; }); }} />
                      {draftFieldErrors[`Rule ${i + 1} ID`] ? <p role="alert" className="mt-1 text-xs text-destructive">{draftFieldErrors[`Rule ${i + 1} ID`]}</p> : null}
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[10px] uppercase text-muted-foreground">Field</Label>
                      <Input aria-label={`DQ rule ${i + 1} field`} placeholder="falcon_account_number" value={r.field} aria-invalid={Boolean(draftFieldErrors[`Rule ${i + 1} field`])} onChange={(e) => { const rr = [...draft.dq_rules]; rr[i] = { ...rr[i], field: e.target.value }; setDraft({ ...draft, dq_rules: rr }); setDraftFieldErrors((current) => { const next = { ...current }; delete next[`Rule ${i + 1} field`]; return next; }); }} />
                      {draftFieldErrors[`Rule ${i + 1} field`] ? <p role="alert" className="mt-1 text-xs text-destructive">{draftFieldErrors[`Rule ${i + 1} field`]}</p> : null}
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[10px] uppercase text-muted-foreground">Rule type</Label>
                      <Select value={r.kind} onValueChange={(v) => { const rr = [...draft.dq_rules]; rr[i] = { ...rr[i], kind: v, params: {} }; setDraft({ ...draft, dq_rules: rr }); }}>
                        <SelectTrigger aria-label={`DQ rule ${i + 1} type`}><SelectValue /></SelectTrigger>
                        <SelectContent>{RULE_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[10px] uppercase text-muted-foreground">Severity</Label>
                      <Select value={r.severity ?? "warning"} onValueChange={(v) => { const rr = [...draft.dq_rules]; rr[i] = { ...rr[i], severity: v }; setDraft({ ...draft, dq_rules: rr }); }}>
                        <SelectTrigger aria-label={`DQ rule ${i + 1} severity`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="info">info</SelectItem>
                          <SelectItem value="warning">warning</SelectItem>
                          <SelectItem value="critical">critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button aria-label={`Remove DQ rule ${i + 1}`} size="sm" variant="ghost" className="col-span-1" onClick={() => { const rr = [...draft.dq_rules]; rr.splice(i,1); setDraft({ ...draft, dq_rules: rr }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                  {r.kind === "regex" && (
                    <div>
                      <Label className="text-[10px] uppercase text-muted-foreground">Safe regular expression</Label>
                      <Input aria-label={`DQ rule ${i + 1} regex pattern`} placeholder="^[A-Z]{3}$" value={r.params?.pattern ?? ""} aria-invalid={Boolean(draftFieldErrors[`Rule ${i + 1} regex pattern`])} aria-describedby={draftFieldErrors[`Rule ${i + 1} regex pattern`] ? `data-prep-rule-${i + 1}-regex-error` : undefined} onChange={(e) => { const rr = [...draft.dq_rules]; rr[i] = { ...rr[i], params: { ...rr[i].params, pattern: e.target.value } }; setDraft({ ...draft, dq_rules: rr }); setDraftFieldErrors((current) => { const next = { ...current }; delete next[`Rule ${i + 1} regex pattern`]; return next; }); }} />
                      {draftFieldErrors[`Rule ${i + 1} regex pattern`] ? <p id={`data-prep-rule-${i + 1}-regex-error`} role="alert" className="mt-1 text-xs text-destructive">{draftFieldErrors[`Rule ${i + 1} regex pattern`]}</p> : null}
                    </div>
                  )}
                  {(r.kind === "min" || r.kind === "max") && (
                    <div>
                      <Label className="text-[10px] uppercase text-muted-foreground">Numeric limit</Label>
                      <Input aria-label={`DQ rule ${i + 1} numeric limit`} type="number" value={r.params?.value ?? ""} aria-invalid={Boolean(draftFieldErrors[`Rule ${i + 1} numeric limit`])} aria-describedby={draftFieldErrors[`Rule ${i + 1} numeric limit`] ? `data-prep-rule-${i + 1}-numeric-error` : undefined} onChange={(e) => { const rr = [...draft.dq_rules]; rr[i] = { ...rr[i], params: { ...rr[i].params, value: e.target.value === "" ? undefined : Number(e.target.value) } }; setDraft({ ...draft, dq_rules: rr }); setDraftFieldErrors((current) => { const next = { ...current }; delete next[`Rule ${i + 1} numeric limit`]; return next; }); }} />
                      {draftFieldErrors[`Rule ${i + 1} numeric limit`] ? <p id={`data-prep-rule-${i + 1}-numeric-error`} role="alert" className="mt-1 text-xs text-destructive">{draftFieldErrors[`Rule ${i + 1} numeric limit`]}</p> : null}
                    </div>
                  )}
                  {r.kind === "in_set" && (
                    <div>
                      <Label className="text-[10px] uppercase text-muted-foreground">Allowed values</Label>
                      <Input aria-label={`DQ rule ${i + 1} allowed values`} placeholder="USD, EUR, GBP" value={Array.isArray(r.params?.values) ? r.params.values.join(", ") : ""} aria-invalid={Boolean(draftFieldErrors[`Rule ${i + 1} allowed values`])} aria-describedby={draftFieldErrors[`Rule ${i + 1} allowed values`] ? `data-prep-rule-${i + 1}-allowed-error` : undefined} onChange={(e) => { const rr = [...draft.dq_rules]; rr[i] = { ...rr[i], params: { ...rr[i].params, values: e.target.value.split(",").map((value) => value.trim()).filter(Boolean) } }; setDraft({ ...draft, dq_rules: rr }); setDraftFieldErrors((current) => { const next = { ...current }; delete next[`Rule ${i + 1} allowed values`]; return next; }); }} />
                      {draftFieldErrors[`Rule ${i + 1} allowed values`] ? <p id={`data-prep-rule-${i + 1}-allowed-error`} role="alert" className="mt-1 text-xs text-destructive">{draftFieldErrors[`Rule ${i + 1} allowed values`]}</p> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={save.isPending} onClick={submitDraft}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request promotion dialog */}
      <Dialog open={promoOpen} onOpenChange={setPromoOpen}>
        <DialogContent onCloseAutoFocus={(event) => { if (returnToViewAfterChildRef.current) { event.preventDefault(); returnToViewAfterChildRef.current = false; viewTriggerRef.current?.focus(); } }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitPullRequest className="h-4 w-4" /> Request promotion</DialogTitle>
            <DialogDescription>
              Promote <strong>{promoTarget?.name}</strong> into its production pipeline. A second tenant admin must approve before the swap.
            </DialogDescription>
          </DialogHeader>
          {messageView("promo")}
          <div className="space-y-2">
            <Label>Change summary (optional)</Label>
            <Textarea rows={3} placeholder="e.g. Loosened Demo Bank Nostro USD tolerance from 0.005 to 0.01 — Treasury approved 2026-06-25" value={promoNote} onChange={(e) => setPromoNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoOpen(false)}>Cancel</Button>
            <Button disabled={mReqPromo.isPending} onClick={() => promoTarget && mReqPromo.mutate({ staging_id: promoTarget.id, note: promoNote || undefined })}>
              Request promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diff dialog */}
      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { if (returnToViewAfterChildRef.current) { event.preventDefault(); returnToViewAfterChildRef.current = false; viewTriggerRef.current?.focus(); } }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4" /> Staging vs production</DialogTitle>
            <DialogDescription>Review changes before requesting promotion.</DialogDescription>
          </DialogHeader>
          {messageView("diff")}
          {diffData && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="rounded border p-2"><div className="text-muted-foreground">Steps Δ</div><div className="text-lg font-medium">{diffData.summary.steps_delta >= 0 ? "+" : ""}{diffData.summary.steps_delta}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">DQ rules Δ</div><div className="text-lg font-medium">{diffData.summary.dq_delta >= 0 ? "+" : ""}{diffData.summary.dq_delta}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">On-failure</div><div className="text-lg font-medium">{diffData.summary.on_failure_changed ? "Changed" : "Same"}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">Description</div><div className="text-lg font-medium">{diffData.summary.description_changed ? "Changed" : "Same"}</div></div>
              </div>
              {affected.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <div className="mb-1 font-medium text-amber-900 dark:text-amber-200">Promoting will affect {affected.length} reconciliation{affected.length === 1 ? "" : "s"}:</div>
                  <ul className="list-disc pl-5 text-xs">{affected.map((r) => <li key={r.id}>{r.name}</li>)}</ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Production v{diffData.production?.version ?? "?"}</div>
                  <pre className="max-h-80 overflow-auto rounded bg-muted p-2 text-[10px]">{JSON.stringify({ steps: diffData.production?.steps ?? [], dq_rules: diffData.production?.dq_rules ?? [] }, null, 2)}</pre>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Staging</div>
                  <pre className="max-h-80 overflow-auto rounded bg-muted p-2 text-[10px]">{JSON.stringify({ steps: diffData.staging?.steps ?? [], dq_rules: diffData.staging?.dq_rules ?? [] }, null, 2)}</pre>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDiffOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialog}
    </div>
  );
}
