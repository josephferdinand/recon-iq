import { createFileRoute, redirect } from "@tanstack/react-router";
import { assertMktRolesFn } from "@/lib/mkt-admin.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Film, Image as ImageIcon, Video, Trash2, Save, Upload, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listMediaAdmin,
  upsertMediaAsset,
  deleteMediaAsset,
  createMediaUploadUrl,
  type MktMediaAsset,
  type MktMediaKind,
} from "@/lib/mkt-media.functions";

export const Route = createFileRoute("/mkt-admin/media")({
  beforeLoad: async () => {
    try {
      await assertMktRolesFn({ data: { allowed: MKT_TAB_ROLES.media } });
    } catch {
      throw redirect({ to: "/mkt-admin" });
    }
  },
  component: MediaPage,
});

const KINDS: { key: MktMediaKind; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "reel", label: "Reels (30–60s)", icon: Film },
  { key: "video", label: "Videos", icon: Video },
  { key: "image", label: "Images", icon: ImageIcon },
];

function MediaPage() {
  const listFn = useServerFn(listMediaAdmin);
  const q = useQuery({
    queryKey: ["mkt", "media"],
    queryFn: () => listFn({ data: {} }),
  });

  const [creating, setCreating] = useState<MktMediaKind | null>(null);

  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Main website · media library</div>
        <h1 className="mt-1 font-display text-2xl font-semibold">Media, reels & videos</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Upload and manage every image, video, and micro-reel used by the marketing site.
          Assets can be uploaded to managed platform storage or pointed at an external URL (YouTube, Vimeo, HLS, MP4).
        </p>
      </header>

      {q.isLoading && (
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">Loading…</div>
      )}
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load: {(q.error as Error).message}
        </div>
      )}

      {KINDS.map(({ key, label, icon: Icon }) => {
        const rows = (q.data ?? []).filter((r) => r.kind === key);
        return (
          <section key={key} className="rounded-xl border border-border bg-card p-5">
            <header className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div>
                <h2 className="font-display text-lg font-semibold">{label}</h2>
                <Badge variant="outline">{rows.length}</Badge>
              </div>
              <Button size="sm" variant="outline" onClick={() => setCreating(key)}>
                <Plus className="mr-1 h-4 w-4" /> Add {key}
              </Button>
            </header>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => <MediaCard key={row.id} row={row} />)}
              {rows.length === 0 && (
                <div className="text-sm text-muted-foreground">No {key}s yet.</div>
              )}
            </div>
          </section>
        );
      })}

      {creating && (
        <NewAssetModal kind={creating} onClose={() => setCreating(null)} />
      )}
    </div>
  );
}

function MediaCard({ row }: { row: MktMediaAsset }) {
  const upsertFn = useServerFn(upsertMediaAsset);
  const delFn = useServerFn(deleteMediaAsset);
  const qc = useQueryClient();
  const [edit, setEdit] = useState(row);

  const save = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          id: edit.id,
          kind: edit.kind,
          title: edit.title,
          alt: edit.alt ?? null,
          storage_path: edit.storage_path ?? null,
          external_url: edit.external_url ?? null,
          poster_url: edit.poster_url ?? null,
          duration_sec: edit.duration_sec ?? null,
          tags: edit.tags ?? [],
          sort_order: edit.sort_order ?? 0,
          enabled: edit.enabled,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "media"] }),
  });

  const del = useMutation({
    mutationFn: () => delFn({ data: { id: row.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "media"] }),
  });

  const previewUrl = edit.external_url || edit.public_url;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-muted">
        {previewUrl ? (
          edit.kind === "image" ? (
            <img src={previewUrl} alt={edit.alt ?? edit.title} className="h-full w-full object-cover" />
          ) : (
            <video src={previewUrl} poster={edit.poster_url ?? undefined} controls className="h-full w-full object-cover" />
          )
        ) : (
          <span className="text-xs text-muted-foreground">No source</span>
        )}
      </div>
      <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Title" />
      <Input value={edit.alt ?? ""} onChange={(e) => setEdit({ ...edit, alt: e.target.value })} placeholder="Alt / accessibility text" />
      <Input value={edit.external_url ?? ""} onChange={(e) => setEdit({ ...edit, external_url: e.target.value || null })} placeholder="External URL (optional)" />
      <Input value={edit.poster_url ?? ""} onChange={(e) => setEdit({ ...edit, poster_url: e.target.value || null })} placeholder="Poster URL (optional)" />
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" value={edit.duration_sec ?? ""} onChange={(e) => setEdit({ ...edit, duration_sec: e.target.value ? Number(e.target.value) : null })} placeholder="Duration (sec)" />
        <Input type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value || 0) })} placeholder="Sort order" />
      </div>
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Switch checked={edit.enabled} onCheckedChange={(v) => setEdit({ ...edit, enabled: !!v })} />
          <Label className="text-xs">Enabled</Label>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => del.mutate()} disabled={del.isPending}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        </div>
      </div>
      {(save.error || del.error) && (
        <div className="text-xs text-destructive">{((save.error || del.error) as Error).message}</div>
      )}
    </div>
  );
}

function NewAssetModal({ kind, onClose }: { kind: MktMediaKind; onClose: () => void }) {
  const upsertFn = useServerFn(upsertMediaAsset);
  const signFn = useServerFn(createMediaUploadUrl);
  const qc = useQueryClient();
  const [mode, setMode] = useState<"upload" | "external">("upload");
  const [title, setTitle] = useState("");
  const [alt, setAlt] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [duration, setDuration] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!title.trim()) throw new Error("Title is required.");
      let storage_path: string | null = null;
      let mime_type: string | null = null;
      let size_bytes: number | null = null;
      if (mode === "upload") {
        if (!file) throw new Error("Choose a file to upload.");
        const cleanName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const signed = await signFn({ data: { filename: cleanName, kind } });
        const up = await supabase.storage.from("mkt-media")
          .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
        if (up.error) throw new Error(up.error.message);
        storage_path = signed.path;
        mime_type = file.type;
        size_bytes = file.size;
      } else {
        if (!externalUrl) throw new Error("Enter an external URL.");
      }
      await upsertFn({
        data: {
          kind, title, alt: alt || null,
          storage_path,
          external_url: mode === "external" ? externalUrl : null,
          poster_url: posterUrl || null,
          duration_sec: duration ? Number(duration) : null,
          mime_type, size_bytes,
          tags: [], sort_order: 0, enabled: true,
        },
      });
      await qc.invalidateQueries({ queryKey: ["mkt", "media"] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
        <h3 className="font-display text-lg font-semibold">Add {kind}</h3>
        <div className="mt-3 flex gap-2 text-xs">
          <Button size="sm" variant={mode === "upload" ? "default" : "outline"} onClick={() => setMode("upload")}>
            <Upload className="mr-1 h-3.5 w-3.5" /> Upload file
          </Button>
          <Button size="sm" variant={mode === "external" ? "default" : "outline"} onClick={() => setMode("external")}>
            External URL
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Alt / description</Label>
            <Textarea rows={2} value={alt} onChange={(e) => setAlt(e.target.value)} />
          </div>
          {mode === "upload" ? (
            <div>
              <Label className="text-xs">File</Label>
              <Input type="file" accept={kind === "image" ? "image/*" : "video/*"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          ) : (
            <div>
              <Label className="text-xs">External URL</Label>
              <Input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Poster URL</Label>
              <Input value={posterUrl} onChange={(e) => setPosterUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <Label className="text-xs">Duration (sec)</Label>
              <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
        </div>
        {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create"}</Button>
        </div>
      </div>
    </div>
  );
}
