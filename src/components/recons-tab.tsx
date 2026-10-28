import { useEffect, useMemo, useState } from "react";
import { pageWithinLoadedResult } from "@/lib/list-pagination";
import { ReconRunDetailWorkbench } from "@/components/recon-run-detail-dialog";
import { ReconAccessPanel } from "@/components/recon-access-panel";
import { ReconOwnerPicker } from "@/components/recon-owner-picker";
import { ReconStudioIndex } from "@/components/recon-studio-index";
import { formatReconRunId } from "@/lib/recon-run-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listReconsPage,
  upsertRecon,
  deleteRecon,
  runReconDefinition,
  listRuns,
  type ReconListPageRow,
} from "@/lib/recons.functions";
import {
  listReconRetirementRequests,
  requestReconRetirement,
  decideReconRetirement,
} from "@/lib/recon-retirement.functions";
import { exportReconDefinitions, importReconDefinitions } from "@/lib/recon-defs-io.functions";
import { listBusinessUnits } from "@/lib/business-units.functions";
import { listDataSourceOptions } from "@/lib/data-sources.functions";
import { listApprovedPipelinesForRecon } from "@/lib/data-prep.functions";
import { listReferenceTables } from "@/lib/reference-data.functions";
import { RULE_LIBRARY, type RuleKind } from "@/lib/recon-engine";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Play, Trash2, GitBranch, Key, History, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  formatUserMessage,
  mapKnownFailure,
  type UserMessage,
  type UserMessageCategory,
} from "@/lib/user-message";
import { useConfirm } from "@/components/confirm-dialog";
import { ReconPermissionsSheet } from "@/components/recon-permissions-sheet";
import { CascadeRulesSheet } from "@/components/cascade-rules-sheet";
import { NewReconWizard } from "@/components/new-recon-wizard";
import { RekonVersionDiffDialog } from "@/components/rekon-version-diff";
import { GitCompare } from "lucide-react";
import { Sparkles } from "lucide-react";
import { useKeyboardShortcuts, type Shortcut } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { RECON_TYPE_LABELS } from "@/lib/recon-labels";
import { getResourceAccessSummaries } from "@/lib/resource-access-summaries.functions";
import { getResourceActorSummaries } from "@/lib/resource-actor-summaries.functions";

function reconWriteFailure(
  error: unknown,
  action: string,
  actionId: string,
  actionLabel: string,
): UserMessage {
  const candidate =
    error && typeof error === "object" ? (error as { code?: unknown; status?: unknown }) : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definitelyRejected = ["input", "business", "auth", "session", "mfa"].includes(
    mapped.category,
  );
  const category: UserMessageCategory = definitelyRejected
    ? mapped.category
    : "unknown_write_outcome";
  return formatUserMessage({
    ...mapped,
    category,
    action,
    code,
    status,
    availableActions:
      category === "unknown_write_outcome" || mapped.reason === "duplicate"
        ? [{ id: actionId, label: actionLabel }]
        : [],
  });
}

const TYPE_SIDES: Record<string, { side_id: string; label: string }[]> = {
  one_sided: [{ side_id: "A", label: "Source" }],
  two_sided: [
    { side_id: "A", label: "Left" },
    { side_id: "B", label: "Right" },
  ],
  three_sided: [
    { side_id: "A", label: "A" },
    { side_id: "B", label: "B" },
    { side_id: "C", label: "C" },
  ],
};

type FormState = {
  id?: string;
  name: string;
  description: string;
  recon_type: "one_sided" | "two_sided" | "three_sided";
  sides: { side_id: string; label: string; data_source_id: string }[];
  rules: {
    id: string;
    kind: RuleKind;
    description: string;
    fields: Record<string, string>;
    is_key: boolean;
    params: Record<string, any>;
  }[];
};

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  recon_type: "two_sided",
  sides: TYPE_SIDES.two_sided.map((s) => ({ ...s, data_source_id: "" })),
  rules: [],
});

