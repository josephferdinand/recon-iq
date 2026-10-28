import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listGroups, createGroup, deleteGroup, setGroupRoles,
  addGroupMember, removeGroupMember,
  listGroupPresets, reseedPresetGroups, effectivePermissions,
} from "@/lib/groups.functions";
import { listRoles } from "@/lib/rbac.functions";
import { listTenantMembers } from "@/lib/members.functions";
import { listBusinessUnits } from "@/lib/business-units.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Users, Plus, ShieldCheck, RefreshCw, Building2, Lock, Sparkles, Eye } from "lucide-react";
import { toast } from "sonner";

/**
 * Tenant Groups manager.
 * Tabs: Groups | Presets | Effective Permissions.
 * Supports optional Business-Unit scoping and group role-bundling.
 */
export function GroupsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  return (
    <Tabs defaultValue="groups" className="space-y-4">
      <TabsList>
        <TabsTrigger value="groups"><Users className="mr-1 h-4 w-4" /> Groups</TabsTrigger>
        <TabsTrigger value="presets"><Sparkles className="mr-1 h-4 w-4" /> Plug-and-Play Presets</TabsTrigger>
        <TabsTrigger value="inspect"><Eye className="mr-1 h-4 w-4" /> Effective Permissions</TabsTrigger>
      </TabsList>
      <TabsContent value="groups"><GroupsList tenantId={tenantId} canWrite={canWrite} /></TabsContent>
      <TabsContent value="presets"><PresetsList tenantId={tenantId} canWrite={canWrite} /></TabsContent>
      <TabsContent value="inspect"><InspectPermissions tenantId={tenantId} /></TabsContent>
    </Tabs>
  );
}

/* --------------------------- Groups list / CRUD --------------------------- */

