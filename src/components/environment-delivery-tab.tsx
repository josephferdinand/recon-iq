import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  GitBranch,
  History,
  Plus,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  decideEnvironmentChange,
  exportEnvironmentChangePackage,
  getEnvironmentChange,
  importEnvironmentChangePackage,
  listEnvironmentChanges,
  requestEnvironmentChange,
} from "@/lib/environment-change.functions";
import { listAllTenants } from "@/lib/tenants.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Direction =
  | "dev_to_uat"
  | "uat_to_prod"
  | "prod_to_uat"
  | "uat_to_dev"
  | "dev_to_prod"
  | "prod_to_dev";
type TenantOption = { id: string; name: string; environment: string | null };
const runtimeEnvironment =
  import.meta.env.VITE_SUPABASE_PROJECT_ID === "YOUR_PROJECT_REF" ? "dev" : "prod";
const defaultDirection: Direction = runtimeEnvironment === "dev" ? "dev_to_prod" : "prod_to_dev";

function shortHash(value: string | null | undefined) {
  return value ? `${value.slice(0, 12)}…` : "—";
}

export function EnvironmentDeliveryTab({ controlTenantId }: { controlTenantId?: string }) {
  const queryClient = useQueryClient();
  const list = useServerFn(listEnvironmentChanges);
  const get = useServerFn(getEnvironmentChange);
  const create = useServerFn(requestEnvironmentChange);
  const decide = useServerFn(decideEnvironmentChange);
  const exportPackage = useServerFn(exportEnvironmentChangePackage);
  const importPackage = useServerFn(importEnvironmentChangePackage);
  const listTenants = useServerFn(listAllTenants);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [accessMappingConfirmed, setAccessMappingConfirmed] = useState(false);
  const [requestView, setRequestView] = useState<"outgoing" | "incoming">(
    runtimeEnvironment === "prod" ? "incoming" : "outgoing",
  );
  const [form, setForm] = useState({
    direction: defaultDirection,
    control_tenant_id: controlTenantId ?? "",
    external_tenant_id: "",
    title: "",
    reason: "",
  });

  const requests = useQuery({
    queryKey: ["environment-change-requests", controlTenantId ?? "platform"],
    queryFn: () => list({ data: { control_tenant_id: controlTenantId } }),
  });
  const tenants = useQuery({
    queryKey: ["environment-change-tenants"],
    queryFn: () => listTenants(),
    enabled: !controlTenantId,
  });
  const detail = useQuery({
    queryKey: ["environment-change-request", openId],
    queryFn: () =>
      openId ? get({ data: { id: openId, control_tenant_id: controlTenantId } }) : null,
    enabled: Boolean(openId),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return create({
        data: {
          direction: form.direction,
          source_tenant_id: form.control_tenant_id,
          target_tenant_id: form.external_tenant_id,
          title: form.title,
          reason: form.reason,
          idempotency_key: `env-${crypto.randomUUID()}`,
        },
      });
    },
    onSuccess: (result) => {
      toast.success(`Change request created · ${result.change_request_uid}`);
      setCreateOpen(false);
      setForm((current) => ({
        ...current,
        external_tenant_id: "",
        title: "",
        reason: "",
      }));
      queryClient.invalidateQueries({ queryKey: ["environment-change-requests"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const decisionMutation = useMutation({
    mutationFn: (approve: boolean) =>
      decide({
        data: {
          request_id: openId ?? "",
          approve,
          comment: decisionComment || null,
          confirm_access_mapping: accessMappingConfirmed,
        },
      }),
    onSuccess: (result) => {
      if (result.transport_status === "failed") {
        toast.error(`Source approved, but transport failed: ${result.transport_error}`);
      } else if (result.target_change_request_uid) {
        toast.success(`Source approved and sent · ${result.target_change_request_uid}`);
      } else {
        toast.success(`Change request ${result.status}`);
      }
      setDecisionComment("");
      setAccessMappingConfirmed(false);
      queryClient.invalidateQueries({ queryKey: ["environment-change-requests"] });
      queryClient.invalidateQueries({ queryKey: ["environment-change-request", openId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!controlTenantId) throw new Error("Open a target tenant before importing a package");
      const envelope = JSON.parse(importFile) as {
        schema_version: 1;
        payload: string;
        signature: string;
      };
      return importPackage({ data: { target_tenant_id: controlTenantId, envelope } });
    },
    onSuccess: (result) => {
      toast.success(`Signed package imported · ${result.change_request_uid}`);
      setImportFile("");
      setImportOpen(false);
      setRequestView("incoming");
      queryClient.invalidateQueries({ queryKey: ["environment-change-requests"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const exportMutation = useMutation({
    mutationFn: (requestId: string) => exportPackage({ data: { request_id: requestId } }),
    onSuccess: (envelope) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selected?.change_request_uid ?? "reconiq-environment-package"}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Signed environment package exported");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selected = detail.data?.request;
  const validationResults = Array.isArray(selected?.validation_results)
    ? selected.validation_results
    : [];
  const componentResults = Array.isArray(selected?.component_results)
    ? selected.component_results
    : [];
  const tenantOptions = (tenants.data ?? []) as TenantOption[];
  const visibleRequests = (requests.data ?? []).filter((request) =>
    requestView === "outgoing"
      ? request.approval_stage === "source_review"
      : request.approval_stage === "target_review",
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2" role="heading" aria-level={2}>
              <GitBranch className="h-4 w-4" /> Environment &amp; Delivery
            </CardTitle>
            <CardDescription>
              Govern DEV ↔ PROD packages with preflight, four-eyes approval, component results and
              immutable audit history.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {controlTenantId ? (
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Upload className="mr-1 h-4 w-4" /> Import signed package
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Import environment package</DialogTitle>
                    <DialogDescription>
                      Only a valid signed package for this exact environment, organization and
                      tenant can enter the incoming approval queue.
                    </DialogDescription>
                  </DialogHeader>
                  <Input
                    type="file"
                    accept="application/json,.json"
                    aria-label="Signed environment package file"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      setImportFile(file ? await file.text() : "");
                    }}
                  />
                  <Button
                    disabled={!importFile || importMutation.isPending}
                    onClick={() => importMutation.mutate()}
                  >
                    Verify and import
                  </Button>
                </DialogContent>
              </Dialog>
            ) : null}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-1 h-4 w-4" />
                  New change request
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Build environment change request</DialogTitle>
                  <DialogDescription>
                    The manifest must be generated without credentials. Execution remains disabled
                    until a different administrator approves passed preflight evidence.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Direction</Label>
                    <Select
                      value={form.direction}
                      onValueChange={(value: Direction) => setForm({ ...form, direction: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {runtimeEnvironment === "dev" ? (
                          <>
                            <SelectItem value="dev_to_prod">DEV → PROD promotion</SelectItem>
                            <SelectItem value="dev_to_uat" disabled>
                              DEV → UAT promotion · UAT not provisioned
                            </SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="prod_to_dev">PROD → DEV downgrade</SelectItem>
                            <SelectItem value="prod_to_uat" disabled>
                              PROD → UAT downgrade · UAT not provisioned
                            </SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Source tenant</Label>
                    {controlTenantId ? (
                      <Input value={controlTenantId} readOnly aria-label="Current source tenant" />
                    ) : (
                      <Select
                        value={form.control_tenant_id}
                        onValueChange={(value) => setForm({ ...form, control_tenant_id: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select tenant" />
                        </SelectTrigger>
                        <SelectContent>
                          {tenantOptions
                            .filter((tenant) => tenant.environment === runtimeEnvironment)
                            .map((tenant) => (
                              <SelectItem key={tenant.id} value={tenant.id}>
                                {tenant.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Target tenant ID</Label>
                    <Input
                      value={form.external_tenant_id}
                      onChange={(event) =>
                        setForm({ ...form, external_tenant_id: event.target.value })
                      }
                      placeholder="Governed DEV tenant UUID"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Title</Label>
                    <Input
                      value={form.title}
                      onChange={(event) => setForm({ ...form, title: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Business reason</Label>
                    <Textarea
                      rows={3}
                      value={form.reason}
                      onChange={(event) => setForm({ ...form, reason: event.target.value })}
                    />
                  </div>
                  <p className="rounded border border-dashed p-3 text-xs text-muted-foreground sm:col-span-2">
                    Package, configuration, settings and existing reconciliation access grants are
                    generated automatically from the source tenant. Credentials are never exported.
                  </p>
                </div>
                <Button
                  className="w-full"
                  disabled={
                    createMutation.isPending ||
                    !form.control_tenant_id ||
                    !form.external_tenant_id ||
                    !form.title ||
                    !form.reason
                  }
                  onClick={() => createMutation.mutate()}
                >
                  Create governed request
                </Button>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-y px-4 py-3">
            <Button
              size="sm"
              variant={requestView === "outgoing" ? "default" : "outline"}
              onClick={() => setRequestView("outgoing")}
            >
              Outgoing packages
            </Button>
            <Button
              size="sm"
              variant={requestView === "incoming" ? "default" : "outline"}
              onClick={() => setRequestView("incoming")}
            >
              Incoming approvals
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Manifest</th>
                  <th className="px-4 py-3">Requested</th>
                </tr>
              </thead>
              <tbody>
                {visibleRequests.map((request) => (
                  <tr
                    key={request.id}
                    className="cursor-pointer border-b hover:bg-muted/30"
                    onClick={() => setOpenId(request.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{request.title}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {request.change_request_uid}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 uppercase">
                        {request.source_environment}
                        <ArrowRight className="h-3.5 w-3.5" />
                        {request.target_environment}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">
                        {request.approval_stage === "source_review" ? "Outgoing" : "Incoming"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge>{request.status}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {shortHash(request.manifest_hash)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(request.requested_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {visibleRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      No {requestView} environment packages.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(openId)} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.title}</DialogTitle>
                <DialogDescription>
                  {selected.change_request_uid} · {selected.direction.replaceAll("_", " ")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Control state</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Status</span>
                      <Badge>{selected.status}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Approval stage</span>
                      <Badge variant="outline">
                        {selected.approval_stage === "source_review" ? "Source" : "Target"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Requester</span>
                      <code className="text-xs">{selected.requested_by.slice(0, 8)}…</code>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Checker</span>
                      <code className="text-xs">
                        {selected.decided_by ? `${selected.decided_by.slice(0, 8)}…` : "Pending"}
                      </code>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Integrity hashes</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 font-mono text-xs">
                    <div>package {shortHash(selected.package_hash)}</div>
                    <div>configuration {shortHash(selected.configuration_hash)}</div>
                    <div>settings {shortHash(selected.settings_hash)}</div>
                    <div>aggregate {shortHash(selected.manifest_hash)}</div>
                    <div>readback {shortHash(selected.final_readback_hash)}</div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                  Preflight validation
                </h3>
                {validationResults.length === 0 ? (
                  <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                    Awaiting governed runner preflight.
                  </p>
                ) : (
                  <pre className="overflow-x-auto rounded border bg-muted/30 p-3 text-xs">
                    {JSON.stringify(validationResults, null, 2)}
                  </pre>
                )}
              </div>

              {componentResults.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    Package / configuration / settings results
                  </h3>
                  <pre className="overflow-x-auto rounded border bg-muted/30 p-3 text-xs">
                    {JSON.stringify(componentResults, null, 2)}
                  </pre>
                </div>
              ) : null}

              {selected.approval_stage === "target_review" ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Proposed user and group mappings</h3>
                  <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-3 text-xs">
                    {JSON.stringify(selected.access_mapping_preview ?? {}, null, 2)}
                  </pre>
                </div>
              ) : null}

              {selected.approval_stage === "source_review" && selected.status === "approved" ? (
                <Button
                  variant="outline"
                  disabled={exportMutation.isPending}
                  onClick={() => exportMutation.mutate(selected.id)}
                >
                  <Download className="mr-1 h-4 w-4" /> Export signed package
                </Button>
              ) : null}

              <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <History className="h-4 w-4" />
                  Immutable audit history
                </h3>
                <div className="space-y-2">
                  {(detail.data?.events ?? []).map((event) => (
                    <div key={event.id} className="rounded border p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">
                          #{event.event_sequence} · {event.event_type.replaceAll("_", " ")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(event.occurred_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                        actor {event.actor_user_id.slice(0, 8)}… · hash {shortHash(event.row_hash)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selected.status === "pending_approval" ? (
                <div className="space-y-2 rounded border p-3">
                  <Label>Decision comment</Label>
                  <Textarea
                    value={decisionComment}
                    onChange={(event) => setDecisionComment(event.target.value)}
                  />
                  {selected.approval_stage === "target_review" ? (
                    <label className="flex items-start gap-2 rounded border p-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={accessMappingConfirmed}
                        onChange={(event) => setAccessMappingConfirmed(event.target.checked)}
                      />
                      <span>
                        I reviewed the proposed user/group mappings and confirm the target access
                        assignment plan.
                      </span>
                    </label>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      disabled={
                        decisionMutation.isPending ||
                        (selected.approval_stage === "target_review" && !accessMappingConfirmed)
                      }
                      onClick={() => decisionMutation.mutate(true)}
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={decisionMutation.isPending}
                      onClick={() => decisionMutation.mutate(false)}
                    >
                      <XCircle className="mr-1 h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Execution is deliberately unavailable in the browser. The governed runner records
                preflight, component outcomes, failed items, rollback reason and final readback
                through service-only functions.
              </p>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
