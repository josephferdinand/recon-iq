import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Code2,
  ShieldCheck,
  Layers,
  Lock,
  Activity,
  Network,
  GitBranch,
  Search,
  FileText,
  Home,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DOC_CATEGORIES,
  DOC_VERSIONS,
  DOC_VERSION_META,
  DEFAULT_DOC_VERSION,
  LATEST_DOC_VERSION,
  entriesForVersion,
  searchDocs,
  type DocVersion,
} from "@/lib/docs-registry";

const docsSearch = z.object({
  v: fallback(z.enum(DOC_VERSIONS), DEFAULT_DOC_VERSION).default(DEFAULT_DOC_VERSION),
});

export const Route = createFileRoute("/_authenticated/docs")({
  ssr: false,
  validateSearch: zodValidator(docsSearch),
  head: () => ({
    meta: [
      { title: "Docs hub — ReconIQ" },
      { name: "description", content: "Versioned table of contents for API docs, runbooks, admin guides and diagrams." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DocsLayout,
});

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Code2, BookOpen, ShieldCheck, Layers, Lock, Activity, Network, GitBranch,
};

function DocsLayout() {
  const [q, setQ] = useState("");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = Route.useSearch() as { v: DocVersion };
  const v: DocVersion = search.v ?? DEFAULT_DOC_VERSION;
  const navigate = useNavigate();
  const results = useMemo(() => searchDocs(q, v), [q, v]);
  const isHub = pathname === "/docs" || pathname === "/docs/";
  const versionMeta = DOC_VERSION_META[v];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link to="/docs" search={{ v }} className="flex items-center gap-2 font-semibold">
            <BookOpen className="h-5 w-5 text-primary" />
            <span>Docs hub</span>
          </Link>
          <Badge variant="secondary" className="hidden sm:inline-flex">Internal</Badge>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">Version</span>
            <Select
              value={v}
              onValueChange={(next) => {
                navigate({ to: ".", search: { v: next as DocVersion }, replace: true });
              }}
            >
              <SelectTrigger className="h-8 w-[170px]" aria-label="Docs version">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_VERSIONS.map((ver) => {
                  const meta = DOC_VERSION_META[ver];
                  return (
                    <SelectItem key={ver} value={ver}>
                      <span className="flex items-center gap-2">
                        <span>{meta.label}</span>
                        {meta.status === "latest" && (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">latest</Badge>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Link to="/home" className="ml-2 text-sm text-muted-foreground hover:text-foreground">
              <Home className="mr-1 inline h-4 w-4" />Back
            </Link>
          </div>
        </div>
        {v !== LATEST_DOC_VERSION && (
          <div className="border-t bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-900 dark:text-amber-200">
            You are viewing the archived <strong>{versionMeta.label}</strong> docs.{" "}
            <button
              type="button"
              onClick={() => navigate({ to: ".", search: { v: LATEST_DOC_VERSION }, replace: true })}
              className="underline underline-offset-2 hover:no-underline"
            >
              Switch to {DOC_VERSION_META[LATEST_DOC_VERSION].label}
            </button>
          </div>
        )}
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[300px_1fr]">
        <aside className="lg:sticky lg:top-[68px] lg:h-[calc(100vh-84px)]">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search docs…"
              className="pl-8"
            />
          </div>

          <ScrollArea className="h-[calc(100vh-160px)] pr-2">
            {q ? (
              <div className="space-y-1">
                <p className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {results.length} result{results.length === 1 ? "" : "s"} in {versionMeta.label}
                </p>
                {results.map((r) => (
                  <Link
                    key={r.slug}
                    to="/docs/$"
                    params={{ _splat: r.slug }}
                    search={{ v }}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                      pathname === `/docs/${r.slug}` && "bg-muted font-medium",
                    )}
                  >
                    <span className="line-clamp-1">{r.title}</span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{r.slug}</span>
                  </Link>
                ))}
                {results.length === 0 && (
                  <p className="px-2 text-sm text-muted-foreground">No matches.</p>
                )}
              </div>
            ) : (
              <nav className="space-y-4">
                {DOC_CATEGORIES.map((cat) => {
                  const Icon = ICONS[cat.icon] ?? FileText;
                  const entries = entriesForVersion(cat, v);
                  if (entries.length === 0) return null;
                  return (
                    <div key={cat.id}>
                      <p className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Icon className="h-3.5 w-3.5" />
                        {cat.title}
                      </p>
                      <ul className="space-y-0.5">
                        {entries.map((e) => {
                          const active = pathname === `/docs/${e.slug}`;
                          return (
                            <li key={e.slug}>
                              <Link
                                to="/docs/$"
                                params={{ _splat: e.slug }}
                                search={{ v }}
                                className={cn(
                                  "block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                                  active && "bg-muted font-medium text-foreground",
                                )}
                              >
                                {e.title}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </nav>
            )}
          </ScrollArea>
        </aside>

        <main className="min-w-0">
          {isHub ? <DocsHub version={v} /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}

function DocsHub({ version }: { version: DocVersion }) {
  const meta = DOC_VERSION_META[version];
  return (
    <div className="space-y-8">
      <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-8">
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Documentation hub</h1>
          <Badge variant={meta.status === "latest" ? "default" : "secondary"}>
            {meta.label}
          </Badge>
        </div>
        <p className="max-w-2xl text-muted-foreground">
          Single source of truth for ReconIQ: API references, operational runbooks, admin
          guides, architecture &amp; security posture, observability, diagrams, and
          release governance. Released {meta.releaseDate}. Use the version selector
          in the header to switch between {DOC_VERSION_META["v4.0"].label} and{" "}
          {DOC_VERSION_META["v3.0"].label}.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DOC_CATEGORIES.map((cat) => {
          const Icon = ICONS[cat.icon] ?? FileText;
          const entries = entriesForVersion(cat, version);
          if (entries.length === 0) return null;
          return (
            <div
              key={cat.id}
              className={cn("rounded-xl border bg-gradient-to-br p-5", cat.accent)}
            >
              <div className="mb-3 flex items-center gap-2">
                <div className="rounded-md bg-background/70 p-2">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold">{cat.title}</h2>
                <Badge variant="outline" className="ml-auto">
                  {entries.length}
                </Badge>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">{cat.description}</p>
              <ul className="space-y-1">
                {entries.slice(0, 6).map((e) => (
                  <li key={e.slug}>
                    <Link
                      to="/docs/$"
                      params={{ _splat: e.slug }}
                      search={{ v: version }}
                      className="text-sm text-foreground/90 hover:text-primary hover:underline"
                    >
                      {e.title}
                    </Link>
                  </li>
                ))}
                {entries.length > 6 && (
                  <li className="text-xs text-muted-foreground">
                    + {entries.length - 6} more
                  </li>
                )}
                {cat.id === "diagrams" && (
                  <li className="pt-2">
                    <Link
                      to="/docs/diagrams"
                      className="inline-flex items-center gap-1 rounded-md border bg-background/70 px-2 py-1 text-xs font-medium hover:border-primary hover:text-primary"
                    >
                      Open diagram gallery →
                    </Link>
                  </li>
                )}
                {cat.id === "api" && (
                  <>
                    <li className="pt-2">
                      <Link
                        to="/docs/sdk"
                        className="inline-flex items-center gap-1 rounded-md border bg-background/70 px-2 py-1 text-xs font-medium hover:border-primary hover:text-primary"
                      >
                        Open TypeScript SDK →
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/docs/sandbox"
                        className="inline-flex items-center gap-1 rounded-md border bg-background/70 px-2 py-1 text-xs font-medium hover:border-primary hover:text-primary"
                      >
                        Open API sandbox →
                      </Link>
                    </li>
                  </>
                )}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
