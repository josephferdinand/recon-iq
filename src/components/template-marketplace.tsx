import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listMarketplace,
  getTemplate,
  upsertTemplate,
  createVersion,
  approveVersion,
  publishVersion,
  retireTemplate,
  installTemplate,
  listTenantInstalls,
  listTenantTemplates,
  listTenantTemplatesPage,
  getTenantTemplateLatestRun,
  saveTenantTemplateFromRecon,
  cloneTenantTemplate,
  transitionTenantTemplate,
  instantiateTenantTemplate,
  uninstallTemplate,
  assignToWorkspace,
  listWorkspaceAssignments,
  revokeAssignment,
  getAuditTrail,
  getTenantTemplateLifecycle,
  aiRecommendTemplates,
  aiGenerateFromPrompt,
} from "@/lib/template-marketplace.functions";
import { listRecons } from "@/lib/recons.functions";
import { listBusinessUnits } from "@/lib/business-units.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { toast } from "sonner";
import { USER_FACING_ERRORS, userFacingErrorKind } from "@/lib/user-facing-errors";
import {
  Package,
  Download,
  ShieldCheck,
  Sparkles,
  History,
  Trash2,
  Send,
  Star,
  Wand2,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type Scope =
  | { kind: "platform" }
  | { kind: "tenant"; tenantId: string }
  | { kind: "workspace"; workspaceId?: string; tenantId: string };

function templateErrorText(error: unknown) {
  const copy = USER_FACING_ERRORS[userFacingErrorKind(error)];
  return `${copy.message} ${copy.action}`;
}

export function TemplateMarketplace({ scope }: { scope: Scope }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<{
    search?: string;
    pack_type?: string;
    industry?: string;
    region?: string;
    standard?: string;
  }>({});

  const listFn = useServerFn(listMarketplace);
  const listQ = useQuery({
    queryKey: ["mkt-list", filters],
    queryFn: () => listFn({ data: filters }),
  });

  return (
    <div className="space-y-6">
      <Tabs defaultValue={scope.kind === "workspace" ? "installed" : "browse"} className="w-full">
        <TabsList className="grid grid-cols-5 w-full max-w-3xl">
          <TabsTrigger value="browse">Browse</TabsTrigger>
          {scope.kind === "platform" && <TabsTrigger value="publish">Publish</TabsTrigger>}
          {scope.kind !== "platform" && <TabsTrigger value="installed">My Templates</TabsTrigger>}
          {scope.kind === "workspace" && scope.workspaceId && (
            <TabsTrigger value="assignments">Assignments</TabsTrigger>
          )}
          {scope.kind !== "workspace" && <TabsTrigger value="ai">AI Assist</TabsTrigger>}
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>

        {/* ── BROWSE ── */}
        <TabsContent value="browse" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" /> Template Gallery
              </CardTitle>
              <CardDescription>
                {listQ.data?.templates.length ?? 0} certified and approved templates across
                industries, regulators, and packs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                <div className="relative md:col-span-2">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search templates…"
                    value={filters.search ?? ""}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, search: e.target.value || undefined }))
                    }
                  />
                </div>
                <Select
                  value={filters.pack_type ?? "all"}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, pack_type: v === "all" ? undefined : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pack type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="featured">Featured</SelectItem>
                    <SelectItem value="regulatory">Regulatory</SelectItem>
                    <SelectItem value="industry">Industry</SelectItem>
                    <SelectItem value="pack">Pack</SelectItem>
                    <SelectItem value="community">Community</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Industry (e.g. banking)"
                  value={filters.industry ?? ""}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, industry: e.target.value || undefined }))
                  }
                />
                <Input
                  placeholder="Standard (e.g. IFRS)"
                  value={filters.standard ?? ""}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, standard: e.target.value || undefined }))
                  }
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(listQ.data?.templates ?? []).map((t: any) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    scope={scope}
                    onChange={() => qc.invalidateQueries({ queryKey: ["mkt-list"] })}
                  />
                ))}
                {listQ.isSuccess && (listQ.data?.templates.length ?? 0) === 0 && (
                  <div className="col-span-full text-sm text-muted-foreground p-8 text-center border rounded-md">
                    No templates match the filters.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {scope.kind === "platform" && (
          <TabsContent value="publish">
            <PublishTab />
          </TabsContent>
        )}

        {scope.kind === "tenant" && (
          <TabsContent value="installed">
            <TenantInstalledTab tenantId={scope.tenantId} />
          </TabsContent>
        )}

        {scope.kind === "workspace" && (
          <>
            <TabsContent value="installed">
              <TenantInstalledTab tenantId={scope.tenantId} readOnly />
            </TabsContent>
            {scope.workspaceId ? (
              <TabsContent value="assignments">
                <WorkspaceAssignmentsTab
                  workspaceId={scope.workspaceId}
                  tenantId={scope.tenantId}
                />
              </TabsContent>
            ) : null}
          </>
        )}

        {scope.kind !== "workspace" && (
          <TabsContent value="ai">
            <AiAssistTab
              tenantId={scope.kind === "tenant" ? scope.tenantId : undefined}
            />
          </TabsContent>
        )}

        <TabsContent value="audit">
          <AuditTrailTab scope={scope} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
function TemplateCard({
  template,
  scope,
  onChange,
}: {
  template: any;
  scope: Scope;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const getFn = useServerFn(getTemplate);
  const detailQ = useQuery({
    enabled: open,
    queryKey: ["mkt-detail", template.id],
    queryFn: () => getFn({ data: { id: template.id } }),
  });

  const installFn = useServerFn(installTemplate);
  const retireFn = useServerFn(retireTemplate);
  const qc = useQueryClient();
  const installM = useMutation({
    mutationFn: () =>
      installFn({
        data: {
          tenant_id: scope.kind === "tenant" ? scope.tenantId : (scope as any).tenantId,
          template_id: template.id,
          auto_update: false,
        },
      }),
    onSuccess: () => {
      toast.success("Template installed into tenant repository");
      qc.invalidateQueries({ queryKey: ["mkt-installs"] });
      qc.invalidateQueries({ queryKey: ["mkt-tenant-templates"] });
    },
    onError: (e: any) => toast.error(templateErrorText(e)),
  });
  const retireM = useMutation({
    mutationFn: () => retireFn({ data: { template_id: template.id } }),
    onSuccess: () => {
      toast.success("Template retired");
      onChange();
    },
    onError: (e: any) => toast.error(templateErrorText(e)),
  });

  const canInstall = scope.kind === "tenant";
  const canRetire = scope.kind === "platform";

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{template.title}</CardTitle>
          <Badge
            variant={template.certification === "certified" ? "default" : "secondary"}
            className="shrink-0"
          >
            {template.certification}
          </Badge>
        </div>
        <CardDescription className="line-clamp-2">{template.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-xs">
            {template.pack_type}
          </Badge>
          {template.domain_key && (
            <Badge variant="outline" className="text-xs uppercase">
              {template.domain_key.replace(/_/g, " ")}
            </Badge>
          )}
          {typeof template.certification_score === "number" && (
            <Badge
              variant={template.certification_score >= 90 ? "default" : template.certification_score >= 70 ? "secondary" : "outline"}
              className="text-xs"
              title={`Recon ${template.recon_score ?? 0} · AI ${template.ai_score ?? 0} · Gov ${template.governance_score ?? 0}`}
            >
              ERTS {template.certification_score}
            </Badge>
          )}
          {template.spec_valid === false && (
            <Badge variant="destructive" className="text-xs">refactor</Badge>
          )}
          {(template.industries ?? []).slice(0, 2).map((i: string) => (
            <Badge key={i} variant="outline" className="text-xs">
              {i}
            </Badge>
          ))}
          {(template.standards ?? []).slice(0, 3).map((s: string) => (
            <Badge key={s} variant="secondary" className="text-xs">
              {s}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            {template.install_count ?? 0}
          </span>
          {template.avg_rating > 0 && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" /> {Number(template.avg_rating).toFixed(1)}
            </span>
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary" className="flex-1">
                Details
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{template.title}</DialogTitle>
                <DialogDescription>{template.description ?? template.summary}</DialogDescription>
              </DialogHeader>
              {detailQ.data && (
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium">Standards:</span>{" "}
                    {(detailQ.data.template.standards ?? []).join(", ") || "—"}
                  </div>
                  <div>
                    <span className="font-medium">Regions:</span>{" "}
                    {(detailQ.data.template.regions ?? []).join(", ") || "—"}
                  </div>
                  <div>
                    <span className="font-medium">Versions:</span>
                    <ul className="mt-1 space-y-1">
                      {detailQ.data.versions.map((v: any) => (
                        <li key={v.id} className="flex items-center gap-2">
                          <Badge variant="outline">{v.semver}</Badge>
                          <span className="text-muted-foreground">{v.status}</span>
                          {v.changelog && (
                            <span className="text-xs text-muted-foreground truncate">
                              — {v.changelog}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
          {canInstall && (
            <Button
              size="sm"
              onClick={() => installM.mutate()}
              disabled={installM.isPending}
              className="flex-1"
            >
              <Download className="h-3 w-3 mr-1" />
              {installM.isPending ? "Installing…" : "Install"}
            </Button>
          )}
          {canRetire && !template.retired_at && (
            <Button
              aria-label={`Retire ${template.title}`}
              size="sm"
              variant="destructive"
              onClick={() => retireM.mutate()}
              disabled={retireM.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
function PublishTab() {
  const upsertFn = useServerFn(upsertTemplate);
  const createVerFn = useServerFn(createVersion);
  const approveFn = useServerFn(approveVersion);
  const publishFn = useServerFn(publishVersion);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    slug: "",
    title: "",
    summary: "",
    pack_type: "industry",
    industries: "",
    regions: "",
    standards: "",
  });
  const [publishForm, setPublishForm] = useState({ version_id: "" });

  const upsertM = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          slug: form.slug,
          title: form.title,
          summary: form.summary,
          pack_type: form.pack_type as any,
          industries: form.industries.split(",").map((s) => s.trim()).filter(Boolean),
          regions: form.regions.split(",").map((s) => s.trim()).filter(Boolean),
          standards: form.standards.split(",").map((s) => s.trim()).filter(Boolean),
          certification: "draft",
        } as any,
      }),
    onSuccess: () => {
      toast.success("Draft template saved");
      qc.invalidateQueries({ queryKey: ["mkt-list"] });
    },
    onError: (e: any) => toast.error(templateErrorText(e)),
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Draft new template
          </CardTitle>
          <CardDescription>
            Draft, review, approve (dual control), then publish. Only platform admins may act.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["slug", "title", "summary"] as const).map((k) => (
            <div key={k}>
              <Label className="capitalize">{k}</Label>
              <Input
                value={(form as any)[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </div>
          ))}
          <div>
            <Label>Pack type</Label>
            <Select
              value={form.pack_type}
              onValueChange={(v) => setForm({ ...form, pack_type: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="industry">Industry</SelectItem>
                <SelectItem value="regulatory">Regulatory</SelectItem>
                <SelectItem value="featured">Featured</SelectItem>
                <SelectItem value="pack">Pack</SelectItem>
                <SelectItem value="community">Community</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(["industries", "regions", "standards"] as const).map((k) => (
            <div key={k}>
              <Label className="capitalize">{k} (comma-separated)</Label>
              <Input
                value={(form as any)[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </div>
          ))}
          <Button onClick={() => upsertM.mutate()} disabled={upsertM.isPending}>
            {upsertM.isPending ? "Saving…" : "Save draft"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Approve & publish version
          </CardTitle>
          <CardDescription>
            Approver must differ from author (dual-control enforced by RLS).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Version ID (uuid)</Label>
            <Input
              value={publishForm.version_id}
              onChange={(e) => setPublishForm({ version_id: e.target.value })}
              placeholder="00000000-0000-…"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await approveFn({ data: { version_id: publishForm.version_id } });
                  toast.success("Approved");
                } catch (e: any) {
                  toast.error(templateErrorText(e));
                }
              }}
              disabled={!publishForm.version_id}
            >
              Approve
            </Button>
            <Button
              onClick={async () => {
                try {
                  await publishFn({ data: { version_id: publishForm.version_id } });
                  toast.success("Published");
                  qc.invalidateQueries({ queryKey: ["mkt-list"] });
                } catch (e: any) {
                  toast.error(templateErrorText(e));
                }
              }}
              disabled={!publishForm.version_id}
            >
              Publish
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            To create a new version, use the API <code>createVersion</code>. Version IDs are shown
            in the template detail dialog on the Browse tab.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
function TenantInstalledTab({
  tenantId,
  readOnly = false,
}: {
  tenantId: string;
  readOnly?: boolean;
}) {
  const installsFn = useServerFn(listTenantInstalls);
  const tenantTplFn = useServerFn(listTenantTemplatesPage);
  const uninstallFn = useServerFn(uninstallTemplate);
  const saveTenantFn = useServerFn(saveTenantTemplateFromRecon);
  const cloneTenantFn = useServerFn(cloneTenantTemplate);
  const transitionTenantFn = useServerFn(transitionTenantTemplate);
  const instantiateTenantFn = useServerFn(instantiateTenantTemplate);
  const listReconsFn = useServerFn(listRecons);
  const businessUnitsFn = useServerFn(listBusinessUnits);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tenant_template_id: "new",
    recon_definition_id: "",
    title: "",
    semver: "1.0.0",
    changelog: "Initial governed template snapshot",
  });
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateStatus, setTemplateStatus] = useState("all");
  const [assetClassSearch, setAssetClassSearch] = useState("");
  const [templatePage, setTemplatePage] = useState(1);
  const [templatePageSize, setTemplatePageSize] = useState<25 | 50 | 100>(25);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [instantiatingTemplateId, setInstantiatingTemplateId] = useState<string | null>(null);
  const [ownerBuIds, setOwnerBuIds] = useState<string[]>([]);

  const installsQ = useQuery({
    queryKey: ["mkt-installs", tenantId],
    queryFn: () => installsFn({ data: { tenant_id: tenantId } }),
  });
  const tenantTplQ = useQuery({
    queryKey: ["mkt-tenant-templates", tenantId, templateSearch, assetClassSearch, templateStatus, templatePage, templatePageSize],
    queryFn: () => tenantTplFn({ data: {
      tenant_id: tenantId,
      page: templatePage,
      page_size: templatePageSize,
      search: templateSearch || undefined,
      asset_class: assetClassSearch || undefined,
      status: templateStatus === "all" ? undefined : templateStatus as "draft" | "review" | "approved" | "published" | "deprecated" | "archived",
    } }),
  });
  const reconsQ = useQuery({
    queryKey: ["recons", tenantId],
    queryFn: () => listReconsFn({ data: { tenant_id: tenantId } }),
  });
  const businessUnitsQ = useQuery({
    queryKey: ["business-units", tenantId],
    queryFn: () => businessUnitsFn({ data: { tenant_id: tenantId } }),
  });
  const ownerUnits = (businessUnitsQ.data ?? []).filter((unit: any) => !unit.is_archived);
  const tenantTemplates = tenantTplQ.data?.rows ?? [];
  const visibleTenantTemplates = tenantTemplates;
  const selectedTenantTemplate = visibleTenantTemplates.find((row) => row.id === selectedTemplateId)
    ?? visibleTenantTemplates[0]
    ?? null;

  const uninstallM = useMutation({
    mutationFn: (install_id: string) => uninstallFn({ data: { install_id } }),
    onSuccess: () => {
      toast.success("Uninstalled");
      qc.invalidateQueries({ queryKey: ["mkt-installs"] });
    },
    onError: (e: any) => toast.error(templateErrorText(e)),
  });
  const refreshTenantTemplates = () => {
    qc.invalidateQueries({ queryKey: ["mkt-tenant-templates", tenantId] });
    qc.invalidateQueries({ queryKey: ["recons", tenantId] });
    qc.invalidateQueries({ queryKey: ["mkt-audit"] });
  };
  const saveM = useMutation({
    mutationFn: () => saveTenantFn({ data: {
      tenant_id: tenantId,
      recon_definition_id: form.recon_definition_id,
      title: form.title,
      semver: form.semver,
      changelog: form.changelog,
      tenant_template_id: form.tenant_template_id === "new" ? null : form.tenant_template_id,
    } }),
    onSuccess: () => {
      toast.success(form.tenant_template_id === "new" ? "My Template created" : "Immutable template version saved");
      setForm({ tenant_template_id: "new", recon_definition_id: "", title: "", semver: "1.0.0", changelog: "Initial governed template snapshot" });
      refreshTenantTemplates();
    },
    onError: (error: Error) => toast.error(templateErrorText(error)),
  });
  const cloneM = useMutation({
    mutationFn: (row: { id: string; title: string }) => cloneTenantFn({ data: {
      tenant_id: tenantId,
      source_template_id: row.id,
      title: `${row.title.slice(0, 88)} — Copy ${new Date().toISOString().slice(11, 19).replace(/:/gu, "")}`,
    } }),
    onSuccess: () => { toast.success("Template cloned as a new draft"); refreshTenantTemplates(); },
    onError: (error: Error) => toast.error(templateErrorText(error)),
  });
  const transitionM = useMutation({
    mutationFn: (input: { id: string; action: "submit" | "approve" | "reject" | "publish" | "unpublish" }) =>
      transitionTenantFn({ data: { tenant_id: tenantId, tenant_template_id: input.id, action: input.action } }),
    onSuccess: (result) => { toast.success(`Template is now ${result.status}`); refreshTenantTemplates(); },
    onError: (error: Error) => toast.error(templateErrorText(error)),
  });
  const instantiateM = useMutation({
    mutationFn: (row: { id: string; title: string; owner_bu_ids: string[] }) => instantiateTenantFn({ data: {
      tenant_id: tenantId,
      tenant_template_id: row.id,
      name: `${row.title.slice(0, 60)} — ${new Date().toISOString().slice(11, 19).replace(/:/gu, "")}`,
      owner_bu_ids: row.owner_bu_ids,
    } }),
    onSuccess: (result) => { toast.success(`Created runnable draft ${result.recon_code}`); setInstantiatingTemplateId(null); refreshTenantTemplates(); },
    onError: (error: Error) => toast.error(templateErrorText(error)),
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {!readOnly ? (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Create or version My Template</CardTitle>
            <CardDescription>
              Snapshot a real tenant reconciliation. New versions are immutable; publishing requires a different active tenant administrator to approve first.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Template</Label>
              <Select value={form.tenant_template_id} onValueChange={(value) => {
                const existing = (tenantTplQ.data?.rows ?? []).find((row) => row.id === value);
                setForm((current) => ({
                  ...current,
                  tenant_template_id: value,
                  title: existing?.title ?? "",
                  semver: value === "new" ? "1.0.0" : current.semver,
                  changelog: value === "new" ? "Initial governed template snapshot" : "Updated from current reconciliation configuration",
                }));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New My Template</SelectItem>
                  {(tenantTplQ.data?.rows ?? []).map((row) => <SelectItem key={row.id} value={row.id}>{row.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source reconciliation</Label>
              <Select value={form.recon_definition_id} onValueChange={(value) => {
                const recon = (reconsQ.data ?? []).find((row) => row.id === value);
                setForm((current) => ({ ...current, recon_definition_id: value, title: current.title || recon?.name || "" }));
              }}>
                <SelectTrigger><SelectValue placeholder="Choose a configured reconciliation" /></SelectTrigger>
                <SelectContent>
                  {(reconsQ.data ?? []).map((row) => <SelectItem key={row.id} value={row.id}>{row.recon_code} · {row.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Template title</Label>
              <Input value={form.title} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </div>
            <div>
              <Label>Semantic version</Label>
              <Input value={form.semver} onChange={(event) => setForm((current) => ({ ...current, semver: event.target.value }))} placeholder="1.0.0" />
            </div>
            <div className="md:col-span-2">
              <Label>Version notes</Label>
              <Input value={form.changelog} maxLength={1000} onChange={(event) => setForm((current) => ({ ...current, changelog: event.target.value }))} />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button disabled={!form.recon_definition_id || form.title.trim().length < 2 || saveM.isPending} onClick={() => saveM.mutate()}>
                {form.tenant_template_id === "new" ? "Create My Template" : "Save immutable version"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Marketplace installs</CardTitle>
          <CardDescription>Templates the tenant has installed from the marketplace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(installsQ.data ?? []).map((row: any) => (
            <div
              key={row.id}
              className="flex items-center justify-between p-2 border rounded-md"
            >
              <div>
                <div className="font-medium">{row.template?.title ?? "(unknown)"}</div>
                <div className="text-xs text-muted-foreground">
                  {row.state} · installed {new Date(row.installed_at).toLocaleDateString()}
                </div>
              </div>
              {!readOnly && row.state !== "uninstalled" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => uninstallM.mutate(row.id)}
                  disabled={uninstallM.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          {installsQ.isPending && <p role="status" className="p-4 text-sm text-muted-foreground">Loading marketplace installs…</p>}
          {installsQ.isError && (
            <div role="alert" className="space-y-2 p-4 text-sm">
              <p>Marketplace installs could not be loaded.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => installsQ.refetch()} disabled={installsQ.isFetching}>
                {installsQ.isFetching ? "Retrying…" : "Try again"}
              </Button>
            </div>
          )}
          {installsQ.isSuccess && (installsQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center p-4">
              No installs yet. Browse the marketplace to add templates.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>My Templates</CardTitle>
          <CardDescription>
            Your tenant-owned reconciliation templates. Each saved version is immutable; a different active administrator must approve it before publication.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section aria-label="Template list" className="min-w-0 space-y-3">
            <div className="grid gap-2">
              <Input
                aria-label="Search My Templates"
                placeholder="Search templates…"
                value={templateSearch}
                onChange={(event) => { setTemplateSearch(event.target.value); setTemplatePage(1); }}
              />
              <Input aria-label="Filter by asset class" placeholder="Asset class" value={assetClassSearch} onChange={(event) => { setAssetClassSearch(event.target.value); setTemplatePage(1); }} />
              <Select value={templateStatus} onValueChange={(value) => { setTemplateStatus(value); setTemplatePage(1); }}>
                <SelectTrigger aria-label="Filter templates by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="review">In review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="deprecated">Deprecated</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-[32rem] overflow-auto rounded-md border" aria-label="My Templates">
              <table className="w-full min-w-[54rem] text-sm">
                <thead className="sticky top-0 z-10 border-b bg-background text-left text-xs text-muted-foreground">
                  <tr><th scope="col" className="p-3">Name</th><th scope="col" className="p-3">Asset class</th><th scope="col" className="p-3 text-right">Sides</th><th scope="col" className="p-3">Version</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Updated</th><th scope="col" className="p-3">Owner</th></tr>
                </thead>
                <tbody>
              {visibleTenantTemplates.map((row) => (
                <tr key={row.id} aria-selected={selectedTenantTemplate?.id === row.id} className={`cursor-pointer border-b last:border-b-0 hover:bg-muted/30 ${selectedTenantTemplate?.id === row.id ? "fvi-selected-row" : ""}`} onClick={() => setSelectedTemplateId(row.id)}>
                  <td className="p-3 font-medium"><button type="button" aria-current={selectedTenantTemplate?.id === row.id ? "true" : undefined} className="max-w-48 truncate text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => { event.stopPropagation(); setSelectedTemplateId(row.id); }}>{row.title}</button></td>
                  <td className="p-3">{row.asset_class ?? "Not recorded"}</td>
                  <td className="p-3 text-right tabular-nums">{row.sides_count === null ? "Not recorded" : row.sides_count}</td>
                  <td className="p-3">{row.current_semver}</td>
                  <td className="p-3"><Badge variant="outline">{row.status}</Badge></td>
                  <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">{formatTemplateTimestamp(row.updated_at)}</td>
                  <td className="p-3">{row.owner_label ?? "Unavailable"}</td>
                </tr>
              ))}
                </tbody>
              </table>
              {tenantTplQ.isLoading && (
                <p role="status" className="p-6 text-center text-sm text-muted-foreground">Loading templates…</p>
              )}
              {tenantTplQ.isError && (
                <div className="space-y-2 p-6 text-center" role="alert">
                  <p className="text-sm">Templates could not be loaded.</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => tenantTplQ.refetch()} disabled={tenantTplQ.isFetching}>
                    {tenantTplQ.isFetching ? "Retrying…" : "Try again"}
                  </Button>
                </div>
              )}
              {tenantTplQ.isSuccess && visibleTenantTemplates.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {tenantTplQ.data.total === 0 && !templateSearch && !assetClassSearch && templateStatus === "all" ? "No templates yet. Create one from a configured reconciliation above." : "No templates match these filters."}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span aria-live="polite">{tenantTplQ.isError ? "Template count unavailable" : tenantTplQ.data ? `Showing ${tenantTplQ.data.total === 0 ? 0 : (templatePage - 1) * templatePageSize + 1}–${Math.min(templatePage * templatePageSize, tenantTplQ.data.total)} of ${tenantTplQ.data.total}` : "Loading template count…"}</span>
              <div className="flex items-center gap-2">
                <Select value={String(templatePageSize)} onValueChange={(value) => { setTemplatePageSize(Number(value) as 25 | 50 | 100); setTemplatePage(1); }}><SelectTrigger aria-label="My Templates rows per page" className="w-24"><SelectValue /></SelectTrigger><SelectContent>{[25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>)}</SelectContent></Select>
                <Button type="button" size="sm" variant="outline" aria-label="Previous My Templates page" disabled={templatePage <= 1 || tenantTplQ.isFetching} onClick={() => setTemplatePage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                <span>Page {templatePage} of {Math.max(1, tenantTplQ.data?.total_pages ?? 1)}</span>
                <Button type="button" size="sm" variant="outline" aria-label="Next My Templates page" disabled={templatePage >= (tenantTplQ.data?.total_pages ?? 1) || tenantTplQ.isFetching} onClick={() => setTemplatePage((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </section>

          <section aria-label="Selected template details" className="min-w-0 rounded-md border p-4">
            {tenantTplQ.isLoading ? (
              <p role="status" className="p-6 text-center text-sm text-muted-foreground">Loading template details…</p>
            ) : tenantTplQ.isError ? (
              <div className="space-y-2 p-6 text-center" role="alert">
                <p className="text-sm">Template details are unavailable until the list loads.</p>
                <Button type="button" size="sm" variant="outline" onClick={() => tenantTplQ.refetch()} disabled={tenantTplQ.isFetching}>
                  {tenantTplQ.isFetching ? "Retrying…" : "Try again"}
                </Button>
              </div>
            ) : selectedTenantTemplate ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{selectedTenantTemplate.title}</h3>
                    <p className="text-sm text-muted-foreground">Asset class {selectedTenantTemplate.asset_class ?? "not recorded"} · Sides {selectedTenantTemplate.sides_count === null ? "not recorded" : selectedTenantTemplate.sides_count} · Owner {selectedTenantTemplate.owner_label ?? "unavailable"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Current version · v{selectedTenantTemplate.current_semver}</p>
                  </div>
                  <Badge variant="outline">{selectedTenantTemplate.status}</Badge>
                </div>
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="versions">Versions</TabsTrigger>
                    <TabsTrigger value="runs">Runs</TabsTrigger>
                    <TabsTrigger value="audit">Audit</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="space-y-4 pt-3">
                    <p className="text-sm text-muted-foreground">{selectedTenantTemplate.description || "No description has been recorded."}</p>
                    <div className="rounded-md bg-muted/50 p-3 text-sm">
                      <p className="font-medium">Current immutable version · {selectedTenantTemplate.current_semver}</p>
                      <p className="mt-1 text-muted-foreground">A saved version is a snapshot. To change its configuration, save a new version.</p>
                    </div>
                    <TemplateConfigurationSummary sides={selectedTenantTemplate.sides_count} rules={selectedTenantTemplate.rules_count} />
                    <TenantTemplateLatestRunSummary tenantId={tenantId} templateId={selectedTenantTemplate.id} />
                    <TenantTemplateLifecycleTimeline tenantId={tenantId} templateId={selectedTenantTemplate.id} />
                  </TabsContent>
                  <TabsContent value="versions" className="pt-3">
                    <TenantTemplateVersions tenantId={tenantId} templateId={selectedTenantTemplate.id} currentSemver={selectedTenantTemplate.current_semver} />
                  </TabsContent>
                  <TabsContent value="runs" className="pt-3">
                    <TenantTemplateRuns tenantId={tenantId} templateId={selectedTenantTemplate.id} />
                  </TabsContent>
                  <TabsContent value="audit" className="pt-3">
                    <TenantTemplateAudit tenantId={tenantId} templateId={selectedTenantTemplate.id} />
                  </TabsContent>
                </Tabs>
                <div className="flex flex-wrap items-center gap-2">
                  {!readOnly && selectedTenantTemplate.status === "draft" && (
                    <Button disabled={transitionM.isPending} onClick={() => transitionM.mutate({ id: selectedTenantTemplate.id, action: "submit" })}>Submit</Button>
                  )}
                  {!readOnly && selectedTenantTemplate.status === "review" && (
                    <>
                      <Button disabled={transitionM.isPending} onClick={() => transitionM.mutate({ id: selectedTenantTemplate.id, action: "approve" })}>Approve</Button>
                      <Button variant="outline" disabled={transitionM.isPending} onClick={() => transitionM.mutate({ id: selectedTenantTemplate.id, action: "reject" })}>Request changes</Button>
                    </>
                  )}
                  {!readOnly && selectedTenantTemplate.status === "approved" && (
                    <Button disabled={transitionM.isPending} onClick={() => transitionM.mutate({ id: selectedTenantTemplate.id, action: "publish" })}>Publish</Button>
                  )}
                  {!readOnly && selectedTenantTemplate.status === "published" && (
                    <>
                      <Button disabled={instantiateM.isPending} onClick={() => { setOwnerBuIds([]); setInstantiatingTemplateId(selectedTenantTemplate.id); }}>Create reconciliation</Button>
                      <Button variant="outline" disabled={transitionM.isPending} onClick={() => transitionM.mutate({ id: selectedTenantTemplate.id, action: "unpublish" })}>Unpublish</Button>
                    </>
                  )}
                  {!readOnly && <Button variant="ghost" disabled={cloneM.isPending} onClick={() => cloneM.mutate({ id: selectedTenantTemplate.id, title: selectedTenantTemplate.title })}>Clone</Button>}
                </div>
              </div>
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Select a template to review its current version and available actions.</p>
            )}
          </section>
        </CardContent>
      </Card>
      <Dialog open={Boolean(instantiatingTemplateId)} onOpenChange={(open) => { if (!open) setInstantiatingTemplateId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose owning business units</DialogTitle>
            <DialogDescription>
              {selectedTenantTemplate?.title ?? "This template"} will create a draft reconciliation. Choose at least one active unit in this tenant.
            </DialogDescription>
          </DialogHeader>
          {businessUnitsQ.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading tenant business units…</p> : null}
          {businessUnitsQ.isError ? (
            <div role="alert" className="text-sm">
              <p>Business units are temporarily unavailable. Creation stays disabled.</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => businessUnitsQ.refetch()}>Try again</Button>
            </div>
          ) : null}
          {!businessUnitsQ.isLoading && !businessUnitsQ.isError && ownerUnits.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">No active business units are available in this tenant.</p>
          ) : null}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {ownerUnits.map((unit: any) => (
              <label key={unit.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={ownerBuIds.includes(unit.id)}
                  onChange={(event) => setOwnerBuIds((current) => event.target.checked
                    ? [...current, unit.id]
                    : current.filter((id) => id !== unit.id))}
                />
                <span>{unit.name}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInstantiatingTemplateId(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={!instantiatingTemplateId || !ownerBuIds.length || businessUnitsQ.isLoading || businessUnitsQ.isError || !ownerUnits.length || instantiateM.isPending}
              onClick={() => {
                const template = tenantTplQ.data?.rows.find((row) => row.id === instantiatingTemplateId);
                if (template && ownerBuIds.length > 0) instantiateM.mutate({ id: template.id, title: template.title, owner_bu_ids: ownerBuIds });
              }}
            >
              {instantiateM.isPending ? "Creating…" : "Create draft reconciliation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateConfigurationSummary({ sides, rules }: { sides: number | null; rules: number | null }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-md border p-3"><dt className="text-muted-foreground">Configured sides</dt><dd className="mt-1 font-medium">{sides === null ? "Not recorded" : sides}</dd></div>
      <div className="rounded-md border p-3"><dt className="text-muted-foreground">Configured rules</dt><dd className="mt-1 font-medium">{rules === null ? "Not recorded" : rules}</dd></div>
    </dl>
  );
}

function formatTemplateTimestamp(value: string | null | undefined) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Date unavailable";
}

function lifecycleEventLabel(action: string) {
  const labels: Record<string, string> = {
    create: "Draft created",
    clone: "Draft cloned",
    version: "Version saved",
    submit: "Submitted for review",
    approve: "Independently approved",
    reject: "Changes requested",
    publish: "Published",
    unpublish: "Unpublished",
    instantiate: "Reconciliation created",
  };
  return labels[action] ?? action.replaceAll("_", " ");
}

function lifecycleActorRole(action: string) {
  if (["create", "clone", "version"].includes(action)) return "Maker";
  if (action === "submit") return "Submitter";
  if (action === "approve") return "Checker";
  if (action === "reject") return "Reviewer";
  if (["publish", "unpublish"].includes(action)) return "Publisher";
  return "Actor";
}

function TenantTemplateLifecycleTimeline({ tenantId, templateId }: { tenantId: string; templateId: string }) {
  const lifecycleFn = useServerFn(getTenantTemplateLifecycle);
  const q = useQuery({
    queryKey: ["mkt-template-lifecycle", tenantId, templateId],
    queryFn: () => lifecycleFn({ data: { tenant_id: tenantId, tenant_template_id: templateId } }),
  });
  if (q.isLoading) return <p role="status" className="text-xs text-muted-foreground">Loading lifecycle evidence…</p>;
  if (q.isError) return <p role="status" className="text-xs text-muted-foreground">Lifecycle evidence is unavailable. The current status remains authoritative.</p>;
  const events = (q.data ?? []).filter((event) => ["create", "clone", "version", "submit", "approve", "reject", "publish", "unpublish", "instantiate"].includes(event.action)).slice(0, 20).reverse();
  if (events.length === 0) return <p className="text-xs text-muted-foreground">No lifecycle audit events are recorded for this template.</p>;
  return <section aria-label="Template lifecycle timeline" className="space-y-3 border-t pt-4">
    <h4 className="text-sm font-semibold">Template lifecycle</h4>
    <ol className="space-y-2">
      {events.map((event) => {
        return <li key={event.key} className="flex flex-wrap items-start justify-between gap-2 border-l-2 border-[var(--fvi-gold)] pl-3 text-xs">
          <div><p className="font-medium">{lifecycleEventLabel(event.action)}{event.version ? ` · v${event.version}` : ""}</p><p className="text-muted-foreground">{event.actor_role || lifecycleActorRole(event.action)} · {event.actor_recorded ? "actor recorded" : "actor unavailable"}</p></div>
          <time className="text-muted-foreground">{formatTemplateTimestamp(event.created_at)}</time>
        </li>;
      })}
    </ol>
  </section>;
}

function TenantTemplateLatestRunSummary({ tenantId, templateId }: { tenantId: string; templateId: string }) {
  const latestRunFn = useServerFn(getTenantTemplateLatestRun);
  const q = useQuery({
    queryKey: ["mkt-template-latest-run", tenantId, templateId],
    queryFn: () => latestRunFn({ data: { tenant_id: tenantId, tenant_template_id: templateId } }),
  });
  if (q.isLoading) return <section aria-label="Latest run summary" className="rounded-md border p-3"><p role="status" className="text-xs text-muted-foreground">Loading latest visible run…</p></section>;
  if (q.isError || q.data?.state === "unavailable") return <section aria-label="Latest run summary" className="rounded-md border p-3"><h4 className="font-semibold">Latest run</h4><p className="mt-1 text-xs text-muted-foreground">Run summary is unavailable for the reconciliations visible to your account.</p></section>;
  if (q.data?.state === "none_visible" || !q.data?.run) return <section aria-label="Latest run summary" className="rounded-md border p-3"><h4 className="font-semibold">Latest run</h4><p className="mt-1 text-xs text-muted-foreground">No run is visible for the linked reconciliations.</p></section>;
  const run = q.data.run;
  return <section aria-label="Latest run summary" className="space-y-2 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Latest run</h4><Badge variant="outline">{run.status}</Badge></div>
    <p className="text-xs text-muted-foreground">{run.run_uid ?? "Run ID unavailable"} · {formatTemplateTimestamp(run.started_at)}</p>
    <div className="grid grid-cols-3 gap-2 text-xs"><div><p className="text-muted-foreground">Input rows</p><p className="font-medium">{run.total_rows ?? "Unavailable"}</p></div><div><p className="text-muted-foreground">Matches</p><p className="font-medium">{run.matched_count ?? "Unavailable"}</p></div><div><p className="text-muted-foreground">Exceptions</p><p className="font-medium">{run.exception_count ?? "Unavailable"}</p></div></div>
  </section>;
}

function TenantTemplateVersions({ tenantId, templateId, currentSemver }: { tenantId: string; templateId: string; currentSemver: string }) {
  const versionsQ = useQuery({
    queryKey: ["mkt-template-versions", tenantId, templateId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_template_versions").select("id,semver,changelog,created_at,tenant_template_id").eq("tenant_id", tenantId).eq("tenant_template_id", templateId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  if (versionsQ.isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading saved versions…</p>;
  if (versionsQ.isError) return <p role="alert" className="text-sm">Version history could not be loaded.</p>;
  if (!versionsQ.data?.length) return <p className="text-sm text-muted-foreground">No saved version records are available.</p>;
  return <ol className="space-y-2">{versionsQ.data.map((version) => <li key={version.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm"><div><div className="flex items-center gap-2"><Badge variant="outline">v{version.semver}</Badge>{version.semver === currentSemver && <Badge>Current</Badge>}</div><p className="mt-1 text-muted-foreground">{version.changelog || "No version notes"}</p></div><time className="text-xs text-muted-foreground">{new Date(version.created_at).toLocaleString()}</time></li>)}</ol>;
}

function TenantTemplateRuns({ tenantId, templateId }: { tenantId: string; templateId: string }) {
  const definitionsQ = useQuery({
    queryKey: ["mkt-template-definitions", tenantId, templateId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("recon_definitions") as any).select("id,recon_code,name").eq("tenant_id", tenantId).eq("tenant_template_id", templateId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const definitionIds = definitionsQ.data?.map((row: { id: string; recon_code: string; name: string }) => row.id) ?? [];
  const runsQ = useQuery({
    enabled: definitionsQ.isSuccess && definitionIds.length > 0,
    queryKey: ["mkt-template-runs", tenantId, templateId, definitionIds],
    queryFn: async () => {
      const { data, error } = await supabase.from("recon_runs").select("id,definition_id,run_uid,status,started_at,completed_at,total_rows,matched_count,exception_count").eq("tenant_id", tenantId).in("definition_id", definitionIds).order("started_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (definitionsQ.isLoading || runsQ.isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading linked reconciliation runs…</p>;
  if (definitionsQ.isError || runsQ.isError) return <p role="alert" className="text-sm">Run history could not be loaded.</p>;
  if (!definitionIds.length || !runsQ.data?.length) return <p className="text-sm text-muted-foreground">No reconciliation runs are visible for the linked templates.</p>;
  return <div className="space-y-2"><p className="text-xs text-muted-foreground">Latest 50 linked runs visible to your account; older runs remain in Run History.</p>{runsQ.data.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><div><p className="font-medium">{definitionsQ.data?.find((definition: { id: string; recon_code: string; name: string }) => definition.id === run.definition_id)?.recon_code ?? "Reconciliation"}</p><p className="text-xs text-muted-foreground">{run.run_uid || "Run ID unavailable"} · {new Date(run.started_at).toLocaleString()}</p></div><div className="flex items-center gap-2"><Badge variant="outline">{run.status}</Badge><span className="text-xs text-muted-foreground">{run.total_rows} input rows · {run.matched_count} matched groups · {run.exception_count} exception items</span></div></div>)}</div>;
}

function TenantTemplateAudit({ tenantId, templateId }: { tenantId: string; templateId: string }) {
  const lifecycleFn = useServerFn(getTenantTemplateLifecycle);
  const auditQ = useQuery({
    queryKey: ["mkt-template-audit", tenantId, templateId],
    queryFn: () => lifecycleFn({ data: { tenant_id: tenantId, tenant_template_id: templateId } }),
  });
  if (auditQ.isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading template audit…</p>;
  if (auditQ.isError) return <p role="alert" className="text-sm">Audit history could not be loaded.</p>;
  if (!auditQ.data?.length) return <p className="text-sm text-muted-foreground">No audit events are available for this template.</p>;
  return <ol className="space-y-2">{auditQ.data.map((event) => <li key={event.key} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{lifecycleEventLabel(event.action)}</span><time className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</time></div><p className="mt-1 text-xs text-muted-foreground">{event.actor_role} · {event.actor_recorded ? "actor recorded" : "actor unavailable"} · version {event.version ?? "not recorded"}</p></li>)}</ol>;
}

// ────────────────────────────────────────────────────────────────────────
function WorkspaceAssignmentsTab({
  workspaceId,
  tenantId,
}: {
  workspaceId: string;
  tenantId: string;
}) {
  const listFn = useServerFn(listWorkspaceAssignments);
  const assignFn = useServerFn(assignToWorkspace);
  const revokeFn = useServerFn(revokeAssignment);
  const tenantTplFn = useServerFn(listTenantTemplates);
  const qc = useQueryClient();
  const [pick, setPick] = useState<{ tenant_template_id: string; permission: string }>({
    tenant_template_id: "",
    permission: "use",
  });

  const assignQ = useQuery({
    queryKey: ["mkt-assignments", workspaceId],
    queryFn: () => listFn({ data: { workspace_id: workspaceId } }),
  });
  const tenantTplQ = useQuery({
    queryKey: ["mkt-tenant-templates", tenantId],
    queryFn: () => tenantTplFn({ data: { tenant_id: tenantId } }),
  });

  const assignM = useMutation({
    mutationFn: () =>
      assignFn({
        data: {
          workspace_id: workspaceId,
          tenant_id: tenantId,
          tenant_template_id: pick.tenant_template_id,
          team_ids: [],
          permission: pick.permission as any,
        },
      }),
    onSuccess: () => {
      toast.success("Template assigned");
      qc.invalidateQueries({ queryKey: ["mkt-assignments"] });
    },
    onError: (e: any) => toast.error(templateErrorText(e)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Assign tenant template</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[240px]">
            <Label>Tenant template</Label>
            <Select
              value={pick.tenant_template_id}
              onValueChange={(v) => setPick({ ...pick, tenant_template_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {(tenantTplQ.data ?? []).map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Permission</Label>
            <Select
              value={pick.permission}
              onValueChange={(v) => setPick({ ...pick, permission: v })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">View</SelectItem>
                <SelectItem value="use">Use</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => assignM.mutate()}
            disabled={!pick.tenant_template_id || assignM.isPending}
          >
            Assign
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(assignQ.data ?? []).map((a: any) => (
            <div
              key={a.id}
              className="flex items-center justify-between p-2 border rounded-md"
            >
              <div>
                <div className="text-sm">{a.tenant_template_id.slice(0, 8)}…</div>
                <div className="text-xs text-muted-foreground">
                  {a.permission} · {a.enabled ? "enabled" : "disabled"}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await revokeFn({ data: { assignment_id: a.id } });
                    qc.invalidateQueries({ queryKey: ["mkt-assignments"] });
                    toast.success("Revoked");
                  } catch (e: any) {
                    toast.error(templateErrorText(e));
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {assignQ.isSuccess && (assignQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center p-4">
              No assignments yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
function AiAssistTab({ tenantId }: { tenantId?: string }) {
  const recFn = useServerFn(aiRecommendTemplates);
  const genFn = useServerFn(aiGenerateFromPrompt);
  const [prompt, setPrompt] = useState("");
  const [genPrompt, setGenPrompt] = useState("");
  const [recs, setRecs] = useState<any[]>([]);
  const [spec, setSpec] = useState<string>("");

  const recM = useMutation({
    mutationFn: () => recFn({ data: { tenant_id: tenantId!, prompt } }),
    onSuccess: (r: any) => setRecs(r.recommendations),
    onError: (e: any) => toast.error(templateErrorText(e)),
  });
  const genM = useMutation({
    mutationFn: () => genFn({ data: { tenant_id: tenantId!, prompt: genPrompt } }),
    onSuccess: (r: any) => setSpec(JSON.stringify(r.spec, null, 2)),
    onError: (e: any) => toast.error(templateErrorText(e)),
  });

  if (!tenantId) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          AI assist runs in tenant scope.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Recommend templates
          </CardTitle>
          <CardDescription>
            Powered by the tenant&apos;s configured LLM route (no Meta AI).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            placeholder="Describe what you reconcile — e.g. 'daily bank + card settlements for a mid-sized EU bank, IFRS'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button
            onClick={() => recM.mutate()}
            disabled={!prompt || recM.isPending}
          >
            {recM.isPending ? "Thinking…" : "Recommend"}
          </Button>
          <div className="space-y-1">
            {recs.map((r) => (
              <div key={r.id} className="text-sm p-2 border rounded-md">
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">
                  {r.pack_type} · {(r.standards ?? []).join(", ")}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" /> Generate template from prompt
          </CardTitle>
          <CardDescription>
            Produces a JSON reconciliation spec for review; nothing is saved automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={4}
            placeholder="e.g. 'SWIFT MT103 vs correspondent bank statements, tolerance 0.01, dual approval'"
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
          />
          <Button onClick={() => genM.mutate()} disabled={!genPrompt || genM.isPending}>
            {genM.isPending ? "Generating…" : "Generate spec"}
          </Button>
          {spec && (
            <pre className="text-xs bg-muted p-2 rounded max-h-64 overflow-auto">{spec}</pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
function AuditTrailTab({ scope }: { scope: Scope }) {
  const auditFn = useServerFn(getAuditTrail);
  const q = useQuery({
    queryKey: ["mkt-audit", scope],
    queryFn: () =>
      auditFn({
        data: {
          tenant_id: scope.kind === "tenant" ? scope.tenantId : (scope as any).tenantId,
          workspace_id: scope.kind === "workspace" ? scope.workspaceId : undefined,
          limit: 200,
        } as any,
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" /> Immutable audit trail
        </CardTitle>
        <CardDescription>
          Every publish, install, clone, customize, upgrade, rollback, assign, revoke, and
          permission change is written to an append-only WORM log for regulator scrutiny.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 max-h-[520px] overflow-auto">
          {(q.data ?? []).map((row: any) => (
            <div
              key={row.id}
              className="grid grid-cols-[auto_auto_1fr_auto] gap-3 text-xs items-center p-2 border rounded-md"
            >
              <span className="text-muted-foreground">
                {new Date(row.created_at).toLocaleString()}
              </span>
              <Badge variant="outline">{row.action}</Badge>
              <span className="truncate">
                {row.entity_type} {row.entity_id ? "· resource recorded" : ""}
              </span>
              <span className="text-muted-foreground">{row.actor_id ? "Actor recorded" : "System"}</span>
            </div>
          ))}
          {q.isSuccess && (q.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center p-4">No audit events yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
