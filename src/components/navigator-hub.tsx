import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { navigatorHubData, getKbArticleBySlug } from "@/lib/kb-reader.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueryErrorFeedback, safeActionErrorMessage } from "@/components/query-error-feedback";
import {
  BookOpen, Search, Sparkles, ChevronRight, Clock, Star, BookCheck, Compass, Plane,
  Workflow, Database, ChevronDown, ChevronUp, FileText,
} from "lucide-react";
import DOMPurify from "isomorphic-dompurify";

type Scope = "workspace" | "tenant" | "platform";

const LEARNING_PATHS: { title: string; sub: string; icon: any; cats: string[]; minutes: number }[] = [
  { title: "Getting Started", sub: "New to ReconIQ? Start here", icon: Plane, cats: ["getting-started"], minutes: 25 },
  { title: "Reconciliation Mastery", sub: "Single Side → Two-Sided → Tri-Party", icon: Workflow, cats: ["rekon-studio", "squawk-desk"], minutes: 40 },
  { title: "Data Management", sub: "Cargo Bay → Data Refinery → connections", icon: Database, cats: ["cargo-bay", "data-refinery"], minutes: 30 },
  { title: "AI & Governance", sub: "LLM config, Copilot, governance", icon: Sparkles, cats: ["llm-config", "ai-governance", "ai-copilot"], minutes: 35 },
];

function readKey(scope: Scope, tenantId?: string) {
  return `fvi:kb:read:${scope}:${tenantId ?? "_"}`;
}
function loadRead(scope: Scope, tenantId?: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value: unknown = JSON.parse(localStorage.getItem(readKey(scope, tenantId)) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((slug): slug is string => typeof slug === "string") : []);
  } catch { return new Set(); }
}
function saveRead(scope: Scope, tenantId: string | undefined, set: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(readKey(scope, tenantId), JSON.stringify(Array.from(set)));
}
function recentKey(scope: Scope, tenantId?: string) { return `fvi:kb:recent:${scope}:${tenantId ?? "_"}`; }
function loadRecent(scope: Scope, tenantId?: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentKey(scope, tenantId)) ?? "[]");
    return Array.isArray(value) ? value.filter((slug): slug is string => typeof slug === "string") : [];
  } catch { return []; }
}
function pushRecent(scope: Scope, tenantId: string | undefined, slug: string) {
  const cur = loadRecent(scope, tenantId).filter(s => s !== slug);
  cur.unshift(slug);
  localStorage.setItem(recentKey(scope, tenantId), JSON.stringify(cur.slice(0, 6)));
}

