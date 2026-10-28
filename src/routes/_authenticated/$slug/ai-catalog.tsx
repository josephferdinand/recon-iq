import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AI_MODEL_CATALOG,
  PROVIDER_META,
  filterCatalog,
  type Capability,
  type ModelEntry,
  type ProviderKey,
  type Tier,
} from "@/lib/ai-model-catalog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Sparkles, Search, Cpu, Layers, Eye, Zap, Wrench,
  Braces, Gauge, Globe2, Bot, KeyRound, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/$slug/ai-catalog")({
  component: AiCatalogPage,
});

const CAPABILITY_META: Record<Capability, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  reasoning:          { label: "Reasoning",         icon: Cpu },
  coding:             { label: "Coding",            icon: Braces },
  vision:             { label: "Vision",            icon: Eye },
  audio:              { label: "Audio",             icon: Sparkles },
  "long-context":     { label: "Long context",      icon: Layers },
  fast:               { label: "Fast",              icon: Zap },
  "cost-efficient":   { label: "Cost-efficient",    icon: Gauge },
  agentic:            { label: "Agentic",           icon: Bot },
  "structured-output":{ label: "Structured output", icon: Braces },
  "tool-use":         { label: "Tool use",          icon: Wrench },
  multilingual:       { label: "Multilingual",      icon: Globe2 },
};

const TIER_STYLE: Record<Tier, string> = {
  flagship: "bg-gradient-to-r from-primary/20 to-purple-500/20 text-foreground border-primary/40",
  balanced: "bg-blue-500/10 text-foreground border-blue-500/30",
  efficient:"bg-emerald-500/10 text-foreground border-emerald-500/30",
  preview:  "bg-amber-500/10 text-foreground border-amber-500/30",
};

function AiCatalogPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/ai-catalog" });
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<ProviderKey | "all">("all");
  const [tier, setTier] = useState<Tier | "all">("all");
  const [capability, setCapability] = useState<Capability | "all">("all");

  const filtered = useMemo(
    () => filterCatalog(AI_MODEL_CATALOG, { search, provider, tier, capability }),
    [search, provider, tier, capability],
  );

  const byTier: Record<Tier, ModelEntry[]> = {
    flagship: [], balanced: [], efficient: [], preview: [],
  };
  filtered.forEach((m) => byTier[m.tier].push(m));

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20">
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link to="/$slug/tenant" params={{ slug }}>
                <ArrowLeft className="h-4 w-4" /> Back to tenant
              </Link>
            </Button>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-primary/20 via-purple-500/20 to-transparent p-3">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">AI Model Catalog</h1>
                <p className="text-sm text-muted-foreground">
                  Curated frontier and balanced models available to wire into your Copilot, agents, and reconciliation pipelines.
                </p>
              </div>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link to="/$slug/tenant" params={{ slug }} hash="llm">
              <Wrench className="h-4 w-4 mr-2" /> Configure provider chain
            </Link>
          </Button>
        </div>

        {/* Filters */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search models…"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={provider} onValueChange={(v) => setProvider(v as ProviderKey | "all")}>
                <SelectTrigger><SelectValue placeholder="Provider" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All providers</SelectItem>
                  {Object.entries(PROVIDER_META).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={tier} onValueChange={(v) => setTier(v as Tier | "all")}>
                <SelectTrigger><SelectValue placeholder="Tier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tiers</SelectItem>
                  <SelectItem value="flagship">Flagship</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="efficient">Efficient</SelectItem>
                  <SelectItem value="preview">Preview</SelectItem>
                </SelectContent>
              </Select>
              <Select value={capability} onValueChange={(v) => setCapability(v as Capability | "all")}>
                <SelectTrigger><SelectValue placeholder="Capability" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All capabilities</SelectItem>
                  {Object.entries(CAPABILITY_META).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filtered.length}</span> of {AI_MODEL_CATALOG.length} models
            </div>
          </CardContent>
        </Card>

        {/* Sections by tier */}
        {(["flagship", "balanced", "efficient", "preview"] as Tier[]).map((t) =>
          byTier[t].length === 0 ? null : (
            <section key={t} className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold capitalize tracking-tight">{t}</h2>
                <span className="text-xs text-muted-foreground">({byTier[t].length})</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {byTier[t].map((m) => <ModelCard key={m.id} model={m} slug={slug} />)}
              </div>
            </section>
          ),
        )}

        {filtered.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center text-sm text-muted-foreground">
              No models match your filters.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ModelCard({ model, slug }: { model: ModelEntry; slug: string }) {
  const providerColor = PROVIDER_META[model.provider]?.color ?? "hsl(220 10% 50%)";

  const copyId = () => {
    void navigator.clipboard.writeText(model.id);
    toast.success(`Copied model id: ${model.id}`);
  };

  return (
    <Card className="group relative overflow-hidden border-border/60 transition hover:border-primary/50 hover:shadow-lg">
      {/* Accent bar tinted by provider */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${providerColor}, transparent)` }}
      />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate text-base">{model.displayName}</CardTitle>
              {model.releaseTag === "new" && (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">NEW</Badge>
              )}
              {model.releaseTag === "preview" && (
                <Badge variant="outline" className="border-amber-500/40">Preview</Badge>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: providerColor }}
              />
              <span>{model.providerLabel}</span>
              <span>·</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{model.id}</code>
            </div>
          </div>
          <Badge variant="outline" className={TIER_STYLE[model.tier]}>{model.tier}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CardDescription className="line-clamp-3 text-sm">{model.description}</CardDescription>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="Context" value={`${(model.contextWindow / 1000).toLocaleString()}K tok`} />
          <Stat label="Modalities" value={model.modalities.join(" · ")} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {model.capabilities.map((c) => {
            const meta = CAPABILITY_META[c];
            const Icon = meta.icon;
            return (
              <span
                key={c}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <Icon className="h-3 w-3" /> {meta.label}
              </span>
            );
          })}
        </div>

        {model.recommendedFor.length > 0 && (
          <div className="rounded-md bg-muted/30 p-2.5 text-xs">
            <div className="mb-1 font-medium text-foreground/80">Recommended for</div>
            <ul className="space-y-0.5 text-muted-foreground">
              {model.recommendedFor.map((r) => (
                <li key={r} className="flex items-center gap-1.5">
                  <ChevronRight className="h-3 w-3" /> {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          {model.requiresBYOK ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-800 dark:text-amber-200">
              <KeyRound className="h-3 w-3" /> Requires BYOK
            </span>
          ) : <span />}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={copyId}>Copy id</Button>
            <Button asChild size="sm">
              <Link to="/$slug/tenant" params={{ slug }} hash="llm">Use in chain</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  );
}
