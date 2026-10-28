import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { Category } from "@/content/support-toc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import {
  Search, Rocket, BookOpen, GitBranch, ShieldCheck, Code, FileText,
  Wrench, HelpCircle, MessageCircle, ArrowRight, ExternalLink,
} from "lucide-react";

const ICON_MAP: Record<string, typeof Rocket> = {
  rocket: Rocket, "book-open": BookOpen, "git-branch": GitBranch,
  "shield-check": ShieldCheck, code: Code, "file-text": FileText,
  wrench: Wrench, "help-circle": HelpCircle, "message-circle": MessageCircle,
};

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support | ReconIQ" },
      { name: "description", content: "Documentation, guides, API reference, and support for the ReconIQ reconciliation platform." },
      { property: "og:title", content: "ReconIQ Support" },
      { property: "og:description", content: "Documentation, guides, API reference, and support for the ReconIQ reconciliation platform." },
      { property: "og:url", content: "https://support-fvi.reconiq.example/support" },
    ],
    links: [{ rel: "canonical", href: "https://support-fvi.reconiq.example/support" }],
  }),
  loader: async () => {
    const { getSupportCategories } = await import("@/content/support-toc");
    return { categories: getSupportCategories() };
  },
  component: SupportLayout,
});

function SupportLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ slug: string; title: string; summary: string; categorySlug: string; categoryName: string }>>([]);
  const SUPPORT_CATEGORIES: Category[] = Route.useLoaderData()?.categories ?? [];
  const isLanding = pathname === "/support" || pathname === "/support/";
  useMemo(() => {
    if (!q.trim()) { setResults([]); return; }
    let cancelled = false;
    void import("@/content/support-toc").then(({ searchArticles }) => {
      if (!cancelled) setResults(searchArticles(q).slice(0, 8));
    });
    return () => { cancelled = true; };
  }, [q]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-6">
          <Link to="/support" className="flex items-center gap-2">
            <FviApprovedLogo className="h-11 w-11 rounded-sm" />
            <div className="hidden sm:block">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">ReconIQ</div>
              <div className="-mt-0.5 font-display text-sm font-semibold">Support Center</div>
            </div>
          </Link>
          <nav aria-label="Support" className="ml-4 hidden items-center gap-1 md:flex">
            {SUPPORT_CATEGORIES.slice(0, 5).map((c) => (
              <Link key={c.slug} to="/support/$category" params={{ category: c.slug }}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-primary/10 text-primary" }}>
                {c.name}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href="https://app-fvi.reconiq.example" className="hidden items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted sm:inline-flex">
              Go to app <ExternalLink className="h-3 w-3" />
            </a>
            <Link to="/support/$category/$article" params={{ category: "contact", article: "submit-ticket" }}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
              Submit ticket
            </Link>
          </div>
        </div>
      </header>

      {/* HERO SEARCH — only on landing */}
      {isLanding && (
        <section className="relative overflow-hidden border-b border-border/60">
          <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
            style={{ background: "radial-gradient(closest-side, var(--brand-gold, hsl(var(--primary))), transparent)" }} />
          <div className="relative mx-auto max-w-4xl px-6 py-16 text-center">
            <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/5 text-primary">
              <BookOpen className="h-3 w-3" /> Support Center
            </Badge>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              How can we help?
            </h1>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              Guides, API reference, workflows, and troubleshooting for the ReconIQ reconciliation platform.
            </p>
            <div className="relative mx-auto mt-8 max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search docs, workflows, API…"
                className="h-12 bg-background/80 pl-10 text-base backdrop-blur"
              />
              {results.length > 0 && (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-border bg-popover text-left shadow-xl">
                  {results.map((r) => (
                    <Link key={`${r.categorySlug}-${r.slug}`}
                      to="/support/$category/$article" params={{ category: r.categorySlug, article: r.slug }}
                      onClick={() => setQ("")}
                      className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-muted">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{r.categoryName} · {r.summary}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto flex max-w-7xl gap-8 px-6 py-10">
        {/* SIDEBAR — categories */}
        {!isLanding && (
          <aside className="sticky top-24 hidden h-[calc(100vh-8rem)] w-60 shrink-0 overflow-y-auto md:block">
            <nav className="space-y-6">
              {SUPPORT_CATEGORIES.map((c) => {
                const Icon = ICON_MAP[c.icon] ?? BookOpen;
                const active = pathname.startsWith(`/support/${c.slug}`);
                return (
                  <div key={c.slug}>
                    <Link to="/support/$category" params={{ category: c.slug }}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition ${
                        active ? "text-primary" : "text-foreground hover:text-primary"
                      }`}>
                      <Icon className="h-4 w-4" /> {c.name}
                    </Link>
                    {active && (
                      <div className="mt-1 ml-6 space-y-0.5 border-l border-border/60 pl-3">
                        {c.articles.map((a) => (
                          <Link key={a.slug} to="/support/$category/$article"
                            params={{ category: c.slug, article: a.slug }}
                            className="block rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                            activeProps={{ className: "text-primary" }}>
                            {a.title}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </aside>
        )}

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      <footer className="border-t border-border/60 bg-background/60">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground sm:flex-row">
          <div>© {new Date().getFullYear()} ReconIQ. All rights reserved.</div>
          <div className="flex gap-4">
            <a href="/status" className="hover:text-foreground">System status</a>
            <a href="/security" className="hover:text-foreground">Security</a>
            <a href="mailto:support@reconiq.example" className="hover:text-foreground">support@reconiq.example</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
