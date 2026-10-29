import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { Category } from "@/content/support-toc";
import { Input } from "@/components/ui/input";
import { RQApprovedLogo } from "@/components/rq-approved-logo";
import { MarketingFooter } from "@/components/marketing-footer";
import { appUrl } from "@/lib/cross-domain";
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
      { property: "og:url", content: "https://reconintelligence.app/support" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/support" }],
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
    <div className="min-h-screen bg-[var(--mkt-bg)] text-[var(--mkt-text)] transition-colors duration-300">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-[var(--mkt-line)] bg-[var(--mkt-header-bg)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-6">
          <Link to="/support" className="flex items-center gap-2">
            <RQApprovedLogo className="h-11 w-11 rounded-sm" />
            <div className="hidden sm:block">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">ReconIQ</div>
              <div className="-mt-0.5 font-display text-sm font-semibold">Support Center</div>
            </div>
          </Link>
          <nav aria-label="Support" className="ml-4 hidden items-center gap-1 md:flex">
            {SUPPORT_CATEGORIES.slice(0, 5).map((c) => (
              <Link key={c.slug} to="/support/$category" params={{ category: c.slug }}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--mkt-text-2)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]"
                activeProps={{ className: "bg-[var(--mkt-surface-2)] text-[var(--mkt-text)]" }}>
                {c.name}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href={appUrl("/auth")} className="hidden items-center gap-1 rounded-md border border-[var(--mkt-line-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--mkt-text)] hover:bg-[var(--mkt-surface-2)] sm:inline-flex">
              Go to app <ExternalLink className="h-3 w-3" />
            </a>
            <Link to="/support/$category/$article" params={{ category: "contact", article: "submit-ticket" }}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--mkt-btn-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--mkt-btn-text)] hover:opacity-85">
              Submit ticket
            </Link>
          </div>
        </div>
      </header>

      {/* HERO SEARCH — only on landing */}
      {isLanding && (
        <section className="border-b border-[var(--mkt-line)]">
          <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-20">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">Support Center</p>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              How can we help?
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[var(--mkt-text-2)] md:text-base">
              Guides, API reference, workflows, and troubleshooting for the ReconIQ reconciliation platform.
            </p>
            <div className="relative mx-auto mt-8 max-w-xl text-left">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mkt-text-3)]" />
              <Input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search docs, workflows, API…"
                aria-label="Search support articles"
                className="h-12 rounded-xl border-[var(--mkt-line)] bg-[var(--mkt-surface)] pl-10 text-base text-[var(--mkt-text)] placeholder:text-[var(--mkt-text-3)] focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
              />
              {q.trim() && results.length === 0 && (
                <p className="mt-3 text-center text-sm text-[var(--mkt-text-3)]" role="status">
                  Nothing to display yet — try different words, or browse the categories below.
                </p>
              )}
              {results.length > 0 && (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] text-left shadow-xl">
                  {results.map((r) => (
                    <Link key={`${r.categorySlug}-${r.slug}`}
                      to="/support/$category/$article" params={{ category: r.categorySlug, article: r.slug }}
                      onClick={() => setQ("")}
                      className="flex items-center justify-between gap-3 border-b border-[var(--mkt-line)] px-4 py-3 last:border-b-0 hover:bg-[var(--mkt-surface-2)]">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--mkt-text)]">{r.title}</div>
                        <div className="truncate text-xs text-[var(--mkt-text-3)]">{r.categoryName} · {r.summary}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[var(--mkt-text-3)]" />
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
            <nav className="space-y-6" aria-label="Support categories">
              {SUPPORT_CATEGORIES.map((c) => {
                const Icon = ICON_MAP[c.icon] ?? BookOpen;
                const active = pathname.startsWith(`/support/${c.slug}`);
                return (
                  <div key={c.slug}>
                    <Link to="/support/$category" params={{ category: c.slug }}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition ${
                        active ? "text-[var(--mkt-text)]" : "text-[var(--mkt-text-2)] hover:text-[var(--mkt-text)]"
                      }`}>
                      <Icon className="h-4 w-4" /> {c.name}
                    </Link>
                    {active && (
                      <div className="ml-6 mt-1 space-y-0.5 border-l border-[var(--mkt-line)] pl-3">
                        {c.articles.map((a) => (
                          <Link key={a.slug} to="/support/$category/$article"
                            params={{ category: c.slug, article: a.slug }}
                            className="block rounded px-2 py-1 text-xs text-[var(--mkt-text-3)] hover:text-[var(--mkt-text)]"
                            activeProps={{ className: "text-[var(--mkt-accent)]" }}>
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

      <MarketingFooter />
    </div>
  );
}