export function ReconsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const listPage = useServerFn(listReconsPage);
  const upsert = useServerFn(upsertRecon);
  const del = useServerFn(deleteRecon);
  const listRetirements = useServerFn(listReconRetirementRequests);
  const requestRetirement = useServerFn(requestReconRetirement);
  const decideRetirement = useServerFn(decideReconRetirement);
  const run = useServerFn(runReconDefinition);
  const listDs = useServerFn(listDataSourceOptions);
  const listR = useServerFn(listRuns);
  const listApproved = useServerFn(listApprovedPipelinesForRecon);
  const listReferences = useServerFn(listReferenceTables);
  const getAccessSummaries = useServerFn(getResourceAccessSummaries);
  const getActorSummaries = useServerFn(getResourceActorSummaries);
  const invalidateReconActorSummaries = () =>
    qc.invalidateQueries({ queryKey: ["resource-actor-summaries", "reconciliation", tenantId] });

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("updated_desc");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedThrough, setUpdatedThrough] = useState("");
  const updatedRangeInvalid = Boolean(
    updatedFrom && updatedThrough && updatedFrom > updatedThrough,
  );
  const [page, setPage] = useState(1);
  const [showAdvancedActions, setShowAdvancedActions] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
      setFocusIdx(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const recons = useQuery({
    queryKey: [
      "recons-page",
      tenantId,
      page,
      search,
      statusFilter,
      typeFilter,
      sortOrder,
      updatedFrom,
      updatedThrough,
    ],
    queryFn: () =>
      listPage({
        data: {
          tenant_id: tenantId,
          page,
          page_size: 25,
          search: search || undefined,
          status:
            statusFilter === "all" ? undefined : (statusFilter as "draft" | "active" | "archived"),
          recon_type:
            typeFilter === "all"
              ? undefined
              : (typeFilter as "one_sided" | "two_sided" | "three_sided"),
          updated_from: updatedFrom || undefined,
          updated_through: updatedThrough || undefined,
          sort_by: sortOrder.startsWith("name") ? "name" : "updated_at",
          sort_direction: sortOrder.endsWith("asc") ? "asc" : "desc",
        },
      }),
    retry: false,
    enabled: !updatedRangeInvalid,
  });
  useEffect(() => {
    const nextPage = pageWithinLoadedResult(page, recons.data?.total_pages ?? 0, recons.isSuccess);
    if (nextPage !== page) setPage(nextPage);
  }, [page, recons.data?.total_pages, recons.isSuccess]);
  const retirements = useQuery({
    queryKey: ["recon-retirements", tenantId],
    queryFn: () => listRetirements({ data: { tenant_id: tenantId } }),
    enabled: canWrite,
  });
  const runs = useQuery({
    queryKey: ["recon-runs", tenantId],
    queryFn: () => listR({ data: { tenant_id: tenantId } }),
  });
  const approvedPipes = useQuery({
    queryKey: ["approved-pipes", tenantId],
    queryFn: () => listApproved({ data: { tenant_id: tenantId } }),
  });
  const referenceTablesQuery = useQuery({
    queryKey: ["ref-tables", tenantId],
    queryFn: () => listReferences({ data: { tenant_id: tenantId } }),
  });

  const [open, setOpen] = useState(false);
  const [runSelection, setRunSelection] = useState<{ definitionId: string; runId?: string } | null>(
    null,
  );
  const [accessSelection, setAccessSelection] = useState<{ id: string; name: string } | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [ownerBuIds, setOwnerBuIds] = useState<string[]>([]);
  const [sourceSearch, setSourceSearch] = useState("");
  const sourceIds = form.sides.map((side) => side.data_source_id).filter(Boolean);
  const selectedReconSides = Array.isArray(recons.data?.rows?.[focusIdx]?.sides)
    ? (recons.data.rows[focusIdx].sides as Array<Record<string, unknown>>)
    : [];
  const detailSourceIds = selectedReconSides.flatMap((side) =>
    typeof side.data_source_id === "string" ? [side.data_source_id] : [],
  );
  const sourceOptionIds = [...new Set([...sourceIds, ...detailSourceIds])].slice(0, 10);
  const ds = useQuery({
    queryKey: ["data-source-options", tenantId, sourceSearch, sourceOptionIds],
    queryFn: () =>
      listDs({
        data: {
          tenant_id: tenantId,
          search: sourceSearch,
          selected_ids: sourceOptionIds,
          include_schema: true,
        },
      }),
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [retirementTarget, setRetirementTarget] = useState<any | null>(null);
  const [retirementReason, setRetirementReason] = useState("");
  const [decisionTarget, setDecisionTarget] = useState<{ id: string; approve: boolean } | null>(
    null,
  );
  const [decisionReason, setDecisionReason] = useState("");
  const [moduleMessage, setModuleMessage] = useState<UserMessage | null>(null);
  const [moduleMessageContext, setModuleMessageContext] = useState<
    "page" | "editor" | "retirement" | "decision"
  >("page");
  const [draftFieldErrors, setDraftFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const dsList = [...(ds.data?.rows ?? []), ...(ds.data?.selected ?? [])].filter(
    (source, index, all) => all.findIndex((candidate) => candidate.id === source.id) === index,
  );
  const referenceTables = referenceTablesQuery.data ?? [];
  const dsMap = useMemo(() => Object.fromEntries(dsList.map((d: any) => [d.id, d])), [dsList]);

  const [wizardOpen, setWizardOpen] = useState(false);
  const openNew = () => {
    setForm(emptyForm());
    setOwnerBuIds([]);
    setDraftFieldErrors({});
    setModuleMessage(null);
    setOpen(true);
  };
  const openEdit = (r: any) => {
    if (!canWrite || r.status !== "draft") return;
    setOwnerBuIds([]);
    setForm({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      recon_type: r.recon_type,
      sides: r.sides,
      rules: r.rules.map((rule: any) => ({
        params: {},
        description: "",
        is_key: false,
        ...rule,
      })),
    });
    setOpen(true);
  };

  const updateType = (t: FormState["recon_type"]) => {
    setForm((f) => ({
      ...f,
      recon_type: t,
      sides: TYPE_SIDES[t].map((s, i) => ({
        ...s,
        data_source_id: f.sides[i]?.data_source_id ?? "",
      })),
      rules: f.rules.map((r) => ({
        ...r,
        fields: Object.fromEntries(
          TYPE_SIDES[t].map((s) => [s.side_id, r.fields[s.side_id] ?? ""]),
        ),
      })),
    }));
  };

  const addRule = () => {
    setForm((f) => ({
      ...f,
      rules: [
        ...f.rules,
        {
          id: `r${f.rules.length + 1}`,
          kind: "exact_match",
          description: "",
          is_key: f.rules.length === 0,
          fields: Object.fromEntries(f.sides.map((s) => [s.side_id, ""])),
          params: {},
        },
      ],
    }));
  };

  const mSave = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: form.id,
          tenant_id: tenantId,
          owner_bu_ids: form.id ? undefined : ownerBuIds,
          name: form.name.trim(),
          description: form.description.trim() || null,
          recon_type: form.recon_type,
          sides: form.sides.filter((s) => s.data_source_id),
          rules: form.rules,
        },
      }),
    onSuccess: () => {
      setModuleMessage(null);
      setDraftFieldErrors({});
      toast.success("Saved");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["recons", tenantId] });
      qc.invalidateQueries({ queryKey: ["recons-page", tenantId] });
      void invalidateReconActorSummaries();
    },
    onError: (error) => {
      setModuleMessageContext("editor");
      setModuleMessage(
        reconWriteFailure(
          error,
          "save this reconciliation",
          "refresh-reconciliations",
          "Refresh reconciliations",
        ),
      );
    },
  });

  const mRun = useMutation({
    mutationFn: (id: string) => run({ data: { id, tenant_id: tenantId } }),
    onSuccess: (res: any) => {
      setModuleMessage(null);
      toast.success(
        `Run complete · ${res.matched_records} matched, ${res.exception_count} exceptions`,
      );
      qc.invalidateQueries({ queryKey: ["recon-runs", tenantId] });
      qc.invalidateQueries({ queryKey: ["recon-exceptions", tenantId] });
      qc.invalidateQueries({ queryKey: ["recons-page", tenantId] });
    },
    onError: (error) => {
      setModuleMessageContext("page");
      setModuleMessage(
        reconWriteFailure(
          error,
          "run this reconciliation",
          "check-reconciliation-runs",
          "Refresh run history",
        ),
      );
    },
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      setModuleMessage(null);
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["recons", tenantId] });
      qc.invalidateQueries({ queryKey: ["recons-page", tenantId] });
      void invalidateReconActorSummaries();
    },
    onError: (error) => {
      setModuleMessageContext("page");
      setModuleMessage(
        reconWriteFailure(
          error,
          "delete this draft reconciliation",
          "refresh-reconciliations",
          "Refresh reconciliations",
        ),
      );
    },
  });

  const mRequestRetirement = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      requestRetirement({ data: { tenant_id: tenantId, recon_id: id, reason } }),
    onSuccess: () => {
      setModuleMessage(null);
      toast.success("Retirement requested. A different authorized teammate must approve it.");
      setRetirementTarget(null);
      setRetirementReason("");
      qc.invalidateQueries({ queryKey: ["recon-retirements", tenantId] });
    },
    onError: (error) => {
      setModuleMessageContext("retirement");
      setModuleMessage(
        reconWriteFailure(
          error,
          "request this reconciliation retirement",
          "refresh-retirements",
          "Refresh retirement requests",
        ),
      );
    },
  });
  const mDecideRetirement = useMutation({
    mutationFn: ({ id, approve, reason }: { id: string; approve: boolean; reason: string }) =>
      decideRetirement({ data: { request_id: id, approve, reason } }),
    onSuccess: (_result, variables) => {
      setModuleMessage(null);
      toast.success(
        variables.approve
          ? "Retirement approved. Historical results are preserved."
          : "Retirement rejected.",
      );
      setDecisionTarget(null);
      setDecisionReason("");
      qc.invalidateQueries({ queryKey: ["recon-retirements", tenantId] });
      qc.invalidateQueries({ queryKey: ["recons", tenantId] });
      qc.invalidateQueries({ queryKey: ["recons-page", tenantId] });
      void invalidateReconActorSummaries();
    },
    onError: (error) => {
      setModuleMessageContext("decision");
      setModuleMessage(
        reconWriteFailure(
          error,
          "record this retirement decision",
          "refresh-retirements",
          "Refresh retirement status",
        ),
      );
    },
  });

  function performModuleMessageAction(id: string) {
    if (id === "refresh-reconciliations") {
      void recons.refetch();
      void qc.invalidateQueries({ queryKey: ["recons-page", tenantId] });
      setOpen(false);
      setRetirementTarget(null);
      setDecisionTarget(null);
      setModuleMessageContext("page");
    }
    if (id === "check-reconciliation-runs") {
      void runs.refetch();
      void qc.invalidateQueries({ queryKey: ["recon-runs", tenantId] });
      setModuleMessageContext("page");
    }
    if (id === "refresh-retirements") {
      void retirements.refetch();
      setRetirementTarget(null);
      setDecisionTarget(null);
      setModuleMessageContext("page");
    }
  }

  function moduleMessageView(context: typeof moduleMessageContext) {
    if (!moduleMessage || moduleMessageContext !== context) return null;
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
      >
        <p className="font-medium">{moduleMessage.title}</p>
        <p className="mt-1">{moduleMessage.humanMessage}</p>
        {!["editor", "retirement", "decision"].includes(context)
          ? Object.entries(moduleMessage.fieldErrors).map(([field, copy]) => (
              <p key={field} className="mt-1 text-destructive">
                {copy}
              </p>
            ))
          : null}
        {moduleMessage.nextActions.map((action) => (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 mr-2"
            onClick={() => performModuleMessageAction(action.id)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    );
  }

  function submitReconSave() {
    const fields: Array<{
      field: string;
      issue: "required" | "invalid_format" | "unsupported_value" | "too_long" | "too_large";
      limit?: number;
    }> = [];
    const name = form.name.trim();
    if (!name) fields.push({ field: "Name", issue: "required" });
    else if (name.length < 2) fields.push({ field: "Name", issue: "invalid_format" });
    else if (name.length > 80) fields.push({ field: "Name", issue: "too_long", limit: 80 });
    if (form.description.length > 500)
      fields.push({ field: "Description", issue: "too_long", limit: 500 });
    if (!form.id && ownerBuIds.length === 0)
      fields.push({ field: "Owning business units", issue: "required" });
    form.sides.forEach((side) => {
      if (!side.data_source_id)
        fields.push({ field: `Data source for side ${side.side_id}`, issue: "required" });
    });
    if (form.sides.length > 3)
      fields.push({ field: "Reconciliation sides", issue: "too_large", limit: 3 });
    if (form.rules.length > 50)
      fields.push({ field: "Reconciliation rules", issue: "too_large", limit: 50 });
    form.rules.forEach((rule, index) => {
      if (!String(rule.id ?? "").trim())
        fields.push({ field: `Rule ${index + 1} ID`, issue: "required" });
      else if (String(rule.id).length > 64)
        fields.push({ field: `Rule ${index + 1} ID`, issue: "too_long", limit: 64 });
      form.sides.forEach((side) => {
        if (!String(rule.fields?.[side.side_id] ?? "").trim())
          fields.push({ field: `Rule ${index + 1} field on ${side.side_id}`, issue: "required" });
      });
      if (rule.kind === "reference_lookup") {
        if (!String(rule.params?.reference_table_id ?? ""))
          fields.push({ field: `Rule ${index + 1} governed reference table`, issue: "required" });
        if (!String(rule.params?.reference_value_column ?? "").trim())
          fields.push({ field: `Rule ${index + 1} return value column`, issue: "required" });
        if (
          rule.params?.reference_as_of &&
          !/^\d{4}-\d{2}-\d{2}$/u.test(String(rule.params.reference_as_of))
        )
          fields.push({ field: `Rule ${index + 1} as-of date`, issue: "invalid_format" });
      }
    });
    if (fields.length) {
      const message = formatUserMessage({
        category: "input",
        action: "save this reconciliation",
        fields,
      });
      setDraftFieldErrors(message.fieldErrors);
      setModuleMessageContext("editor");
      setModuleMessage(message);
      return;
    }
    setDraftFieldErrors({});
    setModuleMessage(null);
    mSave.mutate();
  }

  function submitRetirementRequest() {
    const length = retirementReason.trim().length;
    if (length < 12 || length > 1000) {
      const issue = length > 1000 ? "too_long" : length ? "invalid_format" : "required";
      setModuleMessageContext("retirement");
      setModuleMessage(
        formatUserMessage({
          category: "input",
          action: "request this reconciliation retirement",
          fields: [{ field: "Reason", issue, limit: issue === "too_long" ? 1000 : undefined }],
        }),
      );
      return;
    }
    setModuleMessage(null);
    if (retirementTarget)
      mRequestRetirement.mutate({ id: retirementTarget.id, reason: retirementReason.trim() });
  }

  function submitRetirementDecision() {
    const length = decisionReason.trim().length;
    if (length < 12 || length > 1000) {
      const issue = length > 1000 ? "too_long" : length ? "invalid_format" : "required";
      setModuleMessageContext("decision");
      setModuleMessage(
        formatUserMessage({
          category: "input",
          action: "record this retirement decision",
          fields: [
            { field: "Decision reason", issue, limit: issue === "too_long" ? 1000 : undefined },
          ],
        }),
      );
      return;
    }
    setModuleMessage(null);
    if (decisionTarget)
      mDecideRetirement.mutate({
        id: decisionTarget.id,
        approve: decisionTarget.approve,
        reason: decisionReason.trim(),
      });
  }

  const dsColumns = (dsId: string): string[] => {
    const d = dsMap[dsId];
    return (d?.inferred_schema ?? []).map((c: any) => c.name);
  };

  const reconRows: ReconListPageRow[] = recons.data?.rows ?? [];
  const reconIds = useMemo(
    () => [...new Set(reconRows.map((row) => row.id))].slice(0, 100),
    [reconRows],
  );
  const reconAccess = useQuery({
    queryKey: ["resource-access-summaries", "reconciliation", tenantId, reconIds],
    queryFn: () =>
      getAccessSummaries({ data: { resource_type: "reconciliation", resource_ids: reconIds } }),
    enabled: reconIds.length > 0,
    retry: false,
  });
  const reconAccessById = useMemo(
    () => new Map((reconAccess.data?.rows ?? []).map((row) => [row.resource_id, row])),
    [reconAccess.data?.rows],
  );
  const reconActors = useQuery({
    queryKey: ["resource-actor-summaries", "reconciliation", tenantId, reconIds],
    queryFn: () =>
      getActorSummaries({ data: { resource_type: "reconciliation", resource_ids: reconIds } }),
    enabled: reconIds.length > 0,
    retry: false,
  });
  const reconActorsById = useMemo(
    () => new Map((reconActors.data?.rows ?? []).map((row) => [row.resource_id, row])),
    [reconActors.data?.rows],
  );
  const retirementStatusById = useMemo(
    () =>
      new Map(
        (retirements.data?.rows ?? []).map((request) => [
          request.recon_id,
          request.mine
            ? "Pending retirement request · awaiting a different teammate"
            : "Pending retirement request · independent decision needed",
        ]),
      ),
    [retirements.data?.rows],
  );
  const modalActive =
    open ||
    wizardOpen ||
    helpOpen ||
    !!runSelection ||
    !!accessSelection ||
    !!retirementTarget ||
    !!decisionTarget;
  const focused = reconRows[focusIdx];
  const tryDeleteFocused = async () => {
    if (!focused) return;
    if (focused.status !== "draft") {
      if (retirements.data?.available) setRetirementTarget(focused);
      else
        toast.error(
          "Retirement requests are unavailable in this environment. Nothing was changed.",
        );
      return;
    }
    const ok = await confirm({
      title: `Delete draft "${focused.name}"?`,
      description:
        "Only drafts with no run history may be deleted. Approved and active reconciliations require independent approval.",
      destructive: true,
      confirmText: "Delete",
    });
    if (ok) mDelete.mutate(focused.id);
  };
  const shortcuts: Shortcut[] = useMemo(
    () => [
      {
        combo: "j",
        group: "Navigation",
        description: "Next rekon",
        handler: () => setFocusIdx((i) => Math.min(reconRows.length - 1, i + 1)),
      },
      {
        combo: "arrowdown",
        group: "Navigation",
        description: "Next rekon",
        handler: () => setFocusIdx((i) => Math.min(reconRows.length - 1, i + 1)),
      },
      {
        combo: "k",
        group: "Navigation",
        description: "Previous rekon",
        handler: () => setFocusIdx((i) => Math.max(0, i - 1)),
      },
      {
        combo: "arrowup",
        group: "Navigation",
        description: "Previous rekon",
        handler: () => setFocusIdx((i) => Math.max(0, i - 1)),
      },
      {
        combo: "enter",
        group: "Navigation",
        description: "Edit focused draft",
        handler: () => focused?.status === "draft" && canWrite && openEdit(focused),
        disabled: !canWrite || focused?.status !== "draft",
      },
      {
        combo: "n",
        group: "Create",
        description: "New reconciliation",
        handler: () => canWrite && setWizardOpen(true),
        disabled: !canWrite,
      },
      {
        combo: "shift+n",
        group: "Create",
        description: "Classic editor",
        handler: () => canWrite && openNew(),
        disabled: !canWrite,
      },
      {
        combo: "r",
        group: "Actions",
        description: "Run focused rekon",
        handler: () => canWrite && focused && mRun.mutate(focused.id),
        disabled: !canWrite,
      },
      {
        combo: "e",
        group: "Actions",
        description: "Edit focused draft",
        handler: () => canWrite && focused?.status === "draft" && openEdit(focused),
        disabled: !canWrite || focused?.status !== "draft",
      },
      {
        combo: "delete",
        group: "Actions",
        description: "Delete draft or request retirement",
        handler: () => {
          void tryDeleteFocused();
        },
        disabled: !canWrite,
      },
      {
        combo: "backspace",
        group: "Actions",
        description: "Delete draft or request retirement",
        handler: () => {
          void tryDeleteFocused();
        },
        disabled: !canWrite,
      },
      {
        combo: "?",
        group: "Help",
        description: "Show shortcuts",
        handler: () => setHelpOpen(true),
      },
      {
        combo: "shift+/",
        group: "Help",
        description: "Show shortcuts",
        handler: () => setHelpOpen(true),
      },
    ],
    [reconRows, focused, canWrite, mRun],
  );
  useKeyboardShortcuts(shortcuts, !modalActive);

  return (
    <div className="space-y-6">
      {moduleMessageView("page")}
      {canWrite && retirements.isError && (
        <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">
          Retirement requests could not be loaded. Deletion controls are unavailable until they can
          be checked.
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-3"
            onClick={() => retirements.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
      {canWrite && retirements.data?.available === false && (
        <div role="status" className="rounded-md border p-4 text-sm text-muted-foreground">
          The two-person retirement workflow is not installed in this environment. Approved
          reconciliations cannot be removed here.
        </div>
      )}
      {canWrite && retirements.data?.available && retirements.data.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending retirement requests</CardTitle>
            <CardDescription>
              A different teammate with access to this reconciliation must approve. Run results and
              audit history are retained.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {retirements.data.rows.map((request) => {
              const recon = reconRows.find((row) => row.id === request.recon_id);
              return (
                <div
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{recon?.name ?? "Reconciliation"}</p>
                    <p className="text-muted-foreground">{request.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Requested {new Date(request.requested_at).toLocaleString()} ·{" "}
                      {request.mine ? "Awaiting another teammate" : "Independent decision needed"}
                    </p>
                  </div>
                  {!request.mine && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => setDecisionTarget({ id: request.id, approve: true })}
                      >
                        Approve retirement
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDecisionTarget({ id: request.id, approve: false })}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="gap-4 border-b pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-xl">
              <GitBranch className="h-5 w-5" /> ReconIQ Studio
            </CardTitle>
            <CardDescription>
              Author Single Side, Two-Sided and Tri-Party reconciliations. {RULE_LIBRARY.length}{" "}
              matching rules including tolerances, fuzzy/phonetic, regex, sum-to-match, and 1:1 /
              1:N / N:M.
              <span className="ml-2 text-xs">
                Press <kbd className="rounded border px-1">?</kbd> for shortcuts.
              </span>
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-nowrap items-center gap-2">
            <div
              role="group"
              aria-label="Reconciliation list view"
              className="flex items-center rounded-md border p-0.5"
            >
              <Button size="sm" variant="secondary" aria-pressed="true">
                All
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled
                title="Available after governed direct, group and authored access is deployed"
              >
                My Reconciliations
              </Button>
            </div>
            {canWrite && (
              <>
                <Button onClick={() => setWizardOpen(true)}>
                  <Sparkles className="mr-2 h-4 w-4" /> New reconciliation
                </Button>
                <ImportExportButtons
                  tenantId={tenantId}
                  onChanged={() => {
                    qc.invalidateQueries({ queryKey: ["recons", tenantId] });
                    qc.invalidateQueries({ queryKey: ["recons-page", tenantId] });
                    void invalidateReconActorSummaries();
                  }}
                  onClassic={openNew}
                  onHelp={() => setHelpOpen(true)}
                />
              </>
            )}
            {!canWrite && (
              <Button type="button" size="sm" variant="outline" onClick={() => setHelpOpen(true)}>
                Keyboard shortcuts
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <ReconStudioIndex
            rows={reconRows}
            resourceAccessById={reconAccessById}
            resourceAccessAvailable={reconAccess.isSuccess && reconAccess.data.available}
            resourceAccessLoading={reconAccess.isPending && reconIds.length > 0}
            resourceActorById={reconActorsById}
            resourceActorAvailable={reconActors.data?.available === true}
            dataSourceNameById={
              new Map(
                Object.entries(dsMap).map(([id, source]: [string, any]) => [
                  id,
                  String(source.name ?? ""),
                ]),
              )
            }
            retirementStatusById={retirementStatusById}
            retirementStatusAvailable={retirements.data?.available === true}
            total={recons.data?.total ?? 0}
            page={page}
            pageSize={recons.data?.page_size ?? 25}
            totalPages={recons.data?.total_pages ?? 0}
            selectedIndex={focusIdx}
            searchInput={searchInput}
            statusFilter={statusFilter}
            typeFilter={typeFilter}
            sortOrder={sortOrder}
            updatedFrom={updatedFrom}
            updatedThrough={updatedThrough}
            updatedRangeInvalid={updatedRangeInvalid}
            isLoading={recons.isPending}
            isError={recons.isError}
            onSearchChange={setSearchInput}
            onStatusChange={(value) => {
              setStatusFilter(value);
              setPage(1);
              setFocusIdx(0);
            }}
            onTypeChange={(value) => {
              setTypeFilter(value);
              setPage(1);
              setFocusIdx(0);
            }}
            onSortChange={(value) => {
              setSortOrder(value);
              setPage(1);
              setFocusIdx(0);
            }}
            onUpdatedFromChange={(value) => {
              setUpdatedFrom(value);
              setPage(1);
              setFocusIdx(0);
            }}
            onUpdatedThroughChange={(value) => {
              setUpdatedThrough(value);
              setPage(1);
              setFocusIdx(0);
            }}
            onPageChange={(next) => {
              setPage(next);
              setFocusIdx(0);
              setShowAdvancedActions(false);
            }}
            onSelect={(index) => {
              setFocusIdx(index);
              setShowAdvancedActions(false);
            }}
            onRetry={() => {
              void recons.refetch();
            }}
            renderSelectedActions={(r, closeDetails) => {
              const sides = Array.isArray(r.sides) ? r.sides.length : 0;
              const rules = Array.isArray(r.rules) ? r.rules.length : 0;
              const requiredSides =
                r.recon_type === "three_sided" ? 3 : r.recon_type === "two_sided" ? 2 : 1;
              const canRunSelected =
                canWrite && r.status !== "archived" && sides >= requiredSides && rules > 0;
              return (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRunSelection({ definitionId: r.id });
                      closeDetails();
                    }}
                  >
                    Processed runs
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAccessSelection({ id: r.id, name: r.name })}
                  >
                    Access
                  </Button>
                  {canWrite && r.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                      Edit
                    </Button>
                  )}
                  {canWrite && (
                    <RekonVersionDiffDialog
                      reconDefinitionId={r.id}
                      reconName={r.name}
                      trigger={
                        <Button size="sm" variant="outline">
                          <GitCompare className="mr-2 h-3.5 w-3.5" /> Versions
                        </Button>
                      }
                    />
                  )}
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-expanded={showAdvancedActions}
                      onClick={() => setShowAdvancedActions((open) => !open)}
                    >
                      <MoreHorizontal className="mr-1 h-4 w-4" /> More
                    </Button>
                  )}
                  {canWrite && showAdvancedActions && (
                    <div className="flex w-full flex-wrap gap-2 border-t pt-3">
                      <Button
                        size="sm"
                        disabled={!canRunSelected || mRun.isPending}
                        title={
                          !canRunSelected
                            ? "Configure the required sources and rules first"
                            : undefined
                        }
                        onClick={() => mRun.mutate(r.id)}
                      >
                        <Play className="mr-1 h-4 w-4" /> Run
                      </Button>
                      <ReconPermissionsSheet reconId={r.id} tenantId={tenantId} />
                      <CascadeRulesSheet
                        reconId={r.id}
                        reconName={r.name}
                        tenantId={tenantId}
                        canWrite={canWrite}
                      />
                      {r.status === "draft" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete draft ${r.name}`}
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Delete draft "${r.name}"?`,
                              description:
                                "Only drafts without run history may be deleted. Approved and active reconciliations require independent approval.",
                              destructive: true,
                              confirmText: "Delete draft",
                            });
                            if (ok) mDelete.mutate(r.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" /> Delete draft
                        </Button>
                      ) : r.status !== "archived" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!retirements.data?.available}
                          onClick={() => setRetirementTarget(r)}
                        >
                          Request retirement
                        </Button>
                      ) : null}
                    </div>
                  )}
                </>
              );
            }}
          />
        </CardContent>
      </Card>
      {ConfirmDialog}
      <Dialog
        open={!!retirementTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRetirementTarget(null);
            setRetirementReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request retirement</DialogTitle>
          </DialogHeader>
          {moduleMessageView("retirement")}
          <p className="text-sm text-muted-foreground">
            {retirementTarget?.name} will remain available until a different authorized teammate
            approves. Historical runs, results and audit evidence will remain available.
          </p>
          <div className="space-y-2">
            <Label htmlFor="recon-retirement-reason">Reason for retirement</Label>
            <Textarea
              id="recon-retirement-reason"
              maxLength={1000}
              value={retirementReason}
              aria-invalid={Boolean(
                moduleMessage?.fieldErrors.Reason && moduleMessageContext === "retirement",
              )}
              aria-describedby="recon-retirement-reason-help"
              onChange={(event) => {
                setRetirementReason(event.target.value);
                setModuleMessage(null);
              }}
              placeholder="Explain why this reconciliation should be retired…"
            />
            <p id="recon-retirement-reason-help" className="text-xs text-muted-foreground">
              Enter 12–1,000 characters so the approval record has a useful reason.
            </p>
            {moduleMessageContext === "retirement" && moduleMessage?.fieldErrors.Reason ? (
              <p role="alert" className="text-xs text-destructive">
                {moduleMessage.fieldErrors.Reason}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRetirementTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={mRequestRetirement.isPending}
              onClick={submitRetirementRequest}
            >
              Send for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!decisionTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDecisionTarget(null);
            setDecisionReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionTarget?.approve ? "Approve retirement" : "Reject retirement"}
            </DialogTitle>
          </DialogHeader>
          {moduleMessageView("decision")}
          <p className="text-sm text-muted-foreground">
            This decision is recorded with your identity. Approval retires the active definition but
            preserves prior runs, results and audit history.
          </p>
          <div className="space-y-2">
            <Label htmlFor="recon-retirement-decision-reason">Decision reason</Label>
            <Textarea
              id="recon-retirement-decision-reason"
              maxLength={1000}
              value={decisionReason}
              aria-invalid={Boolean(
                moduleMessage?.fieldErrors["Decision reason"] &&
                moduleMessageContext === "decision",
              )}
              aria-describedby="recon-retirement-decision-reason-help"
              onChange={(event) => {
                setDecisionReason(event.target.value);
                setModuleMessage(null);
              }}
              placeholder="Record the reason for this decision…"
            />
            <p id="recon-retirement-decision-reason-help" className="text-xs text-muted-foreground">
              Enter 12–1,000 characters so the decision record has a useful reason.
            </p>
            {moduleMessageContext === "decision" &&
            moduleMessage?.fieldErrors["Decision reason"] ? (
              <p role="alert" className="text-xs text-destructive">
                {moduleMessage.fieldErrors["Decision reason"]}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDecisionTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={mDecideRetirement.isPending}
              onClick={submitRetirementDecision}
            >
              Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReconRunDetailWorkbench
        tenantId={tenantId}
        selection={runSelection}
        onClose={() => setRunSelection(null)}
      />
      <Dialog
        open={!!accessSelection}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setAccessSelection(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Access · {accessSelection?.name}</DialogTitle>
          </DialogHeader>
          {accessSelection && <ReconAccessPanel reconId={accessSelection.id} />}
        </DialogContent>
      </Dialog>
      <NewReconWizard
        tenantId={tenantId}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => {
          setWizardOpen(false);
          qc.invalidateQueries({ queryKey: ["recons", tenantId] });
        }}
      />
      <KeyboardShortcutsDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        shortcuts={shortcuts}
        title="ReconIQ Studio — keyboard shortcuts"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Recent runs
          </CardTitle>
          <CardDescription>Last 100 runs across this tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.isError ? (
            <div role="alert" className="mb-3 rounded-md border border-destructive/30 p-3 text-sm">
              Recent reconciliation run history could not be refreshed. The run list may be
              incomplete.{" "}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-2"
                onClick={() => void runs.refetch()}
              >
                Refresh run history
              </Button>
            </div>
          ) : null}
          {!runs.isError && (runs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No runs yet — once a ReconIQ recon executes, results appear here. Example: Demo Bank
              Nostro USD vs GL — Daily, completed 2026-06-26 06:17 UTC, 1,247 matches / 3 breaks.
            </p>
          ) : (
            <div className="space-y-2">
              {(runs.data ?? []).map((r: any) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                >
                  <div>
                    <span className="font-medium">{r.definition?.name ?? "—"}</span>{" "}
                    <Badge variant="outline" className="ml-2">
                      {r.status}
                    </Badge>
                    <button
                      type="button"
                      className="ml-2 font-mono text-xs underline underline-offset-2"
                      onClick={() =>
                        setRunSelection({ definitionId: r.definition_id, runId: r.id })
                      }
                      aria-label={`Open run ${formatReconRunId(r.run_uid, r.id)}`}
                    >
                      {formatReconRunId(r.run_uid, r.id)}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>{r.matched_count} matched</span>
                    <span>{r.exception_count} exceptions</span>
                    <span>{r.total_rows} rows</span>
                    <span>{new Date(r.started_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit recon" : "New recon"}</DialogTitle>
          </DialogHeader>
          {moduleMessageView("editor")}

          {!form.id && (
            <>
              <ReconOwnerPicker
                tenantId={tenantId}
                value={ownerBuIds}
                onChange={(value) => {
                  setOwnerBuIds(value);
                  setDraftFieldErrors((current) => {
                    const next = { ...current };
                    delete next["Owning business units"];
                    return next;
                  });
                }}
                disabled={mSave.isPending}
              />
              {draftFieldErrors["Owning business units"] ? (
                <p role="alert" className="text-xs text-destructive">
                  {draftFieldErrors["Owning business units"]}
                </p>
              ) : null}
            </>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="recon-definition-name">Name</Label>
              <Input
                id="recon-definition-name"
                value={form.name}
                aria-invalid={Boolean(draftFieldErrors.Name)}
                aria-describedby={draftFieldErrors.Name ? "recon-name-error" : "recon-name-help"}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  setDraftFieldErrors((current) => {
                    const next = { ...current };
                    delete next.Name;
                    return next;
                  });
                  setModuleMessage(null);
                }}
              />
              <p id="recon-name-help" className="mt-1 text-xs text-muted-foreground">
                Use 2–80 characters.
              </p>
              {draftFieldErrors.Name ? (
                <p id="recon-name-error" role="alert" className="mt-1 text-xs text-destructive">
                  {draftFieldErrors.Name}
                </p>
              ) : null}
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.recon_type} onValueChange={(v) => updateType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_sided">{RECON_TYPE_LABELS.one_sided}</SelectItem>
                  <SelectItem value="two_sided">{RECON_TYPE_LABELS.two_sided}</SelectItem>
                  <SelectItem value="three_sided">{RECON_TYPE_LABELS.three_sided}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="recon-definition-description">Description</Label>
              <Textarea
                id="recon-definition-description"
                maxLength={500}
                value={form.description}
                aria-invalid={Boolean(draftFieldErrors.Description)}
                aria-describedby={
                  draftFieldErrors.Description
                    ? "recon-description-error"
                    : "recon-description-help"
                }
                onChange={(e) => {
                  setForm({ ...form, description: e.target.value });
                  setDraftFieldErrors((current) => {
                    const next = { ...current };
                    delete next.Description;
                    return next;
                  });
                  setModuleMessage(null);
                }}
              />
              <p id="recon-description-help" className="mt-1 text-xs text-muted-foreground">
                Up to 500 characters.
              </p>
              {draftFieldErrors.Description ? (
                <p
                  id="recon-description-error"
                  role="alert"
                  className="mt-1 text-xs text-destructive"
                >
                  {draftFieldErrors.Description}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
            <h4 className="mb-2 text-sm font-medium">Sides</h4>
            <div className="mb-3 space-y-1">
              <Label htmlFor="recon-source-search">Find a data source</Label>
              <Input
                id="recon-source-search"
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                placeholder="Search source names"
              />
              {ds.data?.truncated ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first {ds.data.limit} results; search by name to narrow the list.
                </p>
              ) : null}
              {ds.isError ? (
                <p role="alert" className="text-xs text-destructive">
                  Data source choices could not be loaded.
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {form.sides.map((s, i) => (
                <div key={s.side_id} className="rounded border p-3">
                  <Label className="text-xs">
                    Side {s.side_id} — {s.label}
                  </Label>
                  <Select
                    value={s.data_source_id}
                    onValueChange={(v) => {
                      const next = [...form.sides];
                      next[i] = { ...s, data_source_id: v };
                      setForm({ ...form, sides: next });
                      setDraftFieldErrors((current) => {
                        const nextErrors = { ...current };
                        delete nextErrors[`Data source for side ${s.side_id}`];
                        return nextErrors;
                      });
                      setModuleMessage(null);
                    }}
                  >
                    <SelectTrigger
                      aria-label={`Data source for side ${s.side_id}`}
                      aria-invalid={Boolean(draftFieldErrors[`Data source for side ${s.side_id}`])}
                    >
                      <SelectValue placeholder="e.g. Demo Bank Nostro USD (Citi MT940)" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase">Data sources</SelectLabel>
                        {dsList.map((d: any) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      {(approvedPipes.data ?? []).length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-[10px] uppercase">
                            Approved Data Prep pipelines
                          </SelectLabel>
                          {(approvedPipes.data ?? []).map((p: any) => (
                            <SelectItem
                              key={p.output_data_source_id}
                              value={p.output_data_source_id}
                            >
                              <span className="font-mono text-xs mr-2">{p.public_uid}</span>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  {draftFieldErrors[`Data source for side ${s.side_id}`] ? (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      {draftFieldErrors[`Data source for side ${s.side_id}`]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-medium">Rules ({form.rules.length})</h4>
              <Button size="sm" variant="outline" onClick={addRule}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add rule
              </Button>
            </div>
            {form.rules.length === 0 && (
              <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">
                Add at least one rule. Mark one or more as <strong>key</strong> to define how
                records join across sides.
              </p>
            )}
            <div className="space-y-3">
              {form.rules.map((rule, idx) => {
                const lib = RULE_LIBRARY.find((x) => x.kind === rule.kind);
                return (
                  <div key={idx} className="rounded border p-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
                      <Select
                        value={rule.kind}
                        onValueChange={(v) => {
                          const next = [...form.rules];
                          next[idx] = {
                            ...rule,
                            kind: v as RuleKind,
                            params: v === "reference_lookup" ? {} : rule.params,
                          };
                          setForm({ ...form, rules: next });
                        }}
                      >
                        <SelectTrigger aria-label={`Rule ${idx + 1} type`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {RULE_LIBRARY.map((l) => (
                            <SelectItem key={l.kind} value={l.kind}>
                              {l.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="e.g. Demo Bank Treasury — daily intercompany sweep reconciliation"
                        value={rule.description}
                        onChange={(e) => {
                          const next = [...form.rules];
                          next[idx] = { ...rule, description: e.target.value };
                          setForm({ ...form, rules: next });
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={rule.is_key}
                            onCheckedChange={(c) => {
                              const next = [...form.rules];
                              next[idx] = { ...rule, is_key: !!c };
                              setForm({ ...form, rules: next });
                            }}
                          />
                          <Key className="h-3 w-3" /> Key
                        </label>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setForm({ ...form, rules: form.rules.filter((_, i) => i !== idx) });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {lib && <p className="mt-1 text-xs text-muted-foreground">{lib.description}</p>}

                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      {form.sides.map((s) => {
                        const cols = dsColumns(s.data_source_id);
                        return (
                          <div key={s.side_id}>
                            <Label className="text-xs">Field on {s.side_id}</Label>
                            <Select
                              value={rule.fields[s.side_id] || ""}
                              onValueChange={(v) => {
                                const next = [...form.rules];
                                next[idx] = { ...rule, fields: { ...rule.fields, [s.side_id]: v } };
                                setForm({ ...form, rules: next });
                                setDraftFieldErrors((current) => {
                                  const nextErrors = { ...current };
                                  delete nextErrors[`Rule ${idx + 1} field on ${s.side_id}`];
                                  return nextErrors;
                                });
                                setModuleMessage(null);
                              }}
                            >
                              <SelectTrigger
                                aria-label={`Rule ${idx + 1} field on ${s.side_id}`}
                                aria-invalid={Boolean(
                                  draftFieldErrors[`Rule ${idx + 1} field on ${s.side_id}`],
                                )}
                              >
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent className="max-h-64">
                                {cols.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {c}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {draftFieldErrors[`Rule ${idx + 1} field on ${s.side_id}`] ? (
                              <p role="alert" className="mt-1 text-xs text-destructive">
                                {draftFieldErrors[`Rule ${idx + 1} field on ${s.side_id}`]}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {rule.kind === "reference_lookup" &&
                      (() => {
                        const referenceTableId =
                          typeof rule.params.reference_table_id === "string"
                            ? rule.params.reference_table_id
                            : "";
                        const referenceTable = referenceTables.find(
                          (table) => table.id === referenceTableId,
                        );
                        const sideMappings =
                          rule.params.reference_key_fields &&
                          typeof rule.params.reference_key_fields === "object"
                            ? (rule.params.reference_key_fields as Record<string, string[]>)
                            : {};
                        return (
                          <div className="mt-3 space-y-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                            <div className="grid gap-3 md:grid-cols-3">
                              <div>
                                <Label className="text-xs">Governed reference table</Label>
                                <Select
                                  value={referenceTableId}
                                  onValueChange={(value) => {
                                    const next = [...form.rules];
                                    next[idx] = {
                                      ...rule,
                                      params: {
                                        ...rule.params,
                                        reference_table_id: value,
                                        reference_value_column: "",
                                        reference_key_fields: {},
                                      },
                                    };
                                    setForm({ ...form, rules: next });
                                  }}
                                >
                                  <SelectTrigger
                                    aria-label={`Rule ${idx + 1} governed reference table`}
                                    aria-invalid={Boolean(
                                      draftFieldErrors[`Rule ${idx + 1} governed reference table`],
                                    )}
                                  >
                                    <SelectValue placeholder="Select published table" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {referenceTables.map((table) => (
                                      <SelectItem key={table.id} value={table.id}>
                                        {table.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {draftFieldErrors[`Rule ${idx + 1} governed reference table`] ? (
                                  <p role="alert" className="mt-1 text-xs text-destructive">
                                    {draftFieldErrors[`Rule ${idx + 1} governed reference table`]}
                                  </p>
                                ) : null}
                              </div>
                              <div>
                                <Label className="text-xs">Return value column</Label>
                                <Select
                                  value={
                                    typeof rule.params.reference_value_column === "string"
                                      ? rule.params.reference_value_column
                                      : ""
                                  }
                                  disabled={!referenceTable}
                                  onValueChange={(value) => {
                                    const next = [...form.rules];
                                    next[idx] = {
                                      ...rule,
                                      params: { ...rule.params, reference_value_column: value },
                                    };
                                    setForm({ ...form, rules: next });
                                  }}
                                >
                                  <SelectTrigger
                                    aria-label={`Rule ${idx + 1} reference return column`}
                                    aria-invalid={Boolean(
                                      draftFieldErrors[`Rule ${idx + 1} return value column`],
                                    )}
                                  >
                                    <SelectValue placeholder="Select value" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(referenceTable?.value_columns ?? []).map((column) => (
                                      <SelectItem key={column} value={column}>
                                        {column}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {draftFieldErrors[`Rule ${idx + 1} return value column`] ? (
                                  <p role="alert" className="mt-1 text-xs text-destructive">
                                    {draftFieldErrors[`Rule ${idx + 1} return value column`]}
                                  </p>
                                ) : null}
                              </div>
                              <div>
                                <Label className="text-xs">Effective as of</Label>
                                <Input
                                  aria-label={`Rule ${idx + 1} reference effective as of`}
                                  type="date"
                                  value={
                                    typeof rule.params.reference_as_of === "string"
                                      ? rule.params.reference_as_of
                                      : ""
                                  }
                                  aria-invalid={Boolean(
                                    draftFieldErrors[`Rule ${idx + 1} as-of date`],
                                  )}
                                  aria-describedby={
                                    draftFieldErrors[`Rule ${idx + 1} as-of date`]
                                      ? `recon-ref-date-${idx + 1}-error`
                                      : undefined
                                  }
                                  onChange={(event) => {
                                    const next = [...form.rules];
                                    next[idx] = {
                                      ...rule,
                                      params: {
                                        ...rule.params,
                                        reference_as_of: event.target.value,
                                      },
                                    };
                                    setForm({ ...form, rules: next });
                                  }}
                                />
                                {draftFieldErrors[`Rule ${idx + 1} as-of date`] ? (
                                  <p
                                    id={`recon-ref-date-${idx + 1}-error`}
                                    role="alert"
                                    className="mt-1 text-xs text-destructive"
                                  >
                                    {draftFieldErrors[`Rule ${idx + 1} as-of date`]}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            {referenceTable && referenceTable.key_columns.length > 1 && (
                              <div className="space-y-2">
                                <p className="text-xs font-medium">Composite key mapping</p>
                                {form.sides.map((side) => (
                                  <div key={side.side_id} className="grid gap-2 md:grid-cols-3">
                                    {referenceTable.key_columns.map((keyColumn, keyIndex) => (
                                      <div key={`${side.side_id}-${keyColumn}`}>
                                        <Label className="text-[10px]">
                                          {side.side_id} field for {keyColumn}
                                        </Label>
                                        <Select
                                          value={sideMappings[side.side_id]?.[keyIndex] ?? ""}
                                          onValueChange={(value) => {
                                            const updatedSide = [
                                              ...(sideMappings[side.side_id] ?? []),
                                            ];
                                            updatedSide[keyIndex] = value;
                                            const next = [...form.rules];
                                            next[idx] = {
                                              ...rule,
                                              params: {
                                                ...rule.params,
                                                reference_key_fields: {
                                                  ...sideMappings,
                                                  [side.side_id]: updatedSide,
                                                },
                                              },
                                            };
                                            setForm({ ...form, rules: next });
                                          }}
                                        >
                                          <SelectTrigger
                                            aria-label={`Rule ${idx + 1} ${side.side_id} field for ${keyColumn}`}
                                          >
                                            <SelectValue placeholder="Select source field" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {dsColumns(side.data_source_id).map((column) => (
                                              <SelectItem key={column} value={column}>
                                                {column}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="text-[11px] text-muted-foreground">
                              The effective published version and SHA-256 are resolved at run time
                              and retained with run evidence. Missing mappings fail closed.
                            </p>
                          </div>
                        );
                      })()}

                    {rule.kind !== "reference_lookup" && lib?.params && lib.params.length > 0 && (
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {lib.params.map((p) => (
                          <div key={p}>
                            <Label className="text-xs">{p}</Label>
                            <Input
                              value={String(rule.params[p] ?? "")}
                              onChange={(e) => {
                                const next = [...form.rules];
                                const num = Number(e.target.value);
                                const val =
                                  e.target.value &&
                                  Number.isFinite(num) &&
                                  p !== "pattern" &&
                                  p !== "min" &&
                                  p !== "max"
                                    ? num
                                    : e.target.value;
                                next[idx] = { ...rule, params: { ...rule.params, [p]: val } };
                                setForm({ ...form, rules: next });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={mSave.isPending} onClick={submitReconSave}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImportExportButtons({
  tenantId,
  onChanged,
  onClassic,
  onHelp,
}: {
  tenantId: string;
  onChanged: () => void;
  onClassic: () => void;
  onHelp: () => void;
}) {
  const exportFn = useServerFn(exportReconDefinitions);
  const importFn = useServerFn(importReconDefinitions);
  const listBusinessUnitsFn = useServerFn(listBusinessUnits);
  const businessUnits = useQuery({
    queryKey: ["recon-import-owner-bus", tenantId],
    queryFn: () => listBusinessUnitsFn({ data: { tenant_id: tenantId } }),
    retry: false,
  });
  const availableBusinessUnits = (businessUnits.data ?? []).filter((unit) => !unit.is_archived);
  const inputId = `recon-import-${tenantId}`;
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [ownerBuIds, setOwnerBuIds] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<UserMessage | null>(null);
  async function doExport() {
    try {
      const pkg = await exportFn({ data: { tenant_id: tenantId } });
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recon-definitions-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setImportMessage(null);
      toast.success(`Exported ${pkg.count} definitions`);
    } catch (error) {
      const candidate =
        error && typeof error === "object" ? (error as { code?: unknown; status?: unknown }) : {};
      const code = typeof candidate.code === "string" ? candidate.code : undefined;
      const status = typeof candidate.status === "number" ? candidate.status : undefined;
      const mapped = mapKnownFailure(code, status);
      const category: UserMessageCategory = [
        "auth",
        "session",
        "mfa",
        "network",
        "timeout",
        "dependency",
      ].includes(mapped.category)
        ? mapped.category
        : "system";
      setImportMessage(
        formatUserMessage({
          ...mapped,
          category,
          action: "export reconciliation definitions",
          code,
          status,
          retryable: true,
          availableActions: [{ id: "retry-export", label: "Retry export" }],
        }),
      );
    }
  }
  async function doImport() {
    if (!pendingFile || ownerBuIds.length === 0 || isImporting) return;
    setIsImporting(true);
    try {
      const text = await pendingFile.text();
      const payload = JSON.parse(text);
      const fields: Array<{
        field: string;
        issue: "required" | "invalid_format" | "unsupported_value" | "too_long" | "too_large";
        limit?: number;
        allowedValues?: readonly string[];
      }> = [];
      if (!payload || payload.format !== "fvi-recon-defs/v1")
        fields.push({
          field: "Definitions file format",
          issue: "unsupported_value",
          allowedValues: ["fvi-recon-defs/v1"],
        });
      if (!Array.isArray(payload?.definitions) || payload.definitions.length === 0)
        fields.push({ field: "Definitions", issue: "required" });
      else if (payload.definitions.length > 500)
        fields.push({ field: "Definitions", issue: "too_large", limit: 500 });
      if (ownerBuIds.length > 50)
        fields.push({ field: "Owning business units", issue: "too_large", limit: 50 });
      (Array.isArray(payload?.definitions) ? payload.definitions : []).forEach(
        (definition: any, index: number) => {
          if (typeof definition?.name !== "string" || !definition.name.trim())
            fields.push({ field: `Definition ${index + 1} name`, issue: "required" });
          else if (definition.name.trim().length > 120)
            fields.push({ field: `Definition ${index + 1} name`, issue: "too_long", limit: 120 });
          if (
            definition?.description != null &&
            (typeof definition.description !== "string" || definition.description.length > 2000)
          )
            fields.push({
              field: `Definition ${index + 1} description`,
              issue: typeof definition.description === "string" ? "too_long" : "invalid_format",
              limit: typeof definition.description === "string" ? 2000 : undefined,
            });
          if (!["one_sided", "two_sided", "three_sided"].includes(definition?.recon_type))
            fields.push({
              field: `Definition ${index + 1} reconciliation type`,
              issue: "unsupported_value",
              allowedValues: ["one_sided", "two_sided", "three_sided"],
            });
          if (!Array.isArray(definition?.sides))
            fields.push({ field: `Definition ${index + 1} sides`, issue: "invalid_format" });
          else if (definition.sides.length > 3)
            fields.push({ field: `Definition ${index + 1} sides`, issue: "too_large", limit: 3 });
          if (!Array.isArray(definition?.rules))
            fields.push({ field: `Definition ${index + 1} rules`, issue: "invalid_format" });
          else if (definition.rules.length > 100)
            fields.push({ field: `Definition ${index + 1} rules`, issue: "too_large", limit: 100 });
        },
      );
      if (fields.length) {
        setImportMessage(
          formatUserMessage({
            category: "input",
            action: "import these reconciliation definitions",
            fields,
            availableActions: [{ id: "choose-import-file", label: "Choose another file" }],
          }),
        );
        return;
      }
      try {
        const r = await importFn({
          data: { tenant_id: tenantId, payload, owner_bu_ids: ownerBuIds, mode: "skip" },
        });
        setImportMessage(null);
        toast.success(`Imported: ${r.inserted} new · ${r.updated} updated · ${r.skipped} skipped`);
        setImportOpen(false);
        setPendingFile(null);
        onChanged();
      } catch (error) {
        setImportMessage(
          reconWriteFailure(
            error,
            "import these reconciliation definitions",
            "refresh-reconciliations",
            "Refresh reconciliations before retrying",
          ),
        );
      }
    } catch {
      setImportMessage(
        formatUserMessage({
          category: "input",
          action: "read this definitions file",
          fields: [{ field: "Definitions file", issue: "invalid_format" }],
          availableActions: [{ id: "choose-import-file", label: "Choose another file" }],
        }),
      );
    } finally {
      setIsImporting(false);
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <MoreHorizontal className="mr-1 h-4 w-4" /> Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              void doExport();
            }}
          >
            Export definitions
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => document.getElementById(inputId)?.click()}>
            Import definitions
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onClassic}>Classic editor</DropdownMenuItem>
          <DropdownMenuItem onSelect={onHelp}>Keyboard shortcuts</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!importOpen && importMessage ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium">{importMessage.title}</p>
          <p className="mt-1">{importMessage.humanMessage}</p>
          {Object.entries(importMessage.fieldErrors).map(([field, copy]) => (
            <p key={field} className="mt-1 text-destructive">
              {copy}
            </p>
          ))}
          {importMessage.nextActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 mr-2"
              onClick={() => {
                if (action.id === "retry-export") void doExport();
                if (action.id === "refresh-reconciliations") {
                  onChanged();
                  setImportOpen(false);
                }
                if (action.id === "choose-import-file") document.getElementById(inputId)?.click();
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
      <input
        id={inputId}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          if (!file.name.toLowerCase().endsWith(".json")) {
            setImportMessage(
              formatUserMessage({
                category: "input",
                action: "import these reconciliation definitions",
                fields: [
                  { field: "File type", issue: "unsupported_value", allowedValues: [".json"] },
                ],
                availableActions: [{ id: "choose-import-file", label: "Choose another file" }],
              }),
            );
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            setImportMessage(
              formatUserMessage({
                category: "input",
                action: "import these reconciliation definitions",
                fields: [
                  { field: "File size (bytes)", issue: "too_large", limit: 5 * 1024 * 1024 },
                ],
                availableActions: [{ id: "choose-import-file", label: "Choose another file" }],
              }),
            );
            return;
          }
          setImportMessage(null);
          setPendingFile(file);
          setOwnerBuIds([]);
          setImportOpen(true);
        }}
      />
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) setPendingFile(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import definitions</DialogTitle>
            <CardDescription>
              New definitions are created as drafts. Existing names are skipped. Choose the owning
              business units for every new definition in this file.
            </CardDescription>
          </DialogHeader>
          {importMessage ? (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-destructive/30 p-3 text-sm"
            >
              <p className="font-medium">{importMessage.title}</p>
              <p className="mt-1">{importMessage.humanMessage}</p>
              {Object.entries(importMessage.fieldErrors).map(([field, copy]) => (
                <p key={field} className="mt-1 text-destructive">
                  {copy}
                </p>
              ))}
            </div>
          ) : null}
          <fieldset
            className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3"
            disabled={businessUnits.isPending || businessUnits.isError}
          >
            <legend className="px-1 text-sm font-medium">Owning business units</legend>
            {businessUnits.isPending && (
              <p className="text-sm text-muted-foreground">Loading business units…</p>
            )}
            {businessUnits.isError && (
              <p role="alert" className="text-sm text-destructive">
                Business units could not be loaded. Import is unavailable until the available owners
                can be checked.
              </p>
            )}
            {businessUnits.isSuccess && availableBusinessUnits.length === 0 && (
              <p role="alert" className="text-sm text-destructive">
                No active business unit is available for this tenant.
              </p>
            )}
            {availableBusinessUnits.map((unit) => (
              <label key={unit.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={ownerBuIds.includes(unit.id)}
                  onCheckedChange={(checked) =>
                    setOwnerBuIds((current) =>
                      checked === true
                        ? [...new Set([...current, unit.id])]
                        : current.filter((id) => id !== unit.id),
                    )
                  }
                />
                <span>
                  {unit.depth > 0 ? "↳ " : ""}
                  {unit.name}
                  {unit.code ? (
                    <span className="ml-2 text-xs text-muted-foreground">{unit.code}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
          {businessUnits.isError ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void businessUnits.refetch()}
            >
              Refresh business units
            </Button>
          ) : null}
          {!businessUnits.isPending &&
          businessUnits.isSuccess &&
          availableBusinessUnits.length > 0 &&
          ownerBuIds.length === 0 ? (
            <p role="alert" className="text-xs text-destructive">
              Select at least one owning business unit before importing.
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void doImport();
              }}
              disabled={
                !pendingFile ||
                ownerBuIds.length === 0 ||
                businessUnits.isPending ||
                businessUnits.isError ||
                isImporting
              }
            >
              {isImporting ? "Importing…" : "Import as drafts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
