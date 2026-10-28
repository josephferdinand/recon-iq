import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listBusinessUnits, createBusinessUnit, updateBusinessUnit, deleteBusinessUnit,
  listBuMembers, assignBuUser, removeBuUser, assignBuGroup, removeBuGroup, listBuResources,
} from "@/lib/business-units.functions";
import { listGroups } from "@/lib/groups.functions";
import { listTenantMembers } from "@/lib/members.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, ChevronRight, ChevronDown, Building2, Trash2, Archive, X, Search, GitBranch } from "lucide-react";
import { toast } from "sonner";

type BU = {
  id: string; parent_id: string | null; name: string; code: string | null;
  description: string | null; depth: number; is_archived: boolean; created_at: string;
};

type TreeNode = BU & { children: TreeNode[] };

function buildTree(rows: BU[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  rows.forEach((r) => map.set(r.id, { ...r, children: [] }));
  const roots: TreeNode[] = [];
  rows.forEach((r) => {
    const node = map.get(r.id)!;
    if (r.parent_id && map.has(r.parent_id)) map.get(r.parent_id)!.children.push(node);
    else roots.push(node);
  });
  return roots;
}

const ROLES = ["bu_admin", "bu_member", "bu_viewer"] as const;

export function BusinessUnitsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listBusinessUnits);
  const q = useQuery({
    queryKey: ["business-units", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId } }),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newParent, setNewParent] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const rows = (q.data ?? []) as BU[];
  const tree = useMemo(() => buildTree(rows), [rows]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    if (!search) return tree;
    const s = search.toLowerCase();
    const matches = new Set<string>();
    rows.forEach((r) => {
      if (r.name.toLowerCase().includes(s) || (r.code ?? "").toLowerCase().includes(s)) {
        matches.add(r.id);
        let cur: BU | undefined = r;
        while (cur?.parent_id) {
          matches.add(cur.parent_id);
          cur = rows.find((x) => x.id === cur!.parent_id);
        }
      }
    });
    const prune = (nodes: TreeNode[]): TreeNode[] =>
      nodes.filter((n) => matches.has(n.id)).map((n) => ({ ...n, children: prune(n.children) }));
    return prune(tree);
  }, [tree, rows, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["business-units", tenantId] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5" /> Business Units
          </h2>
          <p className="text-sm text-muted-foreground">
            Model your organisation hierarchy (e.g. Investment Bank → Equities → Cash Equities) to scope visibility for users, groups, and reconciliations.
          </p>
        </div>
        <Button disabled={!canWrite} onClick={() => { setNewParent(null); setNewOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> New BU
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Org Structure
            </CardTitle>
            <div className="relative pt-2">
              <Search className="absolute left-2 top-4 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search business units…" className="pl-8 h-8" />
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {rows.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                No business units yet. Create one to segment your tenant.
              </div>
            ) : (
              <Tree
                nodes={filtered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddChild={(pid) => { setNewParent(pid); setNewOpen(true); }}
                canWrite={canWrite}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          {selected ? (
            <BuDetail
              bu={selected}
              allRows={rows}
              tenantId={tenantId}
              canWrite={canWrite}
              onChange={invalidate}
              onDelete={() => { setSelectedId(null); invalidate(); }}
            />
          ) : (
            <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              Select a business unit to view details
            </CardContent>
          )}
        </Card>
      </div>

      <NewBuDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        tenantId={tenantId}
        allRows={rows}
        defaultParent={newParent}
        onCreated={invalidate}
      />
    </div>
  );
}

function Tree({
  nodes, selectedId, onSelect, onAddChild, canWrite, level = 0,
}: {
  nodes: TreeNode[]; selectedId: string | null; onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void; canWrite: boolean; level?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => (
        <TreeNodeRow key={n.id} node={n} selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} canWrite={canWrite} level={level} />
      ))}
    </ul>
  );
}

