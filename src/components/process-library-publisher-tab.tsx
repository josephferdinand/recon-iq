import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listAllBlueprints,
  upsertBlueprint,
  togglePublishBlueprint,
  deleteBlueprint,
} from "@/lib/process-library-admin.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Library, Trash2, Save, Eye } from "lucide-react";
import { toast } from "sonner";

const STARTER_BLUEPRINT = JSON.stringify(
  {
    asOfFields: ["value_date"],
    sources: [
      { name: "Demo Bank ledger", type: "internal" },
      { name: "Counterparty statement", type: "external" },
    ],
    matching: {
      strategy: "cascading",
      keys: ["instrument_id", "trade_date", "notional"],
      tolerances: { notional: 0.01, fx_rate: 0.0005 },
    },
    signoff: { roles: ["preparer", "reviewer"], frequency: "daily" },
  },
  null,
  2,
);

export function ProcessLibraryPublisherTab() {
  const qc = useQueryClient();
  const list = useServerFn(listAllBlueprints);
  const save = useServerFn(upsertBlueprint);
  const pub = useServerFn(togglePublishBlueprint);
  const del = useServerFn(deleteBlueprint);

  const q = useQuery({ queryKey: ["pl-admin"], queryFn: () => list() });

  const [editing, setEditing] = useState<{
    id?: string;
    slug: string;
    title: string;
    summary: string;
    category: string;
    assetClass: string;
    blueprintJson: string;
    published: boolean;
  }>({
    slug: "falcon-nostro-usd",
    title: "Demo Bank Nostro USD reconciliation",
    summary: "Daily Nostro reconciliation between Demo Bank ledger and JPMorgan USD statement.",
    category: "Cash & bank",
    assetClass: "Cash",
    blueprintJson: STARTER_BLUEPRINT,
    published: false,
  });

  const mSave = useMutation({
    mutationFn: () => save({ data: editing }),
    onSuccess: (r) => {
      toast.success(`Saved (v${r.version})`);
      qc.invalidateQueries({ queryKey: ["pl-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mPub = useMutation({
    mutationFn: (v: { id: string; published: boolean }) => pub({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pl-admin"] }),
  });
  const mDel = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["pl-admin"] });
    },
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Library className="h-4 w-4" /> Publish a config package
          </CardTitle>
          <CardDescription>
            Config packages are shipped to every tenant's Config Promotion library for one-click cloning. Example title:{" "}
            <em>Demo Bank Nostro USD reconciliation</em>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Slug</Label>
              <Input
                value={editing.slug}
                onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Input
                value={editing.category}
                onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Asset class</Label>
              <Input
                value={editing.assetClass}
                onChange={(e) => setEditing({ ...editing, assetClass: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Summary</Label>
            <Textarea
              rows={2}
              value={editing.summary}
              onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Blueprint JSON</Label>
            <Textarea
              rows={14}
              className="font-mono text-xs"
              value={editing.blueprintJson}
              onChange={(e) => setEditing({ ...editing, blueprintJson: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded border p-2 text-sm">
            <span>Published (visible to all tenants)</span>
            <Switch
              checked={editing.published}
              onCheckedChange={(v) => setEditing({ ...editing, published: v })}
            />
          </div>
          <div className="flex justify-end gap-2">
            {editing.id && (
              <Button variant="outline" onClick={() => setEditing({ ...editing, id: undefined })}>
                New blueprint
              </Button>
            )}
            <Button onClick={() => mSave.mutate()} disabled={mSave.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {editing.id ? "Save new version" : "Create blueprint"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All blueprints</CardTitle>
          <CardDescription>Latest version shown. Versions are bumped on every save.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No blueprints yet. Try publishing "Demo Bank Nostro USD reconciliation" above.
            </p>
          )}
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.title}</span>
                  <Badge variant="outline">v{r.version}</Badge>
                  {r.published ? <Badge>Published</Badge> : <Badge variant="secondary">Draft</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.category}{r.asset_class ? ` · ${r.asset_class}` : ""} · {r.slug}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={r.published}
                  onCheckedChange={(v) => mPub.mutate({ id: r.id, published: v })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditing({
                      id: r.id,
                      slug: r.slug,
                      title: r.title,
                      summary: r.summary ?? "",
                      category: r.category,
                      assetClass: r.asset_class ?? "",
                      blueprintJson: STARTER_BLUEPRINT,
                      published: r.published,
                    })
                  }
                >
                  <Eye className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => mDel.mutate(r.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