function renderMd(md: string) {
  // Lightweight markdown -> HTML. Safe enough for trusted seed content.
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const safeUrl = (u: string) => /^(https?:|\/|\.)/i.test(u) ? u : "#";
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let inOl = false;
  let stepN = 0;
  let inQuote = false;

  const flushLists = () => {
    if (inList) { out.push("</ul>"); inList = false; }
    if (inOl) { out.push("</div>"); inOl = false; stepN = 0; }
    if (inQuote) { out.push("</blockquote>"); inQuote = false; }
  };
  const inline = (s: string) =>
    escape(s)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => `<img alt="${escape(alt)}" src="${escape(safeUrl(src))}" class="my-3 w-full rounded-lg border" />`)
      .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Render an H2/H3 with optional "Step N:" auto-decoration so authors writing
  // "## Step 1: Upload the statement" also get the polished step chrome.
  const renderHeading = (level: 2 | 3, text: string) => {
    const m = /^step\s+(\d+)\s*[:.\-–]\s*(.+)$/i.exec(text);
    const tag = `h${level}`;
    if (m) {
      const n = m[1];
      const rest = inline(m[2]);
      return `<${tag} class="not-prose mt-8 mb-3 flex items-center gap-3 scroll-mt-20">
        <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shadow">${n}</span>
        <span class="flex flex-col leading-tight">
          <span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">Step ${n}</span>
          <span class="font-display text-lg font-semibold tracking-tight">${rest}</span>
        </span>
      </${tag}>`;
    }
    return `<${tag}>${inline(text)}</${tag}>`;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Pipe tables: header | --- | rows
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushLists();
      const header = line.trim().replace(/^\||\|$/g, "").split("|").map(s => s.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map(s => s.trim()));
        i++;
      }
      i--;
      out.push('<div class="my-3 overflow-x-auto"><table class="w-full text-sm border-collapse"><thead><tr>' +
        header.map(h => `<th class="border-b bg-muted/50 px-2 py-1.5 text-left font-medium">${inline(h)}</th>`).join("") +
        "</tr></thead><tbody>" +
        rows.map(r => "<tr>" + r.map(c => `<td class="border-b px-2 py-1.5 align-top">${inline(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table></div>");
      continue;
    }
    if (/^# /.test(line)) { flushLists(); out.push(`<h1>${inline(line.slice(2))}</h1>`); continue; }
    if (/^## /.test(line)) { flushLists(); out.push(renderHeading(2, line.slice(3))); continue; }
    if (/^### /.test(line)) { flushLists(); out.push(renderHeading(3, line.slice(4))); continue; }
    if (/^---\s*$/.test(line)) { flushLists(); out.push("<hr />"); continue; }
    if (/^> /.test(line)) {
      if (!inQuote) { flushLists(); out.push('<blockquote class="border-l-4 border-primary/40 bg-muted/30 px-4 py-2 italic text-foreground/80">'); inQuote = true; }
      out.push(`<p>${inline(line.slice(2))}</p>`);
      continue;
    }
    if (/^\s*[-*] /.test(line)) {
      if (inOl) { out.push("</div>"); inOl = false; stepN = 0; }
      if (inQuote) { out.push("</blockquote>"); inQuote = false; }
      if (!inList) { out.push('<ul class="my-3 ml-5 list-disc space-y-1.5 marker:text-primary/60">'); inList = true; }
      out.push(`<li class="pl-1 text-foreground/90">${inline(line.replace(/^\s*[-*] /, ""))}</li>`);
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      if (inQuote) { out.push("</blockquote>"); inQuote = false; }
      if (!inOl) {
        out.push('<div class="not-prose my-5 space-y-3" role="list" aria-label="Steps">');
        inOl = true; stepN = 0;
      }
      stepN += 1;
      const content = inline(line.replace(/^\s*\d+\.\s/, ""));
      out.push(`<div role="listitem" class="group relative flex gap-4 rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
        <div class="flex flex-col items-center">
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shadow-sm">${stepN}</div>
        </div>
        <div class="flex-1 space-y-1.5 min-w-0">
          <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">Step ${stepN}</div>
          <div class="text-sm leading-relaxed text-foreground/90 break-words">${content}</div>
        </div>
      </div>`);
      continue;
    }
    if (line.trim() === "") { flushLists(); continue; }
    flushLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  flushLists();
  // Defense-in-depth: sanitize the assembled HTML so any attribute-context
  // breakout (e.g. backticks inside image alt text) is normalized away.
  return DOMPurify.sanitize(out.join("\n"), {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: ["href", "src", "alt", "class", "role", "aria-label", "target", "rel"],
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "style"],
  });
}


export function NavigatorHub({ scope, tenantId }: { scope: Scope; tenantId?: string }) {
  const fn = useServerFn(navigatorHubData);
  const getOne = useServerFn(getKbArticleBySlug);

  const q = useQuery({
    queryKey: ["navigator-hub", scope, tenantId ?? null],
    queryFn: () => fn({ data: { tenant_id: tenantId } }),
    staleTime: 60_000,
  });

  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>([]);
  const [showAllCats, setShowAllCats] = useState(false);

  useEffect(() => {
    setReadSet(loadRead(scope, tenantId));
    setRecents(loadRecent(scope, tenantId));
  }, [scope, tenantId]);

  const articles = q.data?.articles ?? [];
  const categories = q.data?.categories ?? [];

  // counts per category
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      if (!a.category_id) continue;
      m.set(a.category_id, (m.get(a.category_id) ?? 0) + 1);
    }
    return m;
  }, [articles]);

  const readPerCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      if (!a.category_id) continue;
      if (readSet.has(a.slug)) m.set(a.category_id, (m.get(a.category_id) ?? 0) + 1);
    }
    return m;
  }, [articles, readSet]);

  const filtered = useMemo(() => {
    let list = articles;
    if (activeCat) list = list.filter((a: any) => a.category_id === activeCat);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((a: any) => a.title.toLowerCase().includes(s));
    }
    return list;
  }, [articles, activeCat, search]);

  const recentArticles = useMemo(() => {
    const bySlug = new Map(articles.map((a: any) => [a.slug, a]));
    return recents.map(s => bySlug.get(s)).filter(Boolean).slice(0, 4) as any[];
  }, [recents, articles]);

  const popularArticles = useMemo(() => {
    return [...articles].sort((a: any, b: any) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 3);
  }, [articles]);

  const totalRead = readSet.size;
  const totalArticles = articles.length;
  const pct = totalArticles ? Math.round((totalRead / totalArticles) * 100) : 0;

  const openArticle = (slug: string) => {
    setOpenSlug(slug);
  };

  const article = useQuery({
    queryKey: ["kb-article", scope, tenantId ?? null, openSlug],
    queryFn: () => getOne({ data: { slug: openSlug! } }),
    enabled: !!openSlug,
  });

  useEffect(() => {
    const slug = article.data?.slug;
    if (!slug) return;
    setReadSet((current) => {
      if (current.has(slug)) return current;
      const next = new Set(current);
      next.add(slug);
      saveRead(scope, tenantId, next);
      return next;
    });
    pushRecent(scope, tenantId, slug);
    setRecents(loadRecent(scope, tenantId));
  }, [article.data?.slug, scope, tenantId]);

  if (q.isError) {
    return <QueryErrorFeedback error={q.error} onRetry={q.refetch} resource="Knowledge articles and categories" />;
  }

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <Skeleton className="h-96" /><Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const visibleCats = showAllCats ? categories : categories.slice(0, 14);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border bg-background shadow-sm">
            <Compass className="h-7 w-7 text-primary" />
          </div>
          <div className="flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
              <BookOpen className="h-3 w-3 text-primary" /> Navigator Hub
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">Navigator Hub (Knowledge Base)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {totalArticles} articles · {categories.length} categories — your complete operations manual for {scope === "workspace" ? "the Workspace" : scope === "tenant" ? "the Tenant" : "the Platform"}.
            </p>
          </div>
        </div>

        <div className="relative mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search articles… (Enter to search)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" className="gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI Search
          </Button>
          <RebuildCopilotIndexButton tenantId={tenantId} />

        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        {/* Sidebar: categories */}
        <Card>
          <CardContent className="p-3">
            <button
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              onClick={() => setShowAllCats(v => !v)}
            >
              Categories
              {showAllCats ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <ScrollArea className="mt-1 h-[520px] pr-1">
              <div className="space-y-0.5">
                <button
                  onClick={() => setActiveCat(null)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition ${
                    activeCat === null ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60"
                  }`}
                >
                  <span className="flex items-center gap-2"><BookOpen className="h-4 w-4" /> All Articles</span>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{totalArticles}</Badge>
                </button>
                {visibleCats.map((c: any) => {
                  const cnt = catCounts.get(c.id) ?? 0;
                  const read = readPerCat.get(c.id) ?? 0;
                  const done = cnt > 0 && read === cnt;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveCat(c.id)}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition ${
                        activeCat === c.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{c.name}</span>
                        {done && <BookCheck className="h-3.5 w-3.5 text-emerald-500" />}
                      </span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{cnt}</Badge>
                    </button>
                  );
                })}
                {!showAllCats && categories.length > 14 ? (
                  <button onClick={() => setShowAllCats(true)} className="px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground">
                    + {categories.length - 14} more
                  </button>
                ) : null}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Main */}
        <div className="space-y-4">
          {/* Progress */}
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <BookCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your Progress</span>
              <div className="flex-1"><Progress value={pct} className="h-2" /></div>
              <span className="text-xs font-medium tabular-nums text-primary">
                {totalRead} / {totalArticles} articles read ({pct}%)
              </span>
            </CardContent>
          </Card>

          {/* Recently viewed + Popular */}
          {activeCat === null && !search.trim() ? (
            <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> Recently Viewed
                  </div>
                  {recentArticles.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Open any article to start your trail.</p>
                  ) : (
                    <div className="space-y-2">
                      {recentArticles.map((a: any) => (
                        <ArticleRow key={a.id} a={a} catName={categories.find((c: any) => c.id === a.category_id)?.name ?? ""} onOpen={() => openArticle(a.slug)} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Star className="h-3.5 w-3.5" /> Popular Articles
                  </div>
                  <div className="space-y-2">
                    {popularArticles.map((a: any) => (
                      <ArticleRow key={a.id} a={a} catName={categories.find((c: any) => c.id === a.category_id)?.name ?? ""} onOpen={() => openArticle(a.slug)} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* Filtered article grid */}
          {activeCat || search.trim() ? (
            <Card>
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">
                    {activeCat ? categories.find((c: any) => c.id === activeCat)?.name : `Search: "${search}"`}
                  </div>
                  <Badge variant="outline">{filtered.length} articles</Badge>
                </div>
                {filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No articles match your search.</p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {filtered.map((a: any) => (
                      <ArticleRow key={a.id} a={a} catName={categories.find((c: any) => c.id === a.category_id)?.name ?? ""} onOpen={() => openArticle(a.slug)} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Learning paths */}
          {activeCat === null && !search.trim() ? (
            <div>
              <div className="mb-3 text-sm font-semibold">Learning Paths</div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {LEARNING_PATHS.map((lp) => {
                  const inPath = articles.filter((a: any) => {
                    const c = categories.find((c: any) => c.id === a.category_id);
                    return c && lp.cats.includes(c.slug);
                  });
                  const done = inPath.filter(a => readSet.has(a.slug)).length;
                  const pctp = inPath.length ? Math.round((done / inPath.length) * 100) : 0;
                  const Icon = lp.icon;
                  return (
                    <Card key={lp.title} className="overflow-hidden">
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-start gap-2">
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="font-medium leading-tight">{lp.title}</div>
                            <div className="text-xs text-muted-foreground">{lp.sub}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{inPath.length} articles</span><span>·</span><span>{lp.minutes} min</span>
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                            <span>Progress</span><span>{pctp}%</span>
                          </div>
                          <Progress value={pctp} className="h-1.5" />
                        </div>
                        <Button
                          variant="ghost" size="sm" className="h-7 w-full justify-start gap-1 px-2 text-primary"
                          onClick={() => {
                            const cat = categories.find((c: any) => lp.cats.includes(c.slug));
                            if (cat) setActiveCat(cat.id);
                          }}
                        >
                          <ChevronRight className="h-3.5 w-3.5" /> {pctp > 0 ? "Continue" : "Start Path"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Article modal */}
      <Dialog open={!!openSlug} onOpenChange={(o) => !o && setOpenSlug(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          {(() => {
            const a: any = article.data;
            const catName = a ? (categories.find((c: any) => c.id === a.category_id)?.name ?? "") : "";
            const stepCount = a?.body_md ? (a.body_md.match(/^\s*\d+\.\s/gm)?.length ?? 0) : 0;
            return (
              <>
                <div className="relative border-b bg-gradient-to-br from-primary/10 via-background to-background px-6 pb-5 pt-6">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-primary/15 blur-3xl" />
                  <DialogHeader className="relative space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {catName ? (
                        <Badge variant="secondary" className="px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
                          {catName.replace(/^[^\s]+\s/, "")}
                        </Badge>
                      ) : null}
                      {stepCount > 0 ? (
                        <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[10px] font-medium">
                          <BookCheck className="h-3 w-3 text-primary" />
                          {stepCount} step{stepCount === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3" /> {a?.read_time_min ?? 4} min read
                      </span>
                    </div>
                    <DialogTitle className="flex items-start gap-3 font-display text-2xl font-semibold tracking-tight">
                      <FileText className="mt-1 h-5 w-5 shrink-0 text-primary" />
                      <span>{a?.title ?? (article.isError ? "Article unavailable" : "Loading…")}</span>
                    </DialogTitle>
                    {a?.summary ? (
                      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{a.summary}</p>
                    ) : null}
                  </DialogHeader>
                </div>
                <ScrollArea className="max-h-[70vh] px-6 py-5">
                  {article.isError ? (
                    <QueryErrorFeedback error={article.error} onRetry={article.refetch} resource="Knowledge article" />
                  ) : article.isLoading || !a ? (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  ) : (
                    <article
                      className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-display prose-h1:text-2xl prose-h2:text-lg prose-h3:text-base prose-a:text-primary prose-strong:text-foreground prose-p:leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMd(a.body_md) }}
                    />
                  )}
                </ScrollArea>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

    </div>
  );
}

function ArticleRow({ a, catName, onOpen }: { a: any; catName: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-stretch gap-3 overflow-hidden rounded-lg border bg-card p-0 text-left transition hover:border-primary/40 hover:shadow-sm"
    >
      {a.cover_image_url ? (
        <div className="hidden h-auto w-20 shrink-0 overflow-hidden sm:block">
          <img src={a.cover_image_url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
        </div>
      ) : null}
      <div className="flex-1 space-y-1 p-3">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="px-1.5 py-0 text-[9px] uppercase tracking-wider">
            {catName.replace(/^[^\s]+\s/, "")}
          </Badge>
          <BookCheck className="h-3 w-3 text-emerald-500 opacity-0 group-hover:opacity-100" />
        </div>
        <div className="text-sm font-medium leading-snug">{a.title}</div>
        {a.summary ? (
          <div className="line-clamp-2 text-[11px] text-muted-foreground">{a.summary}</div>
        ) : null}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" /> {a.read_time_min ?? 4} min read
        </div>
      </div>
      <ChevronRight className="mt-3 mr-2 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

function RebuildCopilotIndexButton({ tenantId }: { tenantId?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Button
      variant="outline"
      className="gap-2"
      disabled={busy}
      title="Re-embed all visible KB articles so the Copilot's semantic search returns them."
      onClick={async () => {
        setBusy(true); setMsg(null);
        try {
          const mod = await import("@/lib/kb-embeddings.functions");
          const res: any = await (mod.rebuildKbEmbeddings as any)({ data: tenantId ? { tenant_id: tenantId } : {} });
          setMsg(`Indexed ${res?.articles ?? 0} articles (${res?.chunks ?? 0} chunks).`);
        } catch (e: unknown) {
          setMsg(safeActionErrorMessage(e));
        } finally { setBusy(false); }
      }}
    >
      <Sparkles className="h-4 w-4 text-primary" />
      {busy ? "Indexing…" : msg ?? "Rebuild Copilot search"}
    </Button>
  );
}
