import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listArticleSteps, signKbScreenshots } from "@/lib/kb-templates.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ImageIcon, ZoomIn, ZoomOut, Maximize2, RotateCcw, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Callout = { x: number; y: number; w: number; h: number; number: number; label: string };
type Step = {
  id: string; step_number: number; title: string; body_md: string | null;
  screenshot_url: string | null; callouts: Callout[] | null;
};

function thumbPathFor(path: string): string {
  return path.replace(/(\.[^.]+)?$/, ".thumb.jpg");
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;

export function KbArticleReader({ articleId }: { articleId: string }) {
  const listFn = useServerFn(listArticleSteps);
  const signFn = useServerFn(signKbScreenshots);

  const stepsQ = useQuery({
    queryKey: ["kb-steps-read", articleId],
    queryFn: () => listFn({ data: { article_id: articleId } }) as Promise<Step[]>,
  });

  const steps = useMemo(
    () => (stepsQ.data ?? []).slice().sort((a, b) => a.step_number - b.step_number),
    [stepsQ.data],
  );
  const paths = useMemo(() => {
    const out: string[] = [];
    for (const s of steps) {
      if (s.screenshot_url) {
        out.push(s.screenshot_url);
        out.push(thumbPathFor(s.screenshot_url));
      }
    }
    return out;
  }, [steps]);
  const signedQ = useQuery({
    queryKey: ["kb-steps-read-signed", articleId, paths.join(",")],
    queryFn: () => signFn({ data: { paths } }) as Promise<Record<string, string>>,
    enabled: paths.length > 0,
  });

  const [viewerStepId, setViewerStepId] = useState<string | null>(null);
  const openViewer = useCallback((id: string) => setViewerStepId(id), []);
  const closeViewer = useCallback(() => setViewerStepId(null), []);

  if (stepsQ.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">This article has no annotated steps yet.</p>;

  return (
    <div className="space-y-6">
      {/* Quick-scan thumbnail strip */}
      <nav aria-label="Step overview" className="rounded-lg border bg-card p-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">Steps at a glance</p>
        <ol className="flex flex-wrap gap-3">
          {steps.map((s) => {
            const thumb = s.screenshot_url
              ? signedQ.data?.[thumbPathFor(s.screenshot_url)] ?? signedQ.data?.[s.screenshot_url]
              : undefined;
            return (
              <li key={s.id}>
                <a
                  href={`#kb-step-${s.step_number}`}
                  className="flex w-32 flex-col gap-1 rounded-md border bg-background p-1.5 transition-colors hover:border-primary"
                >
                  <div className="relative h-16 w-full overflow-hidden rounded bg-muted grid place-items-center">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                    <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold grid place-items-center shadow">
                      {s.step_number}
                    </span>
                  </div>
                  <span className="line-clamp-2 text-xs text-foreground/90">{s.title}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      {steps.map((s) => {
        const url = s.screenshot_url ? signedQ.data?.[s.screenshot_url] : undefined;
        const callouts = (s.callouts ?? []).slice().sort((a, b) => a.number - b.number);
        return (
          <Card key={s.id} id={`kb-step-${s.step_number}`} className="scroll-mt-4 overflow-hidden">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0 border-b bg-gradient-to-r from-primary/5 via-background to-background py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-base font-bold shadow-sm">
                {s.step_number}
              </div>
              <div className="flex-1 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">
                  Step {s.step_number}
                </div>
                <CardTitle className="font-display text-lg font-semibold tracking-tight">{s.title}</CardTitle>
              </div>
              <Badge variant="outline" className="hidden sm:inline-flex h-5 px-2 text-[10px]">
                {s.step_number} / {steps.length}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              {s.body_md && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{s.body_md}</p>
              )}
              {url && (
                <div className="group relative w-full overflow-hidden rounded-md border bg-muted">
                  <button
                    type="button"
                    onClick={() => openViewer(s.id)}
                    aria-label={`Open full-size screenshot for step ${s.step_number}`}
                    className="block w-full cursor-zoom-in"
                  >
                    <img src={url} alt={`Step ${s.step_number}: ${s.title}`} className="block w-full h-auto" />
                    {callouts.map((c) => (
                      <span
                        key={c.number}
                        className="absolute border-2 border-primary bg-primary/10 rounded-sm pointer-events-none"
                        style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                      >
                        <span className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold grid place-items-center shadow">
                          {c.number}
                        </span>
                      </span>
                    ))}
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-[10px] font-medium text-foreground shadow-sm opacity-0 transition-opacity group-hover:opacity-100">
                      <Maximize2 className="h-3 w-3" /> View full size
                    </span>
                  </button>
                </div>
              )}
              {callouts.length > 0 && (
                <ol className="space-y-1.5 text-sm">
                  {callouts.map((c) => (
                    <li key={c.number} className="flex gap-2">
                      <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-semibold shrink-0">
                        {c.number}
                      </span>
                      <span className="text-foreground/90">{c.label}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        );
      })}

      <StepViewer
        open={viewerStepId !== null}
        onOpenChange={(v) => { if (!v) closeViewer(); }}
        steps={steps}
        activeId={viewerStepId}
        setActiveId={setViewerStepId}
        signed={signedQ.data ?? {}}
      />
    </div>
  );
}

function StepViewer({
  open, onOpenChange, steps, activeId, setActiveId, signed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  steps: Step[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  signed: Record<string, string>;
}) {
  const activeIndex = Math.max(0, steps.findIndex((s) => s.id === activeId));
  const active = steps[activeIndex];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // Reset transform whenever the active step changes or modal opens
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [activeId, open]);

  const go = useCallback((delta: number) => {
    const next = steps[activeIndex + delta];
    if (next) setActiveId(next.id);
  }, [activeIndex, steps, setActiveId]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))); }
      else if (e.key === "0") { e.preventDefault(); setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return; // only zoom with modifier so vertical scroll still works
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z + delta).toFixed(2))));
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
  }, [zoom, pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  }, []);

  const endDrag = useCallback(() => { dragRef.current = null; }, []);

  if (!active) return null;

  const url = active.screenshot_url ? signed[active.screenshot_url] : undefined;
  const callouts = (active.callouts ?? []).slice().sort((a, b) => a.number - b.number);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 gap-0 max-w-[96vw] w-[96vw] h-[92vh] sm:max-w-[96vw] overflow-hidden flex flex-col"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          Step {active.step_number}: {active.title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Full-size screenshot viewer. Use arrow keys to navigate steps, plus and minus to zoom, 0 to reset.
        </DialogDescription>

        {/* Header */}
        <div className="flex items-center gap-3 border-b bg-background px-4 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            {active.step_number}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">
              Step {active.step_number} of {steps.length}
            </div>
            <div className="truncate font-display text-sm font-semibold">{active.title}</div>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))} aria-label="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))} aria-label="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Reset zoom">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <div className="mx-1 h-5 w-px bg-border" />
            <Button variant="ghost" size="icon" onClick={() => go(-1)} disabled={activeIndex === 0} aria-label="Previous step">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => go(1)} disabled={activeIndex === steps.length - 1} aria-label="Next step">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close viewer">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body: sidebar + stage */}
        <div className="flex flex-1 min-h-0">
          {/* Thumbnail sidebar */}
          <aside className="w-44 shrink-0 border-r bg-muted/30 overflow-y-auto p-2 space-y-1.5" aria-label="Step navigator">
            {steps.map((s) => {
              const thumb = s.screenshot_url
                ? signed[thumbPathFor(s.screenshot_url)] ?? signed[s.screenshot_url]
                : undefined;
              const isActive = s.id === active.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  className={cn(
                    "group flex w-full gap-2 rounded-md border p-1.5 text-left transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "border-border bg-background hover:border-primary/50",
                  )}
                  aria-current={isActive ? "true" : undefined}
                >
                  <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-muted grid place-items-center">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold grid place-items-center shadow">
                      {s.step_number}
                    </span>
                  </div>
                  <span className="min-w-0 flex-1 self-center text-xs leading-snug line-clamp-2 text-foreground/90">
                    {s.title}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* Stage */}
          <div
            ref={stageRef}
            className="relative flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,hsl(var(--muted))_0%,hsl(var(--background))_100%)]"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            style={{ cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "default" }}
          >
            {url ? (
              <div
                className="absolute inset-0 grid place-items-center select-none"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: dragRef.current ? "none" : "transform 120ms ease-out",
                }}
              >
                <div className="relative">
                  <img
                    src={url}
                    alt={`Step ${active.step_number}: ${active.title}`}
                    draggable={false}
                    className="block max-h-[82vh] max-w-[78vw] object-contain rounded shadow-xl"
                  />
                  {callouts.map((c) => (
                    <span
                      key={c.number}
                      className="absolute border-2 border-primary bg-primary/10 rounded-sm pointer-events-none"
                      style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                    >
                      <span className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold grid place-items-center shadow">
                        {c.number}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                No screenshot for this step.
              </div>
            )}

            {/* Keyboard hint */}
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-background/80 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
              ← / → steps · ⌘/Ctrl + scroll to zoom · 0 to reset
            </div>
          </div>
        </div>

        {/* Callout legend footer */}
        {callouts.length > 0 && (
          <div className="border-t bg-background px-4 py-2 max-h-28 overflow-y-auto">
            <ol className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {callouts.map((c) => (
                <li key={c.number} className="flex items-center gap-1.5">
                  <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold shrink-0">
                    {c.number}
                  </span>
                  <span className="text-foreground/90">{c.label}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
