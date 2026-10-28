import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSavedViews, upsertSavedView, deleteSavedView } from "@/lib/saved-views.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Bookmark, BookmarkPlus, Users, User as UserIcon, ChevronDown, Trash2, Table2, GroupIcon, Kanban, GanttChart, Grid3x3 } from "lucide-react";
import { toast } from "sonner";

export type ViewType = "table" | "pivot" | "board" | "timeline" | "grid";

export interface SavedViewBarProps {
  tenantId: string;
  scope: string;
  currentFilters: Record<string, any>;
  currentPivot?: Record<string, any>;
  currentColumns?: Record<string, any>;
  currentSort?: any[];
  viewType?: ViewType;
  onApply: (view: {
    filters: Record<string, any>;
    pivot_config: Record<string, any>;
    column_config: Record<string, any>;
    sort_config: any[];
    view_type: ViewType;
  }) => void;
}

const VIEW_ICONS: Record<ViewType, any> = {
  table: Table2,
  pivot: GroupIcon,
  board: Kanban,
  timeline: GanttChart,
  grid: Grid3x3,
};

export function SavedViewsBar({
  tenantId,
  scope,
  currentFilters,
  currentPivot = {},
  currentColumns = {},
  currentSort = [],
  viewType = "table",
  onApply,
}: SavedViewBarProps) {
  const qc = useQueryClient();
  const fetch = useServerFn(listSavedViews);
  const save = useServerFn(upsertSavedView);
  const remove = useServerFn(deleteSavedView);

  const { data: views = [] } = useQuery({
    queryKey: ["saved-views", tenantId, scope],
    queryFn: () => fetch({ data: { tenant_id: tenantId, scope } } as any) as Promise<any[]>,
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [type, setType] = useState<ViewType>(viewType);

  const saveMut = useMutation({
    mutationFn: () => save({
      data: {
        tenant_id: tenantId, scope, name,
        filters: currentFilters,
        is_shared: isShared,
      },
    } as any) as Promise<any>,
    onSuccess: () => {
      toast.success(`View "${name}" saved`);
      qc.invalidateQueries({ queryKey: ["saved-views", tenantId, scope] });
      setOpen(false); setName(""); setDesc("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save view"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } } as any) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-views", tenantId, scope] });
      toast.success("View deleted");
    },
  });

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Bookmark className="h-4 w-4" />
            Saved views
            <Badge variant="secondary" className="ml-1 h-4 text-[10px]">{views.length}</Badge>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {views.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No saved views yet</div>
          ) : views.map((v: any) => {
            const Icon = VIEW_ICONS[(v.view_type as ViewType) ?? "table"] ?? Table2;
            return (
              <DropdownMenuItem
                key={v.id}
                onClick={() => onApply({
                  filters: v.filters ?? {},
                  pivot_config: v.pivot_config ?? {},
                  column_config: v.column_config ?? {},
                  sort_config: v.sort_config ?? [],
                  view_type: (v.view_type as ViewType) ?? "table",
                })}
                className="flex items-start gap-3 py-2"
              >
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{v.name}</span>
                    {v.is_shared ? <Users className="h-3 w-3 text-muted-foreground" /> : <UserIcon className="h-3 w-3 text-muted-foreground" />}
                  </div>
                  {v.description && <p className="text-xs text-muted-foreground truncate">{v.description}</p>}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteMut.mutate(v.id); }}
                  className="opacity-50 hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)}>
            <BookmarkPlus className="h-4 w-4 mr-2" />
            Save current view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="view-name">Name</Label>
              <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My breakdowns by counterparty" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="view-desc">Description (optional)</Label>
              <Input id="view-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Used for daily nostro review" />
            </div>
            <div className="space-y-1">
              <Label>View type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ViewType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">Table</SelectItem>
                  <SelectItem value="pivot">Pivot / group-by</SelectItem>
                  <SelectItem value="board">Kanban board</SelectItem>
                  <SelectItem value="timeline">Timeline</SelectItem>
                  <SelectItem value="grid">Spreadsheet grid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Share with team</Label>
                <p className="text-xs text-muted-foreground">All tenant members will see this view</p>
              </div>
              <Switch checked={isShared} onCheckedChange={setIsShared} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={!name || saveMut.isPending}>
              {saveMut.isPending ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
