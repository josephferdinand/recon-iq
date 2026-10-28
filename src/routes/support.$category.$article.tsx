import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { Article, ArticleSection } from "@/content/support-toc";
import { ArrowLeft, ArrowRight, Clock, Info, AlertTriangle, Lightbulb } from "lucide-react";

// LL-016 follow-up: dynamic-import the data helpers instead of static-importing
// them. A static import ties support-toc.ts into the chunk that holds this
// route's __esmMin body, which (because support-toc.ts is on the cyclic edge
// between router-I4kL2xdR.mjs and router-I4kL2xdR2.mjs) crashes with
// "init_support_toc is not a function" before route registration completes.
// The loader is server-side and async, so the dynamic await is free.
async function loadSupportData(categorySlug: string, articleSlug: string) {
  const { getArticleBySlug, getCategoryBySlug } = await import("@/content/support-toc");
  const cat = getCategoryBySlug(categorySlug);
  const art = getArticleBySlug(categorySlug, articleSlug);
  return { cat, art };
}

export const Route = createFileRoute("/support/$category/$article")({
  loader: async ({ params }) => {
    const { cat, art } = await loadSupportData(params.category, params.article);
    if (!cat || !art) throw notFound();
    return { category: cat, article: art };
  },
  head: ({ loaderData, params }) => ({
    meta: loaderData ? [
      { title: loaderData.article.seoTitle },
      { name: "description", content: loaderData.article.seoDescription },
      { name: "keywords", content: loaderData.article.tags.join(", ") },
      { property: "og:title", content: loaderData.article.seoTitle },
      { property: "og:description", content: loaderData.article.seoDescription },
      { property: "og:type", content: "article" },
      { property: "og:url", content: `https://support-fvi.reconiq.example/support/${params.category}/${params.article}` },
    ] : [{ title: "Not found | ReconIQ Support" }, { name: "robots", content: "noindex" }],
    links: loaderData ? [{ rel: "canonical", href: `https://support-fvi.reconiq.example/support/${params.category}/${params.article}` }] : [],
    scripts: loaderData ? [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: loaderData.article.title,
        description: loaderData.article.summary,
        keywords: loaderData.article.tags.join(", "),
      }),
    }] : [],
  }),
  errorComponent: () => <div className="text-sm text-muted-foreground">Failed to load article.</div>,
  notFoundComponent: () => (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <p className="text-sm text-muted-foreground">Article not found.</p>
      <Link to="/support" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Support
      </Link>
    </div>
  ),
  component: ArticlePage,
});

function ArticlePage() {
  const { category, article } = Route.useLoaderData();
  const idx = category.articles.findIndex((a: Article) => a.slug === article.slug);
  const prev = idx > 0 ? category.articles[idx - 1] : null;
  const next = idx < category.articles.length - 1 ? category.articles[idx + 1] : null;

  return (
    <article className="max-w-3xl">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/support" className="hover:text-foreground">Support</Link>
        <span>/</span>
        <Link to="/support/$category" params={{ category: category.slug }} className="hover:text-foreground">{category.name}</Link>
        <span>/</span>
        <span className="truncate text-foreground">{article.title}</span>
      </nav>

      <header className="mt-4 border-b border-border/60 pb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{article.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground md:text-base">{article.summary}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {article.readTime} min read</span>
          {article.tags.map((t: string) => (
            <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{t}</span>
          ))}
        </div>
      </header>

      <div className="prose prose-sm mt-8 max-w-none dark:prose-invert">
        {article.sections.map((s: ArticleSection, i: number) => (
          <section key={i} className="mb-6">
            {s.heading && <h2 className="font-display text-xl font-semibold tracking-tight">{s.heading}</h2>}
            <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{s.body}</p>
            {s.steps && (
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
                {s.steps.map((step: string, j: number) => <li key={j}>{step}</li>)}
              </ol>
            )}
            {s.code && (
              <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs">
                <code>{s.code.code}</code>
              </pre>
            )}
            {s.callout && <Callout type={s.callout.type} text={s.callout.text} />}
          </section>
        ))}
      </div>

      {article.faq && article.faq.length > 0 && (
        <section className="mt-10 border-t border-border/60 pt-8">
          <h2 className="font-display text-xl font-semibold tracking-tight">Frequently asked questions</h2>
          <div className="mt-4 space-y-4">
            {article.faq.map((item: { q: string; a: string }, i: number) => (
              <div key={i} className="rounded-lg border border-border/60 bg-card p-4">
                <div className="font-medium">{item.q}</div>
                <p className="mt-1 text-sm text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <nav className="mt-10 grid grid-cols-2 gap-3 border-t border-border/60 pt-6">
        {prev ? (
          <Link to="/support/$category/$article" params={{ category: category.slug, article: prev.slug }}
            className="group rounded-lg border border-border/60 bg-card p-3 hover:border-primary/40">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Previous</div>
            <div className="mt-0.5 flex items-center gap-1 text-sm font-medium group-hover:text-primary">
              <ArrowLeft className="h-3.5 w-3.5" /> {prev.title}
            </div>
          </Link>
        ) : <div />}
        {next ? (
          <Link to="/support/$category/$article" params={{ category: category.slug, article: next.slug }}
            className="group rounded-lg border border-border/60 bg-card p-3 text-right hover:border-primary/40">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Next</div>
            <div className="mt-0.5 flex items-center justify-end gap-1 text-sm font-medium group-hover:text-primary">
              {next.title} <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>
        ) : <div />}
      </nav>
    </article>
  );
}

function Callout({ type, text }: { type: "info" | "warning" | "tip"; text: string }) {
  const config = {
    info: { Icon: Info, cls: "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300" },
    warning: { Icon: AlertTriangle, cls: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300" },
    tip: { Icon: Lightbulb, cls: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" },
  }[type];
  const { Icon, cls } = config;
  return (
    <div className={`mt-3 flex gap-2 rounded-lg border p-3 text-sm ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{text}</div>
    </div>
  );
}
