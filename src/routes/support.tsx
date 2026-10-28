import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { Category } from "@/content/support-toc";
import { Input } from "@/components/ui/input";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
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
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-6">
          <Link to="/support" className="flex items-center gap-2">
            <FviApprovedLogo className="h-11 w-11 rounded-sm" />
            <div className="hidden sm:block">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">ReconIQ</div>
              <div className="-mt-0.5 font-display text-sm font-semibold">Support Center</div>
            </div>
          </Link>
          <nav aria-label="Support" className="ml-4 hidden items-center gap-1 md:flex">
            {SUPPORT_CATEGORIES.slice(0, 5).map((c) => (
              <Link key={c.slug} to="/support/$category" params={{ category: c.slug }}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[#a1a1a6] hover:bg-white/10 hover:text-white"
                activeProps={{ className: "bg-white/10 text-white" }}>
                {c.name}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href={appUrl("/auth")} className="hidden items-center gap-1 rounded-md border border-white/20 px-2.5 py-1.5 text-xs font-medium text-[#f5f5f7] hover:bg-white/10 sm:inline-flex">
              Go to app <ExternalLink className="h-3 w-3" />
            </a>
            <Link to="/support/$category/$article" params={{ category: "contact", article: "submit-ticket" }}
              className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-black hover:bg-white/85">
              Submit ticket
            </Link>
          </div>
        </div>
      </header>

      {/* HERO SEARCH — only on landing */}
      {isLanding && (
        <section className="border-b border-white/10">
          <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-20">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#86868b]">Support Center</p>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              How can we help?
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[#a1a1a6] md:text-base">
              Guides, API reference, workflows, and troubleshooting for the ReconIQ reconciliation platform.
            </p>
            <div className="relative mx-auto mt-8 max-w-xl text-left">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#86868b]" />
              <Input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search docs, workflows, API…"
                aria-label="Search support articles"
                className="h-12 rounded-xl border-white/15 bg-[#161617] pl-10 text-base text-[#f5f5f7] placeholder:text-[#86868b] focus-visible:ring-2 focus-visible:ring-[#2997ff]"
              />
              {q.trim() && results.length === 0 && (
                <p className="mt-3 text-center text-sm text-[#86868b]" role="status">
                  Nothing to display yet — try different words, or browse the categories below.
                </p>
              )}
              {results.length > 0 && (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-[#1c1c1f] text-left shadow-xl">
                  {results.map((r) => (
                    <Link key={`${r.categorySlug}-${r.slug}`}
                      to="/support/$category/$article" params={{ category: r.categorySlug, article: r.slug }}
                      onClick={() => setQ("")}
                      className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 last:border-b-0 hover:bg-white/5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[#f5f5f7]">{r.title}</div>
                        <div className="truncate text-xs text-[#86868b]">{r.categoryName} · {r.summary}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[#86868b]" />
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
                        active ? "text-white" : "text-[#a1a1a6] hover:text-white"
                      }`}>
                      <Icon className="h-4 w-4" /> {c.name}
                    </Link>
                    {active && (
                      <div className="ml-6 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                        {c.articles.map((a) => (
                          <Link key={a.slug} to="/support/$category/$article"
                            params={{ category: c.slug, article: a.slug }}
                            className="block rounded px-2 py-1 text-xs text-[#86868b] hover:text-white"
                            activeProps={{ className: "text-[#2997ff]" }}>
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
