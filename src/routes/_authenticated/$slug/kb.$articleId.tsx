import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { getKbArticle } from "@/lib/kb.functions";
import { KbArticleReader } from "@/components/kb-article-reader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/$slug/kb/$articleId")({
  component: KbArticlePage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">Failed to load article: {error instanceof Error ? error.message : "An unexpected error occurred."}</div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Article not found.</div>
  ),
});

function KbArticlePage() {
  const { slug, articleId } = Route.useParams();
  const fetchFn = useServerFn(getKbArticle);
  const q = useQuery({
    queryKey: ["kb-article", articleId],
    queryFn: () => fetchFn({ data: { id: articleId } }),
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$slug/workspace" params={{ slug }}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to workspace
          </Link>
        </Button>
        {q.data?.status && (
          <Badge variant={q.data.status === "published" ? "default" : "secondary"}>
            {q.data.status}
          </Badge>
        )}
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading article…</p>}

      {q.data && (
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{q.data.title}</h1>
          {q.data.summary && (
            <p className="text-sm text-muted-foreground">{q.data.summary}</p>
          )}
          {q.data.body_md && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {q.data.body_md}
            </p>
          )}
        </header>
      )}

      <KbArticleReader articleId={articleId} />
    </div>
  );
}
