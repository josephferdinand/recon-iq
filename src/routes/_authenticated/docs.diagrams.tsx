import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, ExternalLink, Search, FileCode, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DIAGRAMS, loadDiagramSource, type DiagramEntry } from "@/lib/diagrams-registry";

export const Route = createFileRoute("/_authenticated/docs/diagrams")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Architecture diagrams — Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DiagramGallery,
});

function DiagramGallery() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<DiagramEntry | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return DIAGRAMS;
    return DIAGRAMS.filter(
      (d) => d.id.toLowerCase().includes(needle) || d.title.toLowerCase().includes(needle),
    );
  }, [q]);

  async function openDiagram(d: DiagramEntry) {
    setSelected(d);
    setSource(null);
    const src = await loadDiagramSource(d.id);
    setSource(src);
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link to="/docs" className="hover:text-foreground">
            <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />Docs
          </Link>
          <span>/</span>
          <span>Diagrams</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Architecture diagrams</h1>
          <Badge variant="outline">{DIAGRAMS.length} rendered</Badge>
          <Badge variant="secondary" className="gap-1">
            auto-render on main
          </Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every SVG below is generated from a Mermaid source under{" "}
          <code>docs/diagrams/*.mmd</code>. Auto-rendered on merge to <code>main</code>,
          verified on every build by the checksum manifest.
        </p>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter diagrams…"
          className="pl-8"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No diagrams match “{q}”.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => openDiagram(d)}
              className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left transition hover:border-primary hover:shadow-md"
            >
              <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted p-2">
                <img
                  src={d.svgUrl}
                  alt={d.title}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain transition group-hover:scale-[1.02]"
                />
              </div>
              <div className="border-t p-3">
                <p className="line-clamp-1 font-medium">{d.title}</p>
                <p className="line-clamp-1 font-mono text-xs text-muted-foreground">
                  {d.id}.mmd
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {selected?.title}
              <Badge variant="outline" className="font-mono text-xs">
                {selected?.id}.mmd
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-center rounded-lg border bg-muted p-4">
                <img src={selected.svgUrl} alt={selected.title} className="max-h-[60vh] max-w-full" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={selected.svgUrl} download={`${selected.id}.svg`}>
                    <Download className="mr-1 h-4 w-4" />SVG
                  </a>
                </Button>
                {selected.pngUrl && (
                  <Button asChild size="sm" variant="outline">
                    <a href={selected.pngUrl} download={`${selected.id}.png`}>
                      <Download className="mr-1 h-4 w-4" />PNG
                    </a>
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost">
                  <a href={selected.svgUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 h-4 w-4" />Open
                  </a>
                </Button>
              </div>

              <details className="rounded-lg border bg-muted/30 p-3 text-sm">
                <summary className="flex cursor-pointer items-center gap-2 font-medium">
                  <FileCode className="h-4 w-4" />
                  Mermaid source
                </summary>
                <pre className="mt-3 max-h-72 overflow-auto rounded bg-background p-3 text-xs">
                  <code>{source ?? "Loading…"}</code>
                </pre>
              </details>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
