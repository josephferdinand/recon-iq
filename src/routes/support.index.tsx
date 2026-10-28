import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Rocket, BookOpen, GitBranch, ShieldCheck, Code, FileText, Wrench, HelpCircle, MessageCircle } from "lucide-react";

const ICON_MAP: Record<string, typeof Rocket> = {
  rocket: Rocket, "book-open": BookOpen, "git-branch": GitBranch,
  "shield-check": ShieldCheck, code: Code, "file-text": FileText,
  wrench: Wrench, "help-circle": HelpCircle, "message-circle": MessageCircle,
};

export const Route = createFileRoute("/support/")({
  head: () => ({
    meta: [
      { title: "ReconIQ Support Center | Docs, Guides, API" },
      { name: "description", content: "Documentation, workflows, API reference, and troubleshooting for the ReconIQ reconciliation platform." },
      { property: "og:title", content: "ReconIQ Support Center" },
      { property: "og:description", content: "Documentation, workflows, API reference, and troubleshooting for the ReconIQ reconciliation platform." },
      { property: "og:url", content: "https://reconintelligence.app/support" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/support" }],
  }),
  loader: async () => {
    const { getSupportCategories } = await import("@/content/support-toc");
    return { categories: getSupportCategories() };
  },
  component: SupportIndex,
});

function SupportIndex() {
  const { categories } = Route.useLoaderData();
  return (
    <div className="space-y-12">
      <section>
        <div className="mb-5">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-[#f5f5f7]">Browse categories</h2>
          <p className="mt-1 text-sm text-[#a1a1a6]">Pick a topic to dive in, or use search above.</p>
        </div>
        {categories.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#161617] p-6">
            <h3 className="font-display text-base font-semibold text-[#f5f5f7]">Nothing To Display Yet</h3>
            <p className="mt-1 text-sm text-[#a1a1a6]">
              No support categories are available right now. Try again shortly, or submit a ticket below.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => {
              const Icon = ICON_MAP[c.icon] ?? BookOpen;
              return (
                <Link key={c.slug} to="/support/$category" params={{ category: c.slug }}
                  className="group rounded-2xl border border-white/10 bg-[#161617] p-5 transition-colors hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2997ff]">
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-[#a1a1a6]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="font-display text-base font-semibold text-[#f5f5f7]">{c.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-[#a1a1a6]">{c.description}</p>
                  <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">
                    {c.articles.length} article{c.articles.length !== 1 ? "s" : ""}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#2997ff]">
                    Explore <ArrowRight className="h-3 w-3" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#161617] p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#f5f5f7]">Still need help?</h3>
            <p className="mt-1 text-sm text-[#a1a1a6]">Send us the details and we’ll take a look.</p>
          </div>
          <Link to="/support/$category/$article" params={{ category: "contact", article: "submit-ticket" }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2997ff]">
            Submit a ticket <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
