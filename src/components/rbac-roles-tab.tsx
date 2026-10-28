import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listRoles, listRolePermissions, listPermissions, cloneRole, listSodRules,
  createCustomRole, updateRoleMeta, updateRolePermissions, deleteCustomRole,
} from "@/lib/rbac.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, Copy, AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Role {
  id: string; tenant_id: string | null; key: string; name: string;
  description: string | null; is_system: boolean; is_assignable: boolean;
  cloned_from: string | null;
}
interface Permission {
  id: string; resource: string; action: string; description: string;
  category: string; is_dangerous: boolean; requires_step_up: boolean;
}

type ScopeFilter = "all" | "platform" | "tenant";

export function RbacRolesTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listR = useServerFn(listRoles);
  const listP = useServerFn(listPermissions);
  const listRP = useServerFn(listRolePermissions);
  const listSoD = useServerFn(listSodRules);
  const clone = useServerFn(cloneRole);
  const createFn = useServerFn(createCustomRole);
  const updateMetaFn = useServerFn(updateRoleMeta);
  const updatePermsFn = useServerFn(updateRolePermissions);
  const deleteFn = useServerFn(deleteCustomRole);

  const rolesQ = useQuery({ queryKey: ["rbac-roles", tenantId], queryFn: () => listR({ data: { tenant_id: tenantId } }) });
  const permsQ = useQuery({ queryKey: ["rbac-perms"], queryFn: () => listP() });
  const sodQ = useQuery({ queryKey: ["rbac-sod", tenantId], queryFn: () => listSoD({ data: { tenant_id: tenantId } }) });

  const [scope, setScope] = useState<ScopeFilter>("all");
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const rolePermsQ = useQuery({
    queryKey: ["rbac-role-perms", selectedRole?.id],
    queryFn: () => listRP({ data: { role_id: selectedRole!.id } }),
    enabled: !!selectedRole,
  });

  /* ---- Edit state (custom roles) ---- */
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedRole) { setEditing(false); return; }
    setEditing(false);
    setEditName(selectedRole.name);
    setEditDesc(selectedRole.description ?? "");
    setEditPerms(new Set(rolePermsQ.data ?? []));
  }, [selectedRole?.id, rolePermsQ.data]);

  /* ---- Mutations ---- */
  const mClone = useMutation({
    mutationFn: () => clone({
      data: {
        tenant_id: tenantId,
        source_role_id: selectedRole!.id,
        name: cloneName,
        description: cloneDesc || undefined,
        permission_ids: Array.from(clonePerms),
      },
    }),
    onSuccess: () => {
      toast.success(`Custom role "${cloneName}" created`);
      setCloneOpen(false); setCloneName(""); setCloneDesc(""); setClonePerms(new Set());
      qc.invalidateQueries({ queryKey: ["rbac-roles", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mCreate = useMutation({
    mutationFn: () => createFn({
      data: {
        tenant_id: tenantId, name: newName, description: newDesc || undefined,
        permission_ids: Array.from(newPerms),
      },
    }),
    onSuccess: () => {
      toast.success(`Role "${newName}" created`);
      setNewOpen(false); setNewName(""); setNewDesc(""); setNewPerms(new Set());
      qc.invalidateQueries({ queryKey: ["rbac-roles", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mSave = useMutation({
    mutationFn: async () => {
      if (!selectedRole) return;
      const metaChanged = editName !== selectedRole.name || editDesc !== (selectedRole.description ?? "");
      if (metaChanged) {
        await updateMetaFn({ data: { role_id: selectedRole.id, name: editName, description: editDesc || null } });
      }
      await updatePermsFn({ data: { role_id: selectedRole.id, permission_ids: Array.from(editPerms) } });
    },
    onSuccess: () => {
      toast.success("Role updated");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["rbac-roles", tenantId] });
      qc.invalidateQueries({ queryKey: ["rbac-role-perms", selectedRole?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mDelete = useMutation({
    mutationFn: () => deleteFn({ data: { role_id: selectedRole!.id } }),
    onSuccess: () => {
      toast.success("Role deleted");
      setSelectedRole(null);
      qc.invalidateQueries({ queryKey: ["rbac-roles", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allRoles = (rolesQ.data as Role[] | undefined) ?? [];
  const roles = useMemo(() => allRoles.filter((r) => {
    if (scope === "platform") return r.tenant_id === null;
    if (scope === "tenant")   return r.tenant_id !== null;
    return true;
  }), [allRoles, scope]);
  const perms = (permsQ.data as Permission[] | undefined) ?? [];
  const savedRolePerms = new Set(rolePermsQ.data ?? []);
  const displayPerms = editing ? editPerms : savedRolePerms;
  const permsByCategory = perms.reduce<Record<string, Permission[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  /* ---- Clone dialog state ---- */
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneDesc, setCloneDesc] = useState("");
  const [clonePerms, setClonePerms] = useState<Set<string>>(new Set());
  function openClone() {
    if (!selectedRole) return;
    setCloneName(`${selectedRole.name} (copy)`);
    setCloneDesc(selectedRole.description ?? "");
    setClonePerms(new Set(savedRolePerms));
    setCloneOpen(true);
  }

  /* ---- New-role dialog state ---- */
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPerms, setNewPerms] = useState<Set<string>>(new Set());

  function togglePerm(set: Set<string>, setSet: (s: Set<string>) => void, pid: string, on: boolean) {
    const next = new Set(set);
    if (on) next.add(pid); else next.delete(pid);
    setSet(next);
  }

  const canEditSelected = !!selectedRole && !selectedRole.is_system && selectedRole.tenant_id !== null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <Card className="lg:col-span-4">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Roles</CardTitle>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New role
            </Button>
          </div>
          <CardDescription>System and custom roles. Filter by scope.</CardDescription>
          <Tabs value={scope} onValueChange={(v) => setScope(v as ScopeFilter)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="platform">Platform</TabsTrigger>
              <TabsTrigger value="tenant">Tenant</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[480px]">
            <div className="divide-y">
              {roles.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRole(r)}
                  className={`w-full text-left px-4 py-3 hover:bg-muted/50 ${selectedRole?.id === r.id ? "bg-muted" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{r.name}</span>
                    <div className="flex gap-1 shrink-0">
                      {r.tenant_id === null ? <Badge variant="outline">Platform</Badge> : <Badge variant="outline">Tenant</Badge>}
                      {r.is_system ? <Badge variant="secondary">System</Badge> : <Badge>Custom</Badge>}
                    </div>
                  </div>
                  {r.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>}
                </button>
              ))}
              {roles.length === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground">No roles in this scope.</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="lg:col-span-8">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editing && canEditSelected ? (
              <div className="space-y-2">
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-base font-semibold" />
                <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} placeholder="Description" />
              </div>
            ) : (
              <>
                <CardTitle>{selectedRole ? selectedRole.name : "Select a role"}</CardTitle>
                <CardDescription>
                  {selectedRole
                    ? `${displayPerms.size} of ${perms.length} permissions${selectedRole.is_system ? " (read-only)" : ""}`
                    : "View the permission matrix or create / clone a role."}
                </CardDescription>
              </>
            )}
          </div>
          {selectedRole && (
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={openClone}>
                <Copy className="h-4 w-4 mr-1" /> Clone & narrow
              </Button>
              {canEditSelected && !editing && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {canEditSelected && editing && (
                <>
                  <Button size="sm" onClick={() => mSave.mutate()} disabled={mSave.isPending}>
                    <Save className="h-4 w-4 mr-1" />
                    {mSave.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    setEditing(false);
                    setEditName(selectedRole.name);
                    setEditDesc(selectedRole.description ?? "");
                    setEditPerms(new Set(savedRolePerms));
                  }}>Cancel</Button>
                </>
              )}
              {canEditSelected && !editing && (
                <Button size="sm" variant="destructive" onClick={() => {
                  if (confirm(`Delete role "${selectedRole.name}"? This cannot be undone.`)) mDelete.mutate();
                }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {selectedRole ? (
            <ScrollArea className="h-[460px] pr-4">
              <div className="space-y-4">
                {Object.entries(permsByCategory).map(([cat, ps]) => (
                  <div key={cat}>
                    <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{cat}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {ps.map((p) => {
                        const on = displayPerms.has(p.id);
                        return (
                          <label
                            key={p.id}
                            className={`flex items-start gap-2 p-2 rounded border ${editing && canEditSelected ? "cursor-pointer hover:bg-muted/40" : ""}`}
                          >
                            {editing && canEditSelected ? (
                              <Checkbox
                                checked={on}
                                onCheckedChange={(c) => togglePerm(editPerms, setEditPerms, p.id, !!c)}
                              />
                            ) : (
                              <div className={`h-2 w-2 rounded-full mt-1.5 ${on ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-mono truncate">{p.id}</p>
                              <p className="text-xs text-muted-foreground">{p.description}</p>
                            </div>
                            {p.is_dangerous && <Badge variant="destructive" className="text-[10px]">Dangerous</Badge>}
                            {p.requires_step_up && <Badge variant="outline" className="text-[10px]">Step-up</Badge>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground">Select a role from the list to view its permission matrix.</p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-12">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Separation of Duties</CardTitle>
          <CardDescription>Pairs of permissions a single user cannot hold simultaneously.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {((sodQ.data as any[]) ?? []).map((r) => (
              <div key={r.id} className="flex items-start gap-2 p-3 rounded border">
                <Badge variant={r.severity === "block" ? "destructive" : "secondary"}>{r.severity}</Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                  <p className="text-xs font-mono mt-1">{r.permission_a} ⨉ {r.permission_b}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Clone dialog */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Clone & narrow role</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} /></div>
            <div><Label>Description</Label><Input value={cloneDesc} onChange={(e) => setCloneDesc(e.target.value)} /></div>
            <div>
              <Label>Permissions ({clonePerms.size} selected)</Label>
              <ScrollArea className="h-72 mt-2 border rounded p-2">
                {perms.filter((p) => savedRolePerms.has(p.id)).map((p) => (
                  <label key={p.id} className="flex items-center gap-2 py-1 cursor-pointer">
                    <Checkbox
                      checked={clonePerms.has(p.id)}
                      onCheckedChange={(c) => togglePerm(clonePerms, setClonePerms, p.id, !!c)}
                    />
                    <span className="text-sm font-mono">{p.id}</span>
                  </label>
                ))}
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneOpen(false)}>Cancel</Button>
            <Button onClick={() => mClone.mutate()} disabled={!cloneName || clonePerms.size === 0 || mClone.isPending}>
              {mClone.isPending ? "Creating…" : "Create custom role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New role dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Create custom tenant role</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Settlements Analyst" /></div>
            <div><Label>Description</Label><Textarea rows={2} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} /></div>
            <div>
              <Label>Permissions ({newPerms.size} selected)</Label>
              <ScrollArea className="h-80 mt-2 border rounded p-3">
                <div className="space-y-4">
                  {Object.entries(permsByCategory).map(([cat, ps]) => (
                    <div key={cat}>
                      <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{cat}</h4>
                      {ps.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 py-1 cursor-pointer">
                          <Checkbox
                            checked={newPerms.has(p.id)}
                            onCheckedChange={(c) => togglePerm(newPerms, setNewPerms, p.id, !!c)}
                          />
                          <span className="text-xs font-mono">{p.id}</span>
                          {p.is_dangerous && <Badge variant="destructive" className="text-[10px]">Dangerous</Badge>}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={() => mCreate.mutate()} disabled={!newName || mCreate.isPending}>
              {mCreate.isPending ? "Creating…" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
