import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listReconTemplates, listAssetClassPresets, installReconTemplate } from "@/lib/recon-templates.functions";
import { listDataSources } from "@/lib/data-sources.functions";
import { listBusinessUnits } from "@/lib/business-units.functions";
import { starterTemplateFields, type StarterBinding, type StarterTemplate } from "@/lib/recon-template-compiler";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Layers3, Download, Search, ArrowRight, Circle } from "lucide-react";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";
import { getStarterBindingProgress } from "@/lib/recon-starter-mapping";
import { FviDetailDialogLayout } from "@/components/fvi-detail-dialog-layout";

function templateInstallFailure(error: unknown): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definite = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
  const category: UserMessageCategory = definite ? mapped.category : "unknown_write_outcome";
  return formatUserMessage({
    ...mapped,
    category,
    action: "install this reconciliation template as a draft",
    code,
    status,
    availableActions: category === "unknown_write_outcome" ? [{ id: "check-installed-draft", label: "Check ReconIQ Studio before retrying" }] : [],
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  custody: "Custody / Position",
  collateral: "Collateral / UMR",
  ca: "Corporate Actions",
  derivatives: "FX & Derivatives",
  nav: "NAV / Fund Accounting",
  payments: "Payments (ISO 20022, MT)",
  cards: "Card Schemes",
  cash: "Cash / Nostro",
  securities: "Securities / Trades",
  equities: "Equities & Securities Lending",
  fees: "Fees & Accruals",
  fixed_income: "Fixed Income & Repo",
  fx: "Foreign Exchange",
  gl: "General Ledger",
  listed_derivatives: "Listed Derivatives",
  multi_asset: "Multi-Asset",
};

export function ReconTemplatesTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchT = useServerFn(listReconTemplates);
  const fetchP = useServerFn(listAssetClassPresets);
  const fetchSources = useServerFn(listDataSources);
  const fetchBusinessUnits = useServerFn(listBusinessUnits);
  const [installing, setInstalling] = useState<(StarterTemplate & { id: string; title: string; summary?: string }) | null>(null);
  const [previewing, setPreviewing] = useState<(StarterTemplate & { id: string; title: string; summary?: string; asset_class: string }) | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [sortOrder, setSortOrder] = useState("relevance");

  const tplQ = useQuery({ queryKey: ["recon-templates"], queryFn: () => fetchT({ data: {} }) });
  const preQ = useQuery({ queryKey: ["asset-presets"], queryFn: () => fetchP({ data: undefined as any }) });
  const sourceQ = useQuery({
    queryKey: ["data-sources", tenantId],
    queryFn: () => fetchSources({ data: { tenant_id: tenantId } }),
  });
  const businessUnitsQ = useQuery({
    queryKey: ["business-units", tenantId],
    queryFn: () => fetchBusinessUnits({ data: { tenant_id: tenantId } }),
  });
  const ownerUnits = (businessUnitsQ.data ?? []).filter((unit: any) => !unit.is_archived);

  const grouped: Record<string, any[]> = {};
  for (const t of tplQ.data ?? []) {
    (grouped[t.asset_class] ||= []).push(t);
  }
  const categories = Object.keys(grouped).sort((left, right) => {
    const leftOrder = Object.keys(CATEGORY_LABELS).indexOf(left);
    const rightOrder = Object.keys(CATEGORY_LABELS).indexOf(right);
    if (leftOrder < 0 && rightOrder < 0) return left.localeCompare(right);
    if (leftOrder < 0) return 1;
    if (rightOrder < 0) return -1;
    return leftOrder - rightOrder;
  });
  const normalizedSearch = search.trim().toLowerCase();
  const visibleTemplates = (tplQ.data ?? []).filter((template: any) => {
    const matchesCategory = activeCategory === "all" || template.asset_class === activeCategory;
    const searchable = [template.title, template.summary, template.code, template.asset_class,
      ...(template.tags ?? []), ...(template.legs ?? []).map((leg: any) => leg.name),
      ...(template.keys ?? []), ...starterTemplateFields(template)].filter(Boolean).join(" ").toLowerCase();
    return matchesCategory && (!normalizedSearch || searchable.includes(normalizedSearch));
  }).sort((left, right) => {
    if (sortOrder === "name") return left.title.localeCompare(right.title);
    if (sortOrder === "updated") return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    return 0;
  });
  const featuredCandidate = visibleTemplates.find((template: any) => template.code === "trade_lifecycle")
    ?? visibleTemplates[0]
    ?? null;
  const featuredTemplate = featuredCandidate && Array.isArray(featuredCandidate.legs) && Array.isArray(featuredCandidate.keys)
    ? featuredCandidate as unknown as StarterTemplate & { id: string; title: string; summary: string | null; asset_class: string }
    : null;
  const tenantSources = (sourceQ.data ?? []) as DataSourceOption[];
  const sourcesWithDetectedFields = tenantSources.filter((source) => availableSourceFields(source).length > 0);
  const featuredRequiredFields = featuredTemplate ? starterTemplateFields(featuredTemplate) : [];
  const recommendedCodes = ["acct_clearing_v1", "fx_settlement_cls", "equities_position_vs_custody"];
  const recommendedTemplates = recommendedCodes
    .map((code) => visibleTemplates.find((template) => template.code === code))
    .filter((template): template is NonNullable<typeof template> => Boolean(template) && template?.id !== featuredTemplate?.id);
  const recommendedIds = new Set(recommendedTemplates.map((template) => template.id));
  const visibleByCategory: Record<string, any[]> = {};
  for (const template of visibleTemplates) {
    if (template.id === featuredTemplate?.id || recommendedIds.has(template.id)) continue;
    (visibleByCategory[template.asset_class] ||= []).push(template);
  }
  const categoryLabel = (category: string) => CATEGORY_LABELS[category]
    ?? category.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
  const renderStarterCard = (template: any) => (
    <Card key={template.id} className="border-muted">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3"><CardTitle className="text-sm leading-5">{template.title}</CardTitle><Badge variant="secondary" className="shrink-0 text-[10px]">Published</Badge></div>
        <CardDescription className="text-xs">{template.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <code className="block rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">{template.code}</code>
        <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{Array.isArray(template.legs) ? template.legs.length : 0} source legs</span>{Array.isArray(template.legs) ? ` · ${template.legs.map((leg: { name?: string }) => leg.name).filter(Boolean).join(" → ")}` : ""}</div>
        <div className="text-xs text-muted-foreground">Rule focus <span className="font-mono text-foreground">{Array.isArray(template.keys) ? template.keys.join(", ") || "No key recorded" : "Unavailable"}</span></div>
        <Button type="button" size="sm" variant="link" className="h-auto p-0" disabled={!Array.isArray(template.legs) || !Array.isArray(template.keys) || !Array.isArray(template.rules)} onClick={(event) => { previewTriggerRef.current = event.currentTarget; setPreviewing({ ...template, summary: template.summary ?? undefined }); }}>View configuration <ArrowRight aria-hidden="true" className="ml-1 h-3.5 w-3.5" /></Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-2xl tracking-tight">
              <Layers3 className="h-5 w-5 text-primary" /> Starter Kits
            </CardTitle>
            <CardDescription className="text-sm">
              Published configurations. Map each required source before installing a draft for review in ReconIQ Studio.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:min-w-[27rem] sm:justify-end">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search Starter Kits"
                className="pl-9"
                placeholder="Search by name, code, or field…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <span className="shrink-0 text-sm text-muted-foreground" aria-live="polite">
              {tplQ.isSuccess ? `${visibleTemplates.length} ${visibleTemplates.length === 1 ? "kit" : "kits"}` : "Count unavailable"}
            </span>
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger aria-label="Sort Starter Kits" className="w-[9.5rem]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="relevance">Relevance</SelectItem><SelectItem value="name">Name A–Z</SelectItem><SelectItem value="updated">Recently updated</SelectItem></SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter Starter Kits by asset class">
            <Button size="sm" variant={activeCategory === "all" ? "default" : "outline"}
              aria-pressed={activeCategory === "all"} onClick={() => setActiveCategory("all")}>
              All <span className="ml-1 opacity-75">{tplQ.isSuccess ? tplQ.data.length : "—"}</span>
            </Button>
            {categories.map((category) => {
              const count = grouped[category]?.length ?? 0;
              return (
                <Button key={category} size="sm" variant={activeCategory === category ? "default" : "outline"}
                  aria-pressed={activeCategory === category} onClick={() => setActiveCategory(category)}>
                  {categoryLabel(category)} <span className="ml-1 opacity-75">{count}</span>
                </Button>
              );
            })}
          </div>
          {(preQ.data ?? []).length > 0 ? (
            <div className="mt-4 border-t pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Asset-class presets and supported formats</p>
              <div className="flex flex-wrap gap-2">
                {(preQ.data ?? []).map((preset: any) => (
                  <Badge key={preset.id} variant="secondary" className="text-[10px]">
                    {preset.name} · {(preset.ingestion_formats ?? []).slice(0, 3).join(" / ")}
                    {(preset.ingestion_formats ?? []).length > 3 ? "…" : ""}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {tplQ.isError ? (
        <Card><CardContent className="py-8 text-center text-sm" role="alert">
          <p className="font-medium">Starter Kits are temporarily unavailable.</p>
          <p className="mt-1 text-muted-foreground">The catalogue could not be loaded. Try again; if this continues, contact your administrator.</p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => tplQ.refetch()}>Try again</Button>
        </CardContent></Card>
      ) : tplQ.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">Loading Starter Kits…</p>
      ) : featuredTemplate ? (
        <Card className="border-[var(--gold)]/70">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><Badge className="bg-[var(--gold)] text-[var(--ink-2)] hover:bg-[var(--gold)]">Featured</Badge><Badge variant="secondary">Published</Badge></div>
            <div><CardTitle className="text-xl sm:text-2xl">{featuredTemplate.title}</CardTitle><CardDescription className="mt-1 text-sm">{featuredTemplate.summary || "Published reconciliation configuration"}</CardDescription></div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Asset class <strong className="ml-1 text-foreground">{categoryLabel(featuredTemplate.asset_class)}</strong></span><span>Source legs <strong className="ml-1 text-foreground">{featuredTemplate.legs?.length ?? 0}</strong></span><span>Code <strong className="ml-1 font-mono text-foreground">{featuredTemplate.code}</strong></span></div>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <section aria-label="Reconciliation legs" className="space-y-3"><h3 className="text-sm font-semibold">Reconciliation legs ({featuredTemplate.legs?.length ?? 0})</h3><div className="flex flex-wrap items-stretch gap-1 lg:flex-nowrap">{(featuredTemplate.legs ?? []).map((leg: { name?: string }, index: number) => <div key={`${featuredTemplate.code}-leg-${index}`} className="flex min-w-0 flex-1 items-center gap-1"><div className="min-w-0 flex-1 rounded-md border bg-card p-2 text-center text-xs"><span className="block font-semibold text-primary">{index + 1}</span><span className="mt-1 block truncate font-medium" title={leg.name || `Side ${index + 1}`}>{leg.name || `Side ${index + 1}`}</span><span className="mt-2 block rounded bg-muted px-1 py-1 text-[10px] text-muted-foreground">Source required</span></div>{index < featuredTemplate.legs.length - 1 ? <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" /> : null}</div>)}</div><div className="rounded-md bg-muted/50 p-3 text-xs"><p className="font-semibold">Key matching rule</p><p className="mt-1 font-mono">{featuredTemplate.keys?.[0] || "No key recorded"}</p><p className="mt-1 text-muted-foreground">Review source fields, rules and tolerances before installation.</p></div></section>
            <section aria-label="Setup checklist" className="space-y-3 lg:border-l lg:pl-5">
              <div>
                <h3 className="text-sm font-semibold">Setup checklist</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {featuredRequiredFields.length} required field{featuredRequiredFields.length === 1 ? "" : "s"} per side. Each side needs a distinct source.
                </p>
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {sourceQ.isPending ? "Checking tenant source availability…" : sourceQ.isError
                  ? "Tenant source availability is unavailable."
                  : tenantSources.length === 0
                    ? "No tenant sources are available."
                    : `${tenantSources.length} tenant source${tenantSources.length === 1 ? "" : "s"} found; ${sourcesWithDetectedFields.length} expose detected columns.`}
              </p>
              <ol className="divide-y rounded-md border">
                {(featuredTemplate.legs ?? []).map((leg: { name?: string }, index: number) => {
                  const status = sourceQ.isPending
                    ? "Checking"
                    : sourceQ.isError
                      ? "Unavailable"
                      : tenantSources.length === 0
                        ? "No sources"
                        : `${tenantSources.length} source${tenantSources.length === 1 ? "" : "s"} to choose from`;
                  return (
                    <li key={`${featuredTemplate.code}-setup-${index}`} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span>Map {leg.name || `side ${index + 1}`} source</span>
                      </span>
                      <span className="ml-6 text-muted-foreground sm:ml-0">{status} · {featuredRequiredFields.length} field{featuredRequiredFields.length === 1 ? "" : "s"} to map</span>
                    </li>
                  );
                })}
              </ol>
              {sourceQ.isError ? (
                <div role="alert" className="rounded-md border border-destructive/30 p-3 text-xs">
                  <p className="font-medium">Tenant sources could not be checked.</p>
                  <p className="mt-1 text-muted-foreground">Retry before mapping so the available sources and fields are current.</p>
                  <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => sourceQ.refetch()}>Retry source check</Button>
                </div>
              ) : sourceQ.isPending ? (
                <p role="status" className="rounded-md border p-3 text-xs text-muted-foreground">Loading tenant sources and detected columns…</p>
              ) : tenantSources.length === 0 ? (
                <p role="status" className="rounded-md border p-3 text-xs text-muted-foreground">Add a data source in Data, then return to map each side. This kit requires {featuredTemplate.legs.length} distinct source{featuredTemplate.legs.length === 1 ? "" : "s"}.</p>
              ) : sourcesWithDetectedFields.length === 0 ? (
                <p role="status" className="rounded-md border p-3 text-xs text-muted-foreground">Sources exist, but no columns were detected from their schema or sample rows. Complete source profiling before mapping fields.</p>
              ) : (
                <p className="rounded-md border p-3 text-xs text-muted-foreground">
                  {sourcesWithDetectedFields.length} of {tenantSources.length} source{tenantSources.length === 1 ? "" : "s"} have detected columns. Field mappings are still required for every side.
                </p>
              )}
            </section>
            <section aria-label="Expected outcomes" className="space-y-3 lg:border-l lg:pl-5">
              <h3 className="text-sm font-semibold">Run outcomes</h3>
              <div className="rounded-md border text-xs">
                {["Matched", "Needs review", "Unmatched", "Not in source"].map((status) => (
                  <div key={status} className="border-b p-2 last:border-b-0">{status}</div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Counts are produced from tenant data by each reconciliation run. No sample or future counts are shown here.</p>
            </section>
            <div className="flex flex-col gap-3 rounded-md border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between lg:col-span-3">
              <div className="text-sm">
                <p className="font-semibold">Map every side before installing.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sourceQ.isError
                    ? "Retry the source check, then map distinct sources and required fields."
                    : tenantSources.length < featuredTemplate.legs.length
                      ? `This kit needs ${featuredTemplate.legs.length} distinct tenant sources; ${tenantSources.length} are currently available.`
                      : `This kit needs ${featuredTemplate.legs.length} distinct sources and ${featuredRequiredFields.length * featuredTemplate.legs.length} field mappings.`}
                  {!canWrite ? " You do not have permission to install Starter Kits in this tenant." : ""}
                </p>
              </div>
              <Button className="shrink-0" disabled={!canWrite} onClick={() => setInstalling({ ...featuredTemplate, summary: featuredTemplate.summary ?? undefined })}>
                <Download aria-hidden="true" className="mr-2 h-4 w-4" />Map sources &amp; install
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!tplQ.isError && !tplQ.isPending && recommendedTemplates.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" aria-label="Recommended Starter Kits">
          {recommendedTemplates.map(renderStarterCard)}
        </div>
      ) : null}

      {!tplQ.isError && !tplQ.isPending ? Object.entries(visibleByCategory).map(([cat, list]) => (
        <Card key={cat}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{categoryLabel(cat)}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {list.map(renderStarterCard)}
          </CardContent>
        </Card>
      )) : null}
      {!tplQ.isError && tplQ.data && tplQ.data.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          No Starter Kits are published for this catalogue yet.
        </CardContent></Card>
      ) : !tplQ.isError && !tplQ.isPending && visibleTemplates.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          <p>No Starter Kits match these filters. Try another name, code, or field.</p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => {
            setSearch("");
            setActiveCategory("all");
          }}>Clear search and filters</Button>
        </CardContent></Card>
      ) : null}
      {previewing ? (
        <Dialog open onOpenChange={(open) => { if (!open) setPreviewing(null); }}>
          <DialogContent className="h-[min(44rem,calc(100dvh-2rem))] max-w-5xl overflow-hidden p-0" onCloseAutoFocus={(event) => { event.preventDefault(); previewTriggerRef.current?.focus(); }}>
            <FviDetailDialogLayout
              railEyebrow="RECONCILIATIONS"
              railTitle="STARTER KIT"
              railStatus={<Badge>Published</Badge>}
              railFields={[{ label: "Kit code", value: previewing.code }, { label: "Asset class", value: categoryLabel(previewing.asset_class) }, { label: "Source legs", value: previewing.legs.length }, { label: "Matching keys", value: previewing.keys.length }]}
              title={previewing.title}
              description={previewing.summary || "Review this published configuration before mapping your tenant sources."}
              content={<div className="space-y-5 text-sm"><section><h4 className="font-semibold">Required source legs</h4><ol className="mt-2 space-y-2">{previewing.legs.map((leg, index) => <li key={`${previewing.code}-preview-${index}`} className="rounded-md border p-3">{index + 1}. {leg.name || `Side ${index + 1}`} · source mapping required</li>)}</ol></section><section><h4 className="font-semibold">Matching keys</h4><p className="mt-2 font-mono text-muted-foreground">{previewing.keys.join(", ") || "No key recorded"}</p></section><section><h4 className="font-semibold">Rules and tolerances</h4><p className="mt-2 text-muted-foreground">{previewing.rules.length} configured rule{previewing.rules.length === 1 ? "" : "s"}. Review exact field bindings in the source-mapping step.</p></section></div>}
              actions={<><Button variant="outline" onClick={() => setPreviewing(null)}>Close</Button><Button disabled={!canWrite} onClick={() => { setInstalling(previewing); setPreviewing(null); }}>Map sources &amp; install</Button></>}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {installing ? (
        <InstallStarterTemplateDialog
          key={installing.id}
          template={installing}
          tenantId={tenantId}
          ownerUnits={ownerUnits}
          ownersLoading={businessUnitsQ.isLoading}
          ownersError={businessUnitsQ.isError}
          onRetryOwners={() => businessUnitsQ.refetch()}
          sources={sourceQ.data ?? []}
          sourcesLoading={sourceQ.isPending}
          sourcesError={sourceQ.isError}
          onRetrySources={() => sourceQ.refetch()}
          onClose={() => setInstalling(null)}
          onInstalled={() => {
            qc.invalidateQueries({ queryKey: ["recons", tenantId] });
            qc.invalidateQueries({ queryKey: ["recon-templates"] });
            setInstalling(null);
          }}
        />
      ) : null}
    </div>
  );
}

type DataSourceOption = {
  id: string;
  name: string;
  inferred_schema: unknown;
  sample_rows: unknown;
};

function availableSourceFields(source: DataSourceOption | undefined): string[] {
  const fields = new Set<string>();
  if (Array.isArray(source?.inferred_schema)) {
    source.inferred_schema.forEach((column) => {
      if (column && typeof column === "object" && !Array.isArray(column)
        && "name" in column && typeof column.name === "string") {
        fields.add(column.name);
      }
    });
  } else if (source?.inferred_schema && typeof source.inferred_schema === "object") {
    Object.keys(source.inferred_schema).forEach((field) => fields.add(field));
  }
  const sample = Array.isArray(source?.sample_rows) ? source.sample_rows[0] : null;
  if (sample && typeof sample === "object" && !Array.isArray(sample)) {
    Object.keys(sample).forEach((field) => fields.add(field));
  }
  return [...fields].sort();
}

function InstallStarterTemplateDialog({
  template,
  tenantId,
  ownerUnits,
  ownersLoading,
  ownersError,
  onRetryOwners,
  sources,
  sourcesLoading,
  sourcesError,
  onRetrySources,
  onClose,
  onInstalled,
}: {
  template: StarterTemplate & { id: string; title: string; summary?: string };
  tenantId: string;
  ownerUnits: Array<{ id: string; name: string }>;
  ownersLoading: boolean;
  ownersError: boolean;
  onRetryOwners: () => void;
  sources: DataSourceOption[];
  sourcesLoading: boolean;
  sourcesError: boolean;
  onRetrySources: () => void;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const install = useServerFn(installReconTemplate);
  const requiredFields = starterTemplateFields(template);
  const [name, setName] = useState(template.title);
  const [ownerBuIds, setOwnerBuIds] = useState<string[]>([]);
  const [installMessage, setInstallMessage] = useState<UserMessage | null>(null);
  const [bindings, setBindings] = useState<StarterBinding[]>(
    template.legs.map(() => ({ data_source_id: "", field_map: {} })),
  );
  const installM = useMutation({
    mutationFn: () => install({
      data: { tenant_id: tenantId, template_id: template.id, name_override: name, bindings, owner_bu_ids: ownerBuIds },
    }),
    onSuccess: (row) => {
      setInstallMessage(null);
      toast.success(`Installed ${row.recon_code} as a mapped draft reconciliation`);
      onInstalled();
    },
    onError: (error: unknown) => setInstallMessage(templateInstallFailure(error)),
  });

  const selectSource = (index: number, sourceId: string) => {
    const source = sources.find((candidate) => candidate.id === sourceId);
    const columns = availableSourceFields(source);
    const normalized = new Map(columns.map((column) => [column.toLowerCase().replace(/[^a-z0-9]/gu, ""), column]));
    const fieldMap = Object.fromEntries(requiredFields.map((field) => [
      field,
      normalized.get(field.toLowerCase().replace(/[^a-z0-9]/gu, "")) ?? "",
    ]));
    setBindings((current) => current.map((binding, bindingIndex) =>
      bindingIndex === index ? { data_source_id: sourceId, field_map: fieldMap } : binding));
  };
  const progress = getStarterBindingProgress(template.legs.length, requiredFields, bindings, name);
  const sourceIds = bindings.map((binding) => binding.data_source_id).filter(Boolean);

  function submitInstall() {
    const fields: Array<{ field: string; issue: "required" | "invalid_format" | "unsupported_value" | "too_long" | "too_large"; limit?: number }> = [];
    const cleanName = name.trim();
    if (!cleanName) fields.push({ field: "Reconciliation name", issue: "required" });
    else if (cleanName.length < 2) fields.push({ field: "Reconciliation name", issue: "invalid_format" });
    else if (cleanName.length > 120) fields.push({ field: "Reconciliation name", issue: "too_long", limit: 120 });
    if (ownerBuIds.length === 0) fields.push({ field: "Owning business units", issue: "required" });
    else if (ownerBuIds.length > 50) fields.push({ field: "Owning business units", issue: "too_large", limit: 50 });
    bindings.forEach((binding, index) => {
      const sideLabel = template.legs[index]?.name || `Side ${index + 1}`;
      if (!binding?.data_source_id) fields.push({ field: `${sideLabel} source`, issue: "required" });
      requiredFields.forEach((field) => {
        if (!binding?.field_map[field]) fields.push({ field: `${sideLabel} ${field}`, issue: "required" });
      });
    });
    const selectedSourceIds = bindings.map((binding) => binding.data_source_id).filter(Boolean);
    if (new Set(selectedSourceIds).size !== selectedSourceIds.length) {
      bindings.forEach((binding, index) => {
        if (binding.data_source_id && selectedSourceIds.filter((id) => id === binding.data_source_id).length > 1) {
          fields.push({ field: `${template.legs[index]?.name || `Side ${index + 1}`} source`, issue: "invalid_format" });
        }
      });
    }
    if (fields.length) {
      setInstallMessage(formatUserMessage({ category: "input", action: "install this reconciliation template as a draft", fields }));
      return;
    }
    setInstallMessage(null);
    installM.mutate();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Map and install {template.title}</DialogTitle>
          <DialogDescription>
            Bind every template leg and required field to real tenant data. Installation is atomic and creates a runnable draft in ReconIQ Studio.
          </DialogDescription>
        </DialogHeader>
        {installMessage ? <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">{installMessage.title}</p><p className="mt-1">{installMessage.humanMessage}</p>{installMessage.nextActions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2" onClick={() => { if (action.id === "check-installed-draft") onInstalled(); }}>{action.label}</Button>)}</div> : null}
        <div className="space-y-5">
          <div>
            <Label htmlFor="starter-reconciliation-name">Reconciliation name</Label>
            <Input id="starter-reconciliation-name" value={name} onChange={(event) => { setName(event.target.value); setInstallMessage(null); }} maxLength={120} aria-invalid={Boolean(installMessage?.fieldErrors["Reconciliation name"])} aria-describedby="starter-reconciliation-name-help" />
            <p id="starter-reconciliation-name-help" className="mt-1 text-xs text-muted-foreground">Use 2–120 characters.</p>
            {installMessage?.fieldErrors["Reconciliation name"] ? <p role="alert" className="mt-1 text-xs text-destructive">{installMessage.fieldErrors["Reconciliation name"]}</p> : null}
          </div>
          <section aria-labelledby="starter-owner-units-title" className="space-y-2 rounded-md border p-3">
            <div>
              <h3 id="starter-owner-units-title" className="text-sm font-medium">Owning business units</h3>
              <p className="text-xs text-muted-foreground">Choose one or more active units that own this reconciliation. At least one is required (maximum 50).</p>
            </div>
            {ownersLoading ? <p role="status" className="text-sm text-muted-foreground">Loading tenant business units…</p> : null}
            {ownersError ? (
              <div role="alert" className="text-sm">
                <p>Business units are temporarily unavailable. Installation stays disabled.</p>
                <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetryOwners}>Try again</Button>
              </div>
            ) : null}
            {!ownersLoading && !ownersError && ownerUnits.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">No active business units are available in this tenant.</p>
            ) : null}
            {ownerUnits.map((unit) => (
              <label key={unit.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ownerBuIds.includes(unit.id)}
                  onChange={(event) => { setOwnerBuIds((current) => event.target.checked
                    ? [...current, unit.id]
                    : current.filter((id) => id !== unit.id)); setInstallMessage(null); }}
                />
                <span>{unit.name}</span>
              </label>
            ))}
            {installMessage?.fieldErrors["Owning business units"] ? <p role="alert" className="text-xs text-destructive">{installMessage.fieldErrors["Owning business units"]}</p> : null}
          </section>
          <Card className="border-primary/20 bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Source mapping checklist</CardTitle>
              <CardDescription>
                {progress.mappedFields} of {progress.requiredFieldCount} required field mappings complete. Every side needs a distinct tenant source.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {template.legs.map((leg, index) => {
                const binding = bindings[index];
                const source = sources.find((candidate) => candidate.id === binding?.data_source_id);
                const side = progress.sides[index];
                return (
                  <div key={`${template.code}-check-${index}`} className="flex flex-col gap-1 rounded-md border bg-background px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">Side {index + 1}: {leg.name || `Side ${index + 1}`}</span>
                    <span className={side.complete ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                      {source?.name ?? "Source required"} · {side.mappedFields}/{requiredFields.length} fields mapped
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
          {sourcesLoading ? <p role="status" className="text-sm text-muted-foreground">Loading tenant data sources…</p> : null}
          {sourcesError ? (
            <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm">
              <p className="font-medium">Tenant data sources are temporarily unavailable.</p>
              <p className="mt-1 text-muted-foreground">Try again before mapping this kit. Installation stays unavailable until the source list loads.</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetrySources}>Try again</Button>
            </div>
          ) : null}
          {!sourcesLoading && !sourcesError && sources.length === 0 ? (
            <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">No tenant data sources are available yet. Add a source in Data before mapping this kit.</p>
          ) : null}
          {template.legs.map((leg, index) => {
            const binding = bindings[index];
            const selectedSource = sources.find((source) => source.id === binding.data_source_id);
            const columns = availableSourceFields(selectedSource);
            return (
              <Card key={`${template.code}-${index}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Side {index + 1}: {leg.name || `Side ${index + 1}`}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Tenant data source</Label>
                    <Select value={binding.data_source_id} onValueChange={(value) => { selectSource(index, value); setInstallMessage(null); }}>
                      <SelectTrigger aria-label={`${leg.name || `Side ${index + 1}`} source`} aria-invalid={Boolean(installMessage?.fieldErrors[`${leg.name || `Side ${index + 1}`} source`])}><SelectValue placeholder="Select a tenant source" /></SelectTrigger>
                      <SelectContent>
                        {sources.map((source) => (
                          <SelectItem key={source.id} value={source.id} disabled={sourceIds.includes(source.id) && source.id !== binding.data_source_id}>
                            {source.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {installMessage?.fieldErrors[`${leg.name || `Side ${index + 1}`} source`] ? <p role="alert" className="mt-1 text-xs text-destructive">{installMessage.fieldErrors[`${leg.name || `Side ${index + 1}`} source`]}</p> : null}
                  </div>
                  {selectedSource ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {requiredFields.map((field) => (
                        <div key={`${index}-${field}`}>
                          <Label>{field}</Label>
                          <Select
                            value={binding.field_map[field] || ""}
                            onValueChange={(value) => { setBindings((current) => current.map((item, bindingIndex) =>
                              bindingIndex === index
                                ? { ...item, field_map: { ...item.field_map, [field]: value } }
                                : item)); setInstallMessage(null); }}
                          >
                            <SelectTrigger aria-label={`${leg.name || `Side ${index + 1}`} ${field}`} aria-invalid={Boolean(installMessage?.fieldErrors[`${leg.name || `Side ${index + 1}`} ${field}`])}><SelectValue placeholder="Map a source column" /></SelectTrigger>
                            <SelectContent>
                              {columns.map((column) => <SelectItem key={column} value={column}>{column}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {installMessage?.fieldErrors[`${leg.name || `Side ${index + 1}`} ${field}`] ? <p role="alert" className="mt-1 text-xs text-destructive">{installMessage.fieldErrors[`${leg.name || `Side ${index + 1}`} ${field}`]}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={ownersLoading || ownersError || ownerUnits.length === 0 || sourcesLoading || sourcesError || sources.length === 0 || installM.isPending} onClick={submitInstall}>
            {installM.isPending ? "Installing…" : "Install runnable draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
