import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listArticleSteps,
  upsertArticleStep,
  deleteArticleStep,
  reorderArticleSteps,
  signKbScreenshots,
  deleteKbScreenshots,
} from "@/lib/kb-templates.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, ImagePlus, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

type Callout = { x: number; y: number; w: number; h: number; number: number; label: string };
type Step = {
  id: string;
  step_number: number;
  title: string;
  body_md: string | null;
  screenshot_url: string | null;
  callouts: Callout[] | null;
};

const THUMB_MAX = 320;
function thumbPathFor(path: string): string {
  return path.replace(/(\.[^.]+)?$/, ".thumb.jpg");
}

async function generateThumbnail(file: File, max = THUMB_MAX): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Failed to read image"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to decode image"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Thumbnail encode failed")), "image/jpeg", 0.8);
  });
}

export function KbArticleStepEditor({ articleId }: { articleId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listArticleSteps);
  const upsertFn = useServerFn(upsertArticleStep);
  const deleteFn = useServerFn(deleteArticleStep);
  const reorderFn = useServerFn(reorderArticleSteps);
  const signFn = useServerFn(signKbScreenshots);

  const stepsQ = useQuery({
    queryKey: ["kb-steps", articleId],
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
    queryKey: ["kb-steps-signed", articleId, paths.join(",")],
    queryFn: () => signFn({ data: { paths } }) as Promise<Record<string, string>>,
    enabled: paths.length > 0,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["kb-steps", articleId] });

  const addStep = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          article_id: articleId,
          step_number: (steps[steps.length - 1]?.step_number ?? 0) + 1,
          title: "Untitled step",
          body_md: "",
          callouts: [],
        },
      }),
    onSuccess: () => { toast.success("Step added"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteScreenshotsFn = useServerFn(deleteKbScreenshots);

  const removeStep = useMutation({
    mutationFn: async (id: string) => {
      const target = steps.find((s) => s.id === id);
      if (target?.screenshot_url) {
        try {
          await deleteScreenshotsFn({ data: { paths: [target.screenshot_url] } });
        } catch (e) {
          console.warn("Screenshot cleanup failed", e);
        }
      }
      return deleteFn({ data: { id } });
    },
    onSuccess: () => { toast.success("Step removed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerateThumbs = useMutation({
    mutationFn: async () => {
      const targets = steps.filter((s) => !!s.screenshot_url);
      if (!targets.length) return { processed: 0 };
      const originals = targets.map((s) => s.screenshot_url!) as string[];
      const signed = await signFn({ data: { paths: originals } }) as Record<string, string>;
      let processed = 0;
      for (const s of targets) {
        const url = signed[s.screenshot_url!];
        if (!url) continue;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], "screenshot", { type: blob.type || "image/png" });
          const thumb = await generateThumbnail(file);
          const { error } = await supabase.storage
            .from("kb-screenshots")
            .upload(thumbPathFor(s.screenshot_url!), thumb, { upsert: true, contentType: "image/jpeg" });
          if (error) throw error;
          processed += 1;
        } catch (err) {
          console.warn("Regenerate failed for", s.screenshot_url, err);
        }
      }
      return { processed };
    },
    onSuccess: (r) => {
      toast.success(`Regenerated ${r.processed} thumbnail${r.processed === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["kb-steps-signed", articleId] });
      qc.invalidateQueries({ queryKey: ["kb-steps-read-signed", articleId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveStep = useMutation({
    mutationFn: (dir: { id: string; direction: -1 | 1 }) => {
      const idx = steps.findIndex((s) => s.id === dir.id);
      const swap = idx + dir.direction;
      if (idx < 0 || swap < 0 || swap >= steps.length) return Promise.resolve({ ok: true });
      const a = steps[idx], b = steps[swap];
      return reorderFn({
        data: {
          article_id: articleId,
          order: [
            { id: a.id, step_number: b.step_number },
            { id: b.id, step_number: a.step_number },
          ],
        },
      });
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Steps & screenshots</CardTitle>
          <CardDescription>
            Numbered, callout-annotated walkthrough. Click the screenshot to drop a numbered callout; drag a corner to size it.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => regenerateThumbs.mutate()}
            disabled={regenerateThumbs.isPending || steps.every((s) => !s.screenshot_url)}
            title="Re-create 320px JPEG thumbnails for every screenshot in this article"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${regenerateThumbs.isPending ? "animate-spin" : ""}`} />
            {regenerateThumbs.isPending ? "Regenerating…" : "Regenerate thumbnails"}
          </Button>
          <Button size="sm" onClick={() => addStep.mutate()} disabled={addStep.isPending}>
            <Plus className="h-4 w-4 mr-1" /> Add step
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {stepsQ.isLoading && <p className="text-sm text-muted-foreground">Loading steps…</p>}
        {steps.length === 0 && !stepsQ.isLoading && (
          <p className="text-sm text-muted-foreground">
            No steps yet. Add your first step to begin annotating screenshots.
          </p>
        )}
        {steps.map((s, i) => (
          <StepRow
            key={s.id}
            articleId={articleId}
            step={s}
            signedUrl={s.screenshot_url ? signedQ.data?.[s.screenshot_url] : undefined}
            thumbUrl={s.screenshot_url ? signedQ.data?.[thumbPathFor(s.screenshot_url)] : undefined}
            canUp={i > 0}
            canDown={i < steps.length - 1}
            onMoveUp={() => moveStep.mutate({ id: s.id, direction: -1 })}
            onMoveDown={() => moveStep.mutate({ id: s.id, direction: 1 })}
            onDelete={() => removeStep.mutate(s.id)}
            onSaved={invalidate}
            upsertFn={upsertFn}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function StepRow(props: {
  articleId: string;
  step: Step;
  signedUrl?: string;
  thumbUrl?: string;
  canUp: boolean;
  canDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onSaved: () => void;
  upsertFn: ReturnType<typeof useServerFn<typeof upsertArticleStep>>;
}) {
  const { step, signedUrl, thumbUrl, upsertFn, onSaved } = props;
  const [title, setTitle] = useState(step.title);
  const [body, setBody] = useState(step.body_md ?? "");
  const [screenshotPath, setScreenshotPath] = useState(step.screenshot_url ?? "");
  const [callouts, setCallouts] = useState<Callout[]>(step.callouts ?? []);
  const [uploading, setUploading] = useState(false);
  const imgRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTitle(step.title);
    setBody(step.body_md ?? "");
    setScreenshotPath(step.screenshot_url ?? "");
    setCallouts(step.callouts ?? []);
  }, [step.id, step.title, step.body_md, step.screenshot_url, step.callouts]);

  const save = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          id: step.id,
          article_id: props.articleId,
          step_number: step.step_number,
          title,
          body_md: body,
          screenshot_url: screenshotPath || undefined,
          callouts,
        },
      }),
    onSuccess: () => { toast.success(`Step ${step.step_number} saved`); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteScreenshotsFn = useServerFn(deleteKbScreenshots);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `articles/${props.articleId}/step-${step.step_number}-${Date.now()}.${ext}`;
      const previous = screenshotPath;
      const { error } = await supabase.storage
        .from("kb-screenshots")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      try {
        const thumb = await generateThumbnail(file);
        const { error: tErr } = await supabase.storage
          .from("kb-screenshots")
          .upload(thumbPathFor(path), thumb, { upsert: true, contentType: "image/jpeg" });
        if (tErr) throw tErr;
      } catch (thumbErr) {
        console.warn("Thumbnail generation failed", thumbErr);
      }
      setScreenshotPath(path);
      if (previous && previous !== path) {
        try {
          await deleteScreenshotsFn({ data: { paths: [previous] } });
        } catch (cleanupErr) {
          console.warn("Previous screenshot cleanup failed", cleanupErr);
        }
      }
      toast.success("Screenshot uploaded — remember to Save the step");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onImgClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const next = [...callouts];
    const num = (next.reduce((m, c) => Math.max(m, c.number), 0) || 0) + 1;
    next.push({
      x: Math.max(0, Math.min(1, x - 0.04)),
      y: Math.max(0, Math.min(1, y - 0.04)),
      w: 0.08, h: 0.08, number: num, label: `Callout ${num}`,
    });
    setCallouts(next);
  };

  const removeCallout = (n: number) => setCallouts(callouts.filter((c) => c.number !== n));
  const renumber = (cs: Callout[]) =>
    cs.slice().sort((a, b) => a.number - b.number).map((c, i) => ({ ...c, number: i + 1 }));

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">Step {step.step_number}</Badge>
        <div className="h-12 w-16 shrink-0 overflow-hidden rounded border bg-muted grid place-items-center">
          {thumbUrl ? (
            <img src={thumbUrl} alt={`Step ${step.step_number} thumbnail`} className="h-full w-full object-cover" />
          ) : signedUrl ? (
            <img src={signedUrl} alt={`Step ${step.step_number} thumbnail`} className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1" />
        <Button variant="ghost" size="icon" disabled={!props.canUp} onClick={props.onMoveUp}><ArrowUp className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" disabled={!props.canDown} onClick={props.onMoveDown}><ArrowDown className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" onClick={props.onDelete}><Trash2 className="h-4 w-4" /></Button>
      </div>

      <div>
        <Label className="text-xs">Body (markdown)</Label>
        <Textarea value={body} rows={3} onChange={(e) => setBody(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs">Screenshot {signedUrl ? "(click to add callout)" : ""}</Label>
            <label className="inline-flex items-center gap-1 text-xs text-primary cursor-pointer">
              <ImagePlus className="h-4 w-4" />
              {uploading ? "Uploading…" : screenshotPath ? "Replace" : "Upload"}
              <input
                type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }}
              />
            </label>
          </div>
          {signedUrl ? (
            <div
              ref={imgRef}
              className="relative w-full overflow-hidden rounded-md border bg-muted cursor-crosshair select-none"
              onClick={onImgClick}
            >
              <img src={signedUrl} alt={`Step ${step.step_number} screenshot`} className="block w-full h-auto pointer-events-none" />
              {callouts.map((c) => (
                <div
                  key={c.number}
                  className="absolute border-2 border-primary bg-primary/10 rounded-sm"
                  style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <span className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold grid place-items-center shadow">
                    {c.number}
                  </span>
                  <button
                    type="button"
                    className="absolute -top-3 -right-3 h-5 w-5 rounded-full bg-destructive text-destructive-foreground grid place-items-center"
                    onClick={(ev) => { ev.stopPropagation(); setCallouts(renumber(callouts.filter((x) => x.number !== c.number))); }}
                    aria-label="Remove callout"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              {screenshotPath ? "Loading screenshot…" : "No screenshot yet. Upload to start annotating."}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Callouts</Label>
          {callouts.length === 0 && <p className="text-xs text-muted-foreground">Click on the image to drop a numbered callout.</p>}
          {callouts.sort((a, b) => a.number - b.number).map((c) => (
            <div key={c.number} className="flex items-center gap-2">
              <Badge>{c.number}</Badge>
              <Input
                value={c.label}
                onChange={(e) => setCallouts(callouts.map((x) => x.number === c.number ? { ...x, label: e.target.value } : x))}
                className="h-8 text-xs"
              />
              <Button variant="ghost" size="icon" onClick={() => setCallouts(renumber(callouts.filter((x) => x.number !== c.number)))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="h-4 w-4 mr-1" /> {save.isPending ? "Saving…" : "Save step"}
        </Button>
      </div>
    </div>
  );
}