function TreeNodeRow({ node, selectedId, onSelect, onAddChild, canWrite, level }: any) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  return (
    <li>
      <div
        className={`group flex items-center gap-1 rounded px-2 py-1.5 text-sm cursor-pointer ${
          isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
        }`}
        style={{ paddingLeft: `${level * 14 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} className="rounded p-0.5 hover:bg-muted-foreground/10">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : <span className="w-4" />}
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{node.name}</span>
        {node.code && <Badge variant="outline" className="text-[10px] font-mono">{node.code}</Badge>}
        {node.is_archived && <Badge variant="secondary" className="text-[10px]">archived</Badge>}
        {canWrite && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
            className="opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-muted-foreground/10"
            title="Add child BU"
          ><Plus className="h-3.5 w-3.5" /></button>
        )}
      </div>
      {hasChildren && open && (
        <Tree nodes={node.children} selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} canWrite={canWrite} level={level + 1} />
      )}
    </li>
  );
}

function BuDetail({ bu, allRows, tenantId, canWrite, onChange, onDelete }: {
  bu: BU; allRows: BU[]; tenantId: string; canWrite: boolean; onChange: () => void; onDelete: () => void;
}) {
  const updateFn = useServerFn(updateBusinessUnit);
  const delFn = useServerFn(deleteBusinessUnit);
  const [name, setName] = useState(bu.name);
  const [desc, setDesc] = useState(bu.description ?? "");
  const [parentId, setParentId] = useState<string | null>(bu.parent_id);

  // Reset when selected BU changes
  useMemo(() => { setName(bu.name); setDesc(bu.description ?? ""); setParentId(bu.parent_id); }, [bu.id]);

  const path = useMemo(() => {
    const out: BU[] = [];
    let cur: BU | undefined = bu;
    while (cur) { out.unshift(cur); cur = allRows.find((r) => r.id === cur!.parent_id); }
    return out;
  }, [bu, allRows]);

  const descendants = allRows.filter((r) => {
    let cur: BU | undefined = r;
    while (cur?.parent_id) { if (cur.parent_id === bu.id) return true; cur = allRows.find((x) => x.id === cur!.parent_id); }
    return false;
  }).length;

  const validParents = allRows.filter((r) => r.id !== bu.id && !isDescendant(r, bu, allRows));

  const save = async () => {
    await updateFn({ data: { tenant_id: tenantId, id: bu.id, name, description: desc, parent_id: parentId } });
    toast.success("Updated");
    onChange();
  };

  const archive = async () => {
    await updateFn({ data: { tenant_id: tenantId, id: bu.id, is_archived: !bu.is_archived } });
    toast.success(bu.is_archived ? "Restored" : "Archived");
    onChange();
  };

  const remove = async () => {
    if (!confirm("Delete this BU? Resources tagged to it will become tenant-wide.")) return;
    try {
      await delFn({ data: { tenant_id: tenantId, id: bu.id } });
      toast.success("Deleted"); onDelete();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {bu.name}
              {bu.code && <Badge variant="outline" className="font-mono">{bu.code}</Badge>}
              {bu.is_archived && <Badge variant="secondary">archived</Badge>}
            </CardTitle>
            <CardDescription className="flex items-center gap-1 text-xs">
              {path.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" />}
                  <span className={p.id === bu.id ? "font-medium text-foreground" : ""}>{p.name}</span>
                </span>
              ))}
            </CardDescription>
          </div>
          {canWrite && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={archive}>
                <Archive className="mr-1 h-3.5 w-3.5" /> {bu.is_archived ? "Restore" : "Archive"}
              </Button>
              <Button size="sm" variant="outline" onClick={remove}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Descendants" value={descendants} />
              <Stat label="Depth" value={bu.depth} />
              <Stat label="Created" value={new Date(bu.created_at).toLocaleDateString()} />
            </div>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!canWrite} rows={3} />
              </div>
              <div>
                <Label>Parent BU</Label>
                <Select value={parentId ?? "__root"} onValueChange={(v) => setParentId(v === "__root" ? null : v)} disabled={!canWrite}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__root">— Root (no parent) —</SelectItem>
                    {validParents.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{"  ".repeat(p.depth)}{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canWrite && <Button onClick={save}>Save changes</Button>}
            </div>
          </TabsContent>

          <TabsContent value="members" className="pt-4">
            <BuMembers buId={bu.id} tenantId={tenantId} canWrite={canWrite} />
          </TabsContent>

          <TabsContent value="resources" className="pt-4">
            <BuResources buId={bu.id} tenantId={tenantId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </>
  );
}

function isDescendant(candidate: BU, root: BU, all: BU[]): boolean {
  let cur: BU | undefined = candidate;
  while (cur?.parent_id) {
    if (cur.parent_id === root.id) return true;
    cur = all.find((x) => x.id === cur!.parent_id);
  }
  return false;
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function BuMembers({ buId, tenantId, canWrite }: { buId: string; tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listBuMembers);
  const assignUserFn = useServerFn(assignBuUser);
  const removeUserFn = useServerFn(removeBuUser);
  const assignGroupFn = useServerFn(assignBuGroup);
  const removeGroupFn = useServerFn(removeBuGroup);
  const groupsFn = useServerFn(listGroups);
  const membersFn = useServerFn(listTenantMembers);

  const q = useQuery({ queryKey: ["bu-members", buId], queryFn: () => listFn({ data: { tenant_id: tenantId, bu_id: buId } }) });
  const groupsQ = useQuery({ queryKey: ["groups", tenantId], queryFn: () => groupsFn({ data: { tenant_id: tenantId } }) });
  const membersQ = useQuery({
    queryKey: ["members-lite", tenantId],
    queryFn: async () => {
      const rows = await membersFn({ data: { tenant_id: tenantId } });
      return (rows ?? []).map((r: any) => ({ user_id: r.user_id, email: r.profile?.email ?? r.user_id.slice(0, 8) }));
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["bu-members", buId] });

  const [userId, setUserId] = useState("");
  const [userRole, setUserRole] = useState<"bu_admin" | "bu_member" | "bu_viewer">("bu_member");
  const [userInherit, setUserInherit] = useState(true);

  const [groupId, setGroupId] = useState("");
  const [groupRole, setGroupRole] = useState<"bu_admin" | "bu_member" | "bu_viewer">("bu_member");
  const [groupInherit, setGroupInherit] = useState(true);

  const assignedUserIds = new Set((q.data?.users ?? []).map((u: any) => u.user_id));
  const assignedGroupIds = new Set((q.data?.groups ?? []).map((g: any) => g.group_id));
  const userCands = (membersQ.data ?? []).filter((m: any) => !assignedUserIds.has(m.user_id));
  const groupCands = (groupsQ.data ?? []).filter((g: any) => !assignedGroupIds.has(g.id));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Users ({q.data?.users.length ?? 0})</div>
        <div className="space-y-1">
          {(q.data?.users ?? []).map((u: any) => {
            const m = (membersQ.data ?? []).find((x: any) => x.user_id === u.user_id);
            return (
              <div key={u.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span>{m?.email ?? u.user_id.slice(0, 8)}</span>
                  <Badge variant="outline" className="text-[10px]">{u.role.replace("bu_", "")}</Badge>
                  {u.inherit_descendants && <Badge variant="secondary" className="text-[10px]">+children</Badge>}
                </div>
                {canWrite && (
                  <Button size="icon" variant="ghost" onClick={async () => {
                    await removeUserFn({ data: { tenant_id: tenantId, assignment_id: u.id } }); invalidate();
                  }}><X className="h-3.5 w-3.5" /></Button>
                )}
              </div>
            );
          })}
        </div>
        {canWrite && userCands.length > 0 && (
          <div className="rounded border bg-muted/20 p-2 space-y-2">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="e.g. jane.doe@demo-bank.example" /></SelectTrigger>
              <SelectContent>{userCands.map((u: any) => <SelectItem key={u.user_id} value={u.user_id}>{u.email}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Select value={userRole} onValueChange={(v: any) => setUserRole(v)}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace("bu_", "")}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-center gap-1 text-xs">
                <Switch checked={userInherit} onCheckedChange={setUserInherit} /> Inherit
              </label>
              <Button size="sm" disabled={!userId} onClick={async () => {
                await assignUserFn({ data: { tenant_id: tenantId, bu_id: buId, user_id: userId, role: userRole, inherit_descendants: userInherit } });
                setUserId(""); invalidate();
              }}>Add</Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Groups ({q.data?.groups.length ?? 0})</div>
        <div className="space-y-1">
          {(q.data?.groups ?? []).map((g: any) => (
            <div key={g.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span>{g.name}</span>
                <Badge variant="outline" className="text-[10px]">{g.role.replace("bu_", "")}</Badge>
                {g.inherit_descendants && <Badge variant="secondary" className="text-[10px]">+children</Badge>}
              </div>
              {canWrite && (
                <Button size="icon" variant="ghost" onClick={async () => {
                  await removeGroupFn({ data: { tenant_id: tenantId, assignment_id: g.id } }); invalidate();
                }}><X className="h-3.5 w-3.5" /></Button>
              )}
            </div>
          ))}
        </div>
        {canWrite && groupCands.length > 0 && (
          <div className="rounded border bg-muted/20 p-2 space-y-2">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="e.g. Demo Bank Cash Ops EMEA" /></SelectTrigger>
              <SelectContent>{groupCands.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Select value={groupRole} onValueChange={(v: any) => setGroupRole(v)}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace("bu_", "")}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-center gap-1 text-xs">
                <Switch checked={groupInherit} onCheckedChange={setGroupInherit} /> Inherit
              </label>
              <Button size="sm" disabled={!groupId} onClick={async () => {
                await assignGroupFn({ data: { tenant_id: tenantId, bu_id: buId, group_id: groupId, role: groupRole, inherit_descendants: groupInherit } });
                setGroupId(""); invalidate();
              }}>Add</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BuResources({ buId, tenantId }: { buId: string; tenantId: string }) {
  const fn = useServerFn(listBuResources);
  const q = useQuery({ queryKey: ["bu-resources", buId], queryFn: () => fn({ data: { tenant_id: tenantId, bu_id: buId } }) });
  const sections: [string, any[]][] = [
    ["Reconciliations", q.data?.recons ?? []],
    ["Data sources", q.data?.sources ?? []],
    ["Data prep pipelines", q.data?.pipelines ?? []],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {sections.map(([label, items]) => (
        <div key={label}>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label} ({items.length})</div>
          {items.length === 0 ? (
            <div className="rounded border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
              No resources tagged
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((r: any) => (
                <div key={r.id} className="rounded border px-2 py-1.5 text-sm">{r.name}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NewBuDialog({ open, onOpenChange, tenantId, allRows, defaultParent, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; tenantId: string;
  allRows: BU[]; defaultParent: string | null; onCreated: () => void;
}) {
  const createFn = useServerFn(createBusinessUnit);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [desc, setDesc] = useState("");
  const [parent, setParent] = useState<string | null>(defaultParent);

  useMemo(() => { if (open) { setName(""); setCode(""); setDesc(""); setParent(defaultParent); } }, [open, defaultParent]);

  const m = useMutation({
    mutationFn: () => createFn({ data: {
      tenant_id: tenantId, parent_id: parent, name, code: code || null, description: desc || null,
    } }),
    onSuccess: () => { toast.success("Business Unit created"); onOpenChange(false); onCreated(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Business Unit</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fund Accounting" />
          </div>
          <div>
            <Label>Code (optional, auto-uppercased)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. FACC" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="e.g. Demo Bank EMEA Cash Management — covers GBP/EUR nostro accounts across London, Frankfurt" />
          </div>
          <div>
            <Label>Parent BU</Label>
            <Select value={parent ?? "__root"} onValueChange={(v) => setParent(v === "__root" ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root">— Root (no parent) —</SelectItem>
                {allRows.filter((r) => !r.is_archived).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{"— ".repeat(p.depth)}{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {allRows.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No business units exist yet — this will be created as the root BU. Once saved, future BUs can pick this one as their parent.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name || m.isPending} onClick={() => m.mutate()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
