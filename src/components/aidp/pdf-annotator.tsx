import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  signAidpStoragePath,
  registerAidpPage,
  finalizeAidpRender,
  listAidpPages,
  listAidpEntityTypes,
  listAidpAnnotations,
  createAidpAnnotation,
  deleteAidpAnnotation,
} from "@/lib/aidp.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Upload, ZoomIn, ZoomOut, Layers } from "lucide-react";
import { toast } from "sonner";

// pdfjs-dist v6 ESM with bundled worker URL
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl as string;

const REVIEW_DPI = 200;
const INFERENCE_DPI = 150;
// pdf.js renders at 72 DPI by default; scale = DPI / 72
const dpiScale = (dpi: number) => dpi / 72;

// Stable color per entity type id
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 80% 50%)`;
}

type EntityType = {
  id: string;
  key: string;
  label: string;
  datatype: string;
  review_policy: string;
  confidence_threshold: number;
};

type PageRow = {
  id: string;
  page_index: number;
  width: number;
  height: number;
  image_uri: string;
  signed_url: string | null;
  dpi: number;
};

type Annotation = {
  id: string;
  page_id: string;
  entity_type_id: string;
  bbox: { x: number; y: number; w: number; h: number };
  value: string | null;
  source: string;
};

export function PdfAnnotator({
  tenantId,
  documentId,
  documentTypeId,
  sourcePdfPath,
}: {
  tenantId: string;
  documentId: string;
  documentTypeId: string | null;
  /** Storage path relative to the `aidp` bucket, e.g. `{tenant_id}/{document_id}/source.pdf`. May be null if not uploaded yet. */
  sourcePdfPath: string | null;
}) {
  const qc = useQueryClient();
  const sign = useServerFn(signAidpStoragePath);
  const regPage = useServerFn(registerAidpPage);
  const finalize = useServerFn(finalizeAidpRender);
  const listPages = useServerFn(listAidpPages);
  const listEnts = useServerFn(listAidpEntityTypes);
  const listAnns = useServerFn(listAidpAnnotations);
  const createAnn = useServerFn(createAidpAnnotation);
  const deleteAnn = useServerFn(deleteAidpAnnotation);

  const entQ = useQuery({
    queryKey: ["aidp-entities", documentTypeId],
    queryFn: () => listEnts({ data: { tenant_id: tenantId, document_type_id: documentTypeId! } }),
    enabled: !!documentTypeId,
  });
  const pagesQ = useQuery({
    queryKey: ["aidp-pages", documentId, "review"],
    queryFn: () => listPages({ data: { tenant_id: tenantId, document_id: documentId, purpose: "review" } }),
  });
  const annQ = useQuery({
    queryKey: ["aidp-annotations", documentId],
    queryFn: () => listAnns({ data: { tenant_id: tenantId, document_id: documentId } }),
  });

  const [activeEntity, setActiveEntity] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);

  const entities = (entQ.data ?? []) as EntityType[];
  const pages = (pagesQ.data ?? []) as PageRow[];
  const annotations = (annQ.data ?? []) as unknown as Annotation[];

  useEffect(() => {
    if (!activeEntity && entities.length) setActiveEntity(entities[0].id);
  }, [entities, activeEntity]);

  const annByPage = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    annotations.forEach((a) => {
      const arr = m.get(a.page_id) ?? [];
      arr.push(a);
      m.set(a.page_id, arr);
    });
    return m;
  }, [annotations]);

  const mCreate = useMutation({
    mutationFn: (input: { page_id: string; bbox: Annotation["bbox"] }) =>
      createAnn({
        data: {
          tenant_id: tenantId,
          document_id: documentId,
          page_id: input.page_id,
          entity_type_id: activeEntity!,
          bbox: input.bbox,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aidp-annotations", documentId] }),
    onError: (e: any) => toast.error(e.message),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => deleteAnn({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aidp-annotations", documentId] }),
  });

  /** Renders the PDF in the browser at REVIEW + INFERENCE DPI and uploads PNG bytes to `aidp` storage. */
  async function renderAndUpload() {
    if (!sourcePdfPath) {
      toast.error("Upload the source PDF first.");
      return;
    }
    setRendering(true);
    try {
      const { signed_url } = await sign({
        data: { tenant_id: tenantId, path: sourcePdfPath, mode: "read", expires_in: 900 },
      });
      const pdfRes = await fetch(signed_url);
      const buf = await pdfRes.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      setRenderProgress({ done: 0, total: pdf.numPages });

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        for (const purpose of ["review", "inference"] as const) {
          const dpi = purpose === "review" ? REVIEW_DPI : INFERENCE_DPI;
          const viewport = page.getViewport({ scale: dpiScale(dpi) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d", { alpha: false })!;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          const blob: Blob = await new Promise((resolve) =>
            canvas.toBlob((b) => resolve(b!), "image/png", 0.92),
          );
          const path = `${tenantId}/${documentId}/page-${i - 1}-${purpose}.png`;
          const up = await supabase.storage.from("aidp").upload(path, blob, {
            upsert: true,
            contentType: "image/png",
          });
          if (up.error) throw new Error(up.error.message);
          await regPage({
            data: {
              tenant_id: tenantId,
              document_id: documentId,
              page_index: i - 1,
              width: canvas.width,
              height: canvas.height,
              image_uri: path,
              dpi,
              purpose,
            },
          });
        }
        setRenderProgress({ done: i, total: pdf.numPages });
      }

      await finalize({
        data: { tenant_id: tenantId, document_id: documentId, page_count: pdf.numPages },
      });
      toast.success(`Rendered ${pdf.numPages} page(s) at ${REVIEW_DPI}/${INFERENCE_DPI} DPI`);
      qc.invalidateQueries({ queryKey: ["aidp-pages", documentId, "review"] });
      qc.invalidateQueries({ queryKey: ["aidp-docs", tenantId] });
    } catch (e: any) {
      toast.error(e.message ?? "Render failed");
    } finally {
      setRendering(false);
      setRenderProgress(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      {/* Sidebar */}
      <div className="space-y-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Render</div>
            <Badge variant="outline" className="text-[10px]">
              {REVIEW_DPI}/{INFERENCE_DPI} DPI
            </Badge>
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={renderAndUpload}
            disabled={rendering || !sourcePdfPath}
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            {rendering
              ? renderProgress
                ? `Rendering ${renderProgress.done}/${renderProgress.total}…`
                : "Rendering…"
              : pages.length
                ? "Re-render pages"
                : "Render pages"}
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Pages are rendered in your browser at dual resolution: 200 DPI for review,
            150 DPI for ML inference.
          </p>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Layers className="h-3.5 w-3.5" /> Entity types
            </div>
            <Badge variant="outline" className="text-[10px]">{entities.length}</Badge>
          </div>
          <ScrollArea className="h-64">
            <div className="space-y-1 px-2 pb-2">
              {entities.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No entity types defined for this document type.
                </div>
              ) : null}
              {entities.map((e) => {
                const c = colorFor(e.id);
                const active = activeEntity === e.id;
                const count = annotations.filter((a) => a.entity_type_id === e.id).length;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setActiveEntity(e.id)}
                    className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs transition ${
                      active ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-3 w-3 rounded-sm"
                        style={{ background: c, boxShadow: `0 0 0 1px ${c} inset` }}
                      />
                      <div>
                        <div className="font-medium">{e.label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {e.datatype} · {e.review_policy.replace(/_/g, " ")}
                        </div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{count}</Badge>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex items-center gap-2 rounded-lg border bg-card p-2">
          <Button aria-label="Zoom out" size="icon" variant="ghost" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <div className="flex-1 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</div>
          <Button aria-label="Zoom in" size="icon" variant="ghost" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="space-y-6">
        {pagesQ.isLoading ? <Skeleton className="h-96 w-full" /> : null}
        {!pagesQ.isLoading && pages.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-6 py-16 text-center text-sm text-muted-foreground">
            No rendered pages yet. Render the PDF to start annotating.
          </div>
        ) : null}
        {pages.map((p) => (
          <PageCanvas
            key={p.id}
            page={p}
            zoom={zoom}
            annotations={annByPage.get(p.id) ?? []}
            entities={entities}
            activeEntity={activeEntity}
            onCreate={(bbox) => activeEntity && mCreate.mutate({ page_id: p.id, bbox })}
            onDelete={(id) => mDelete.mutate(id)}
          />
        ))}
      </div>
    </div>
  );
}

function PageCanvas({
  page,
  zoom,
  annotations,
  entities,
  activeEntity,
  onCreate,
  onDelete,
}: {
  page: PageRow;
  zoom: number;
  annotations: Annotation[];
  entities: EntityType[];
  activeEntity: string | null;
  onCreate: (bbox: Annotation["bbox"]) => void;
  onDelete: (id: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const entityById = useMemo(
    () => new Map(entities.map((e) => [e.id, e])),
    [entities],
  );

  // Aspect ratio preserved using page dimensions; width is responsive via zoom * 800px target.
  const baseWidth = 820;
  const renderWidth = baseWidth * zoom;
  const renderHeight = (page.height / page.width) * renderWidth;

  function clientToFraction(clientX: number, clientY: number) {
    const r = wrapperRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground">
          Page {page.page_index + 1} · {page.width}×{page.height}px @ {page.dpi} DPI
        </div>
        <Badge variant="outline" className="text-[10px]">{annotations.length} boxes</Badge>
      </div>
      <div
        ref={wrapperRef}
        className="relative mx-auto select-none overflow-hidden rounded border bg-background"
        style={{ width: renderWidth, height: renderHeight, cursor: activeEntity ? "crosshair" : "not-allowed" }}
        onPointerDown={(e) => {
          if (!activeEntity || e.button !== 0) return;
          (e.target as Element).setPointerCapture(e.pointerId);
          const p = clientToFraction(e.clientX, e.clientY);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = clientToFraction(e.clientX, e.clientY);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (!drag) return;
          const x = Math.min(drag.x0, drag.x1);
          const y = Math.min(drag.y0, drag.y1);
          const w = Math.abs(drag.x1 - drag.x0);
          const h = Math.abs(drag.y1 - drag.y0);
          setDrag(null);
          // Ignore accidental clicks (< 0.5% area)
          if (w * h < 0.00005) return;
          onCreate({ x, y, w, h });
        }}
      >
        {page.signed_url ? (
          <img
            src={page.signed_url}
            alt={`Page ${page.page_index + 1}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
            Page image unavailable
          </div>
        )}

        {/* Existing annotation boxes */}
        {annotations.map((a) => {
          const c = colorFor(a.entity_type_id);
          const ent = entityById.get(a.entity_type_id);
          return (
            <div
              key={a.id}
              className="group absolute"
              style={{
                left: `${a.bbox.x * 100}%`,
                top: `${a.bbox.y * 100}%`,
                width: `${a.bbox.w * 100}%`,
                height: `${a.bbox.h * 100}%`,
                outline: `2px solid ${c}`,
                background: `${c}1a`,
              }}
            >
              <div
                className="absolute -top-5 left-0 flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-white shadow"
                style={{ background: c }}
              >
                <span>{ent?.label ?? "entity"}</span>
                <button
                  type="button"
                  className="opacity-0 transition group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); onDelete(a.id); }}
                  aria-label="Delete annotation"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}

        {/* Live drag rectangle */}
        {drag && activeEntity ? (
          (() => {
            const c = colorFor(activeEntity);
            const x = Math.min(drag.x0, drag.x1);
            const y = Math.min(drag.y0, drag.y1);
            const w = Math.abs(drag.x1 - drag.x0);
            const h = Math.abs(drag.y1 - drag.y0);
            return (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  width: `${w * 100}%`,
                  height: `${h * 100}%`,
                  outline: `2px dashed ${c}`,
                  background: `${c}26`,
                }}
              />
            );
          })()
        ) : null}
      </div>
    </div>
  );
}
