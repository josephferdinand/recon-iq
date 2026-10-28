import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, FileText, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  loadDocMarkdown,
  docExists,
  findCategoryForSlug,
  findEntry,
  entryAvailableIn,
  resolveSourceSlug,
  DOC_VERSIONS,
  DOC_VERSION_META,
  DEFAULT_DOC_VERSION,
  LATEST_DOC_VERSION,
  type DocVersion,
} from "@/lib/docs-registry";

const docsSearch = z.object({
  v: fallback(z.enum(DOC_VERSIONS), DEFAULT_DOC_VERSION).default(DEFAULT_DOC_VERSION),
});

export const Route = createFileRoute("/_authenticated/docs/$")({
  ssr: false,
  validateSearch: zodValidator(docsSearch),
  head: ({ params }) => {
    const slug = (params as { _splat?: string })._splat ?? "";
    const entry = findEntry(slug);
    const title = entry?.title ?? slug.split("/").pop() ?? "Doc";
    return {
      meta: [
        { title: `${title} — Docs` },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  loader: ({ params }) => {
    const slug = (params as { _splat?: string })._splat ?? "";
    if (!slug || !docExists(slug)) throw notFound();
    return { slug };
  },
  notFoundComponent: DocNotFound,
  errorComponent: ({ error, reset }) => (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="font-medium">Failed to load doc</p>
      <p className="text-muted-foreground">{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={reset}>Retry</Button>
    </div>
  ),
  component: DocViewer,
});

function DocViewer() {
  const { slug } = Route.useLoaderData() as { slug: string };
  const search = Route.useSearch() as { v: DocVersion };
  const v: DocVersion = search.v ?? DEFAULT_DOC_VERSION;
  const navigate = useNavigate();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cat = findCategoryForSlug(slug);
  const entry = findEntry(slug);
  const title = entry?.title ?? slug.split("/").pop() ?? slug;
  const availableInVersion = entry ? entryAvailableIn(entry, v) : true;
  const sourceSlug = entry ? resolveSourceSlug(entry, v) : slug;
  const versionMeta = DOC_VERSION_META[v];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    loadDocMarkdown(sourceSlug).then((md) => {
      if (!cancelled) {
        setContent(md ?? "");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sourceSlug]);

  return (
    <article className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/docs" search={{ v }} className="hover:text-foreground">
          <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />Docs
        </Link>
        {cat && (
          <>
            <span>/</span>
            <span>{cat.title}</span>
          </>
        )}
        <span>/</span>
        <span className="font-mono text-xs">{sourceSlug}.md</span>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {cat && <Badge variant="outline">{cat.title}</Badge>}
        <Badge
          variant={versionMeta.status === "latest" ? "default" : "secondary"}
          className="ml-auto"
        >
          {versionMeta.label}
        </Badge>
      </div>

      {!availableInVersion && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-foreground">
              This document is not part of the {versionMeta.label} release.
            </p>
            <p className="mt-0.5 text-muted-foreground">
              You are viewing the source content, but it applies to a different version.
            </p>
            {v !== LATEST_DOC_VERSION && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() =>
                  navigate({ to: ".", search: { v: LATEST_DOC_VERSION }, replace: true })
                }
              >
                Switch to {DOC_VERSION_META[LATEST_DOC_VERSION].label}
              </Button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-4 w-1/2 rounded bg-muted" />
        </div>
      ) : content ? (
        <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-pre:bg-muted prose-code:before:content-none prose-code:after:content-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-muted-foreground">Doc is empty.</p>
      )}
    </article>
  );
}

function DocNotFound() {
  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold">Doc not found</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        That path does not resolve to a bundled markdown file under <code>/docs</code>.
      </p>
      <Button asChild size="sm" className="mt-3">
        <Link to="/docs">Back to hub</Link>
      </Button>
    </div>
  );
}
