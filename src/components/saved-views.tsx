import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSavedViews, upsertSavedView, deleteSavedView } from "@/lib/saved-views.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Bookmark, Save, X } from "lucide-react";
import { toast } from "sonner";

export function SavedViews({
  tenantId, scope, currentFilters, onApply,
}: {
  tenantId: string; scope: string;
  currentFilters: Record<string, any>;
  onApply: (filters: Record<string, any>) => void;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listSavedViews);
  const save = useServerFn(upsertSavedView);
  const del = useServerFn(deleteSavedView);

  const q = useQuery({
    queryKey: ["saved-views", tenantId, scope],
    queryFn: () => list({ data: { tenant_id: tenantId, scope } }),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);

  const mSave = useMutation({
    mutationFn: () => save({ data: { tenant_id: tenantId, scope, name, filters: currentFilters, is_shared: shared } }),
    onSuccess: () => {
      toast.success("View saved");
      setOpen(false); setName(""); setShared(false);
      qc.invalidateQueries({ queryKey: ["saved-views", tenantId, scope] });
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-views", tenantId, scope] }),
  });

  const views = q.data ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map((v: any) => (
        <div key={v.id} className="group flex items-center">
          <Button size="sm" variant="outline" className="h-7 rounded-r-none px-2 text-xs"
            onClick={() => onApply(v.filters)}>
            <Bookmark className="mr-1 h-3 w-3" /> {v.name}
            {v.is_shared && <Badge variant="secondary" className="ml-1.5 h-4 text-[9px]">shared</Badge>}
          </Button>
          <Button size="sm" variant="outline" className="h-7 rounded-l-none border-l-0 px-1.5"
            onClick={() => mDelete.mutate(v.id)} aria-label={`Delete saved view ${v.name}`}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(true)}>
        <Save className="mr-1 h-3 w-3" /> Save view
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save filter view</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Demo Bank EMEA — high-severity opens > 24h" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={shared} onCheckedChange={(c) => setShared(!!c)} />
              Share with tenant
            </label>
            <p className="text-xs text-muted-foreground">Current filters: {JSON.stringify(currentFilters)}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || mSave.isPending} onClick={() => mSave.mutate()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
