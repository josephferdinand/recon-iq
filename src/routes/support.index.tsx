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
    ],
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
    <div className="space-y-10">
      <section>
        <div className="mb-4">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Browse categories</h2>
          <p className="text-sm text-muted-foreground">Pick a topic to dive in, or use search above.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => {
            const Icon = ICON_MAP[c.icon] ?? BookOpen;
            return (
              <Link key={c.slug} to="/support/$category" params={{ category: c.slug }}
                className="group relative overflow-hidden rounded-xl border border-border/60 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg">
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100" />
                <div className="relative">
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="font-display text-base font-semibold">{c.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.description}</p>
                  <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {c.articles.length} article{c.articles.length !== 1 ? "s" : ""}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Explore <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold">Still need help?</h3>
            <p className="text-sm text-muted-foreground">Our support team responds to P1 tickets within an hour.</p>
          </div>
          <Link to="/support/$category/$article" params={{ category: "contact", article: "submit-ticket" }}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            Submit a ticket <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