function GroupsList({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listGroups);
  const createFn = useServerFn(createGroup);
  const delFn = useServerFn(deleteGroup);
  const rolesFn = useServerFn(setGroupRoles);
  const addFn = useServerFn(addGroupMember);
  const remFn = useServerFn(removeGroupMember);
  const membersFn = useServerFn(listTenantMembers);
  const rolesListFn = useServerFn(listRoles);
  const busFn = useServerFn(listBusinessUnits);

  const groupsQ = useQuery({
    queryKey: ["groups", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId } }),
  });
  const membersQ = useQuery({
    queryKey: ["members", tenantId],
    queryFn: async () => {
      const rows = await membersFn({ data: { tenant_id: tenantId } });
      return (rows ?? []).map((r: any) => ({ user_id: r.user_id, email: r.profile?.email ?? r.user_id.slice(0, 8) }));
    },
  });
  const rolesQ = useQuery({
    queryKey: ["rbac-roles", tenantId],
    queryFn: () => rolesListFn({ data: { tenant_id: tenantId } }),
  });
  const busQ = useQuery({
    queryKey: ["bus", tenantId],
    queryFn: () => busFn({ data: { tenant_id: tenantId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["groups", tenantId] });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [buId, setBuId] = useState<string>("");

  const mCreate = useMutation({
    mutationFn: () => createFn({
      data: { tenant_id: tenantId, name, description: desc || undefined, bu_id: buId || undefined },
    }),
    onSuccess: () => {
      toast.success("Group created"); setOpen(false);
      setName(""); setDesc(""); setBuId("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const groups = groupsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Groups</h2>
          <p className="text-sm text-muted-foreground">
            Bundle users; assign roles in bulk. Optionally scope a group to a Business Unit.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canWrite}><Plus className="mr-1 h-4 w-4" /> New group</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create group</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="EMEA Cash Ops Analysts" /></div>
              <div><Label>Description</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
              <div>
                <Label>Business Unit (optional)</Label>
                <Select value={buId} onValueChange={setBuId}>
                  <SelectTrigger><SelectValue placeholder="Tenant-wide (no BU)" /></SelectTrigger>
                  <SelectContent>
                    {(busQ.data ?? []).map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" disabled={!name || mCreate.isPending} onClick={() => mCreate.mutate()}>
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g: any) => (
          <GroupCard
            key={g.id} group={g} canWrite={canWrite}
            members={membersQ.data ?? []}
            roles={rolesQ.data ?? []}
            bus={busQ.data ?? []}
            onDelete={async () => {
              if (!confirm(`Delete group "${g.name}"?`)) return;
              try { await delFn({ data: { tenant_id: tenantId, group_id: g.id } }); invalidate(); }
              catch (e: any) { toast.error(e.message); }
            }}
            onRoles={async (roleIds: string[]) => {
              await rolesFn({ data: { tenant_id: tenantId, group_id: g.id, role_ids: roleIds } });
              invalidate();
            }}
            onAdd={async (uid: string) => {
              await addFn({ data: { tenant_id: tenantId, group_id: g.id, user_id: uid } }); invalidate();
            }}
            onRemove={async (uid: string) => {
              await remFn({ data: { tenant_id: tenantId, group_id: g.id, user_id: uid } }); invalidate();
            }}
          />
        ))}
        {groups.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No groups. Use the Presets tab to seed plug-and-play groups, or create a custom one.
          </CardContent></Card>
        ) : null}
      </div>
    </div>
  );
}

function GroupCard({ group, canWrite, members, roles, bus, onDelete, onRoles, onAdd, onRemove }: any) {
  const [pickedRole, setPickedRole] = useState<string>("");
  const [pickedUser, setPickedUser] = useState<string>("");

  const memberIds: string[] = group.member_ids ?? [];
  const roleIds: string[] = group.role_ids ?? [];
  const candidates = (members ?? []).filter((m: any) => !memberIds.includes(m.user_id));
  const bu = (bus ?? []).find((b: any) => b.id === group.bu_id);

  const roleLabel = (id: string) => {
    const r = (roles ?? []).find((x: any) => x.id === id);
    return r?.name ?? id.slice(0, 8);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" /> {group.name}
            {group.is_system ? (
              <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" />System</Badge>
                </TooltipTrigger>
                <TooltipContent>Preset group — editable, but cannot be deleted.</TooltipContent>
              </Tooltip></TooltipProvider>
            ) : null}
            {bu ? (
              <Badge variant="outline" className="gap-1"><Building2 className="h-3 w-3" />{bu.name}</Badge>
            ) : null}
          </span>
          {canWrite && !group.is_system ? (
            <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          ) : null}
        </CardTitle>
        <CardDescription>{group.description ?? "—"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="mb-2 flex items-center gap-1 text-xs uppercase text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Roles
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {roleIds.map((rid) => (
              <Badge key={rid} variant="outline" className="gap-1">
                {roleLabel(rid)}
                {canWrite ? (
                  <button
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() => onRoles(roleIds.filter((x) => x !== rid))}
                  >×</button>
                ) : null}
              </Badge>
            ))}
            {canWrite ? (
              <div className="flex items-center gap-1">
                <Select value={pickedRole} onValueChange={setPickedRole}>
                  <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Add role…" /></SelectTrigger>
                  <SelectContent>
                    {(roles ?? []).filter((r: any) => !roleIds.includes(r.id)).map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} {r.is_system ? "" : "(custom)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!pickedRole} onClick={() => {
                  onRoles(Array.from(new Set([...roleIds, pickedRole]))); setPickedRole("");
                }}>Add</Button>
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs uppercase text-muted-foreground">Members ({memberIds.length})</div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {memberIds.map((uid) => {
              const m = (members ?? []).find((x: any) => x.user_id === uid);
              return (
                <div key={uid} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
                  <span>{m?.email ?? uid.slice(0, 8)}</span>
                  {canWrite ? (
                    <Button size="icon" variant="ghost" onClick={() => onRemove(uid)}><Trash2 className="h-3 w-3" /></Button>
                  ) : null}
                </div>
              );
            })}
            {canWrite && candidates.length ? (
              <div className="flex items-center gap-1">
                <Select value={pickedUser} onValueChange={setPickedUser}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Add member…" /></SelectTrigger>
                  <SelectContent>
                    {candidates.map((c: any) => (
                      <SelectItem key={c.user_id} value={c.user_id}>{c.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!pickedUser} onClick={() => { onAdd(pickedUser); setPickedUser(""); }}>Add</Button>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Presets tab ------------------------------ */

function PresetsList({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const presetsFn = useServerFn(listGroupPresets);
  const reseedFn = useServerFn(reseedPresetGroups);
  const presetsQ = useQuery({ queryKey: ["group-presets"], queryFn: () => presetsFn() });

  const mReseed = useMutation({
    mutationFn: () => reseedFn({ data: { tenant_id: tenantId } }),
    onSuccess: (r: any) => {
      toast.success(`Refreshed ${r.count ?? 0} preset groups`);
      qc.invalidateQueries({ queryKey: ["groups", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Plug-and-Play Group Presets</h2>
          <p className="text-sm text-muted-foreground">
            Battle-tested role bundles automatically created for every tenant. Edit members in the Groups tab.
          </p>
        </div>
        <Button disabled={!canWrite || mReseed.isPending} onClick={() => mReseed.mutate()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Re-seed presets
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(presetsQ.data ?? []).map((p: any) => (
          <Card key={p.preset_key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" /> {p.name}
              </CardTitle>
              <CardDescription>{p.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xs uppercase text-muted-foreground mb-1">Roles bundled</div>
              <div className="flex flex-wrap gap-1">
                {(p.role_keys ?? []).map((k: string) => (
                  <Badge key={k} variant="outline">{k}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ----------------------- Effective Permissions tool ----------------------- */

function InspectPermissions({ tenantId }: { tenantId: string }) {
  const membersFn = useServerFn(listTenantMembers);
  const busFn = useServerFn(listBusinessUnits);
  const effFn = useServerFn(effectivePermissions);

  const membersQ = useQuery({
    queryKey: ["members", tenantId],
    queryFn: async () => {
      const rows = await membersFn({ data: { tenant_id: tenantId } });
      return (rows ?? []).map((r: any) => ({ user_id: r.user_id, email: r.profile?.email ?? r.user_id.slice(0, 8) }));
    },
  });
  const busQ = useQuery({ queryKey: ["bus", tenantId], queryFn: () => busFn({ data: { tenant_id: tenantId } }) });

  const [userId, setUserId] = useState<string>("");
  const [buId, setBuId] = useState<string>("");

  const effQ = useQuery({
    queryKey: ["eff-perms", tenantId, userId, buId],
    queryFn: () => effFn({ data: { tenant_id: tenantId, user_id: userId, bu_id: buId || undefined } }),
    enabled: !!userId,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, { sources: Set<string>; group_ids: Set<string> }>();
    (effQ.data ?? []).forEach((r: any) => {
      const k = r.permission_id as string;
      if (!map.has(k)) map.set(k, { sources: new Set(), group_ids: new Set() });
      const e = map.get(k)!;
      e.sources.add(r.source);
      if (r.group_id) e.group_ids.add(r.group_id);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [effQ.data]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4" /> Effective Permissions Inspector</CardTitle>
          <CardDescription>
            Resolve what a user can actually do — combining direct grants, group memberships, and BU-scoped assignments.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>User</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Choose user…" /></SelectTrigger>
              <SelectContent>
                {(membersQ.data ?? []).map((m: any) => (
                  <SelectItem key={m.user_id} value={m.user_id}>{m.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Business Unit (optional)</Label>
            <Select value={buId || "__all__"} onValueChange={(v) => setBuId(v === "__all__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Tenant-wide" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Tenant-wide</SelectItem>
                {(busQ.data ?? []).map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <div className="text-sm text-muted-foreground">
              {userId ? `${grouped.length} effective permissions` : "Pick a user to inspect."}
            </div>
          </div>
        </CardContent>
      </Card>

      {userId ? (
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="h-[480px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-xs uppercase">
                  <tr><th className="px-3 py-2 text-left">Permission</th><th className="px-3 py-2 text-left">Source</th></tr>
                </thead>
                <tbody>
                  {grouped.map(([perm, info]) => (
                    <tr key={perm} className="border-t">
                      <td className="px-3 py-1.5 font-mono text-xs">{perm}</td>
                      <td className="px-3 py-1.5">
                        {Array.from(info.sources).map((s) => (
                          <Badge key={s} variant="outline" className="mr-1">{s}</Badge>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {grouped.length === 0 ? (
                    <tr><td colSpan={2} className="px-3 py-8 text-center text-muted-foreground">No permissions resolved.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
