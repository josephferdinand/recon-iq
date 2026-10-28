import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { Article } from "@/content/support-toc";
import { Clock, ArrowRight, ArrowLeft } from "lucide-react";

// LL-016 follow-up: dynamic-import the data helpers to keep support-toc.ts off
// the cyclic edge between router chunks (see support.$category.$article.tsx).
export const Route = createFileRoute("/support/$category/")({
  loader: async ({ params }) => {
    const { getCategoryBySlug } = await import("@/content/support-toc");
    const cat = getCategoryBySlug(params.category);
    if (!cat) throw notFound();
    return { category: cat };
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [
      { title: `${loaderData.category.name} | ReconIQ Support` },
      { name: "description", content: loaderData.category.description },
      { property: "og:title", content: `${loaderData.category.name} | ReconIQ Support` },
      { property: "og:description", content: loaderData.category.description },
    ] : [{ title: "Not found | ReconIQ Support" }, { name: "robots", content: "noindex" }],
  }),
  errorComponent: () => <div className="text-sm text-muted-foreground">Failed to load category.</div>,
  notFoundComponent: () => (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <p className="text-sm text-muted-foreground">Category not found.</p>
      <Link to="/support" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Support
      </Link>
    </div>
  ),
  component: CategoryPage,
});

function CategoryPage() {
  const { category } = Route.useLoaderData();

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/support" className="hover:text-foreground">Support</Link>
        <span>/</span>
        <span className="text-foreground">{category.name}</span>
      </nav>

      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{category.name}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">{category.description}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {category.articles.map((a: Article) => (
          <Link key={a.slug} to="/support/$category/$article"
            params={{ category: category.slug, article: a.slug }}
            className="group rounded-xl border border-border/60 bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-base font-semibold group-hover:text-primary">{a.title}</div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.summary}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
            </div>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {a.readTime} min read</span>
              {a.tags.slice(0, 3).map((t: string) => (
                <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{t}</span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
