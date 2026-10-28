/**
 * @deprecated Platform-only groups tab — will fold into scope-aware
 * `<GroupsTab />` per APP_RATIONALIZATION_2026-07-17 QW#9. Do not extend.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listPlatformGroups, createPlatformGroup, setPlatformGroupRoles,
  listPlatformGroupMembers, addPlatformGroupMember, removePlatformGroupMember,
  searchPlatformUsers,
} from "@/lib/platform-groups.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DeprecatedBanner } from "@/components/deprecated-banner";
import { Users, Plus, Trash2, UserPlus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const ROLES = ["platform_admin", "platform_member", "platform_super_admin"] as const;
type PRole = typeof ROLES[number];

interface Group {
  id: string; name: string; description: string | null;
  roles: PRole[]; member_count: number;
  is_system?: boolean; preset_key?: string | null;
}

export function PlatformGroupsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPlatformGroups);
  const createFn = useServerFn(createPlatformGroup);
  const groups = useQuery({ queryKey: ["platform-groups"], queryFn: () => listFn() });

  const [openNew, setOpenNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [roles, setRoles] = useState<PRole[]>([]);
  const [active, setActive] = useState<Group | null>(null);

  const create = useMutation({
    mutationFn: () => createFn({ data: { name, description: desc || undefined, roles } }),
    onSuccess: () => {
      toast.success("Group created");
      setOpenNew(false); setName(""); setDesc(""); setRoles([]);
      qc.invalidateQueries({ queryKey: ["platform-groups"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (groups.data as Group[] | undefined) ?? [];

  return (
    <div className="space-y-4">
      <DeprecatedBanner
        successorLabel="Access hub — Groups (scope-aware)"
        successorHref="/hub/access"
        note="Platform-only groups will fold into the unified scope-aware Groups surface inside /hub/access."
      />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Platform Groups</CardTitle>
            <CardDescription>Assign platform roles to groups. Members inherit roles automatically.</CardDescription>
          </div>
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />New group</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create platform group</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>Description</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} /></div>
                <div>
                  <Label>Roles</Label>
                  <div className="space-y-2 mt-2">
                    {ROLES.map((r) => (
                      <div key={r} className="flex items-center gap-2">
                        <Checkbox
                          id={`new-${r}`}
                          checked={roles.includes(r)}
                          onCheckedChange={(c) => setRoles(c ? [...roles, r] : roles.filter((x) => x !== r))}
                        />
                        <Label htmlFor={`new-${r}`} className="font-mono text-xs">{r}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenNew(false)}>Cancel</Button>
                <Button onClick={() => create.mutate()} disabled={name.length < 2 || create.isPending}>
                  {create.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {list.map((g) => (
              <Card key={g.id} className="cursor-pointer hover:bg-accent/30" onClick={() => setActive(g)}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {g.name}
                    {g.is_system ? <Badge variant="secondary" className="text-[10px]">System</Badge> : null}
                  </CardTitle>
                  <CardDescription>{g.description ?? "—"}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  {g.roles.map((r) => (
                    <Badge key={r} variant="secondary" className="text-[10px]">
                      <ShieldCheck className="h-3 w-3 mr-1" />{r}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="ml-auto text-[10px]">{g.member_count} members</Badge>
                </CardContent>
              </Card>
            ))}
            {!list.length && !groups.isLoading && (
              <p className="text-sm text-muted-foreground">No groups yet. Create your first group above.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {active && <GroupDetailDialog group={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function GroupDetailDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const qc = useQueryClient();
  const setRolesFn = useServerFn(setPlatformGroupRoles);
  const listMembersFn = useServerFn(listPlatformGroupMembers);
  const addMemberFn = useServerFn(addPlatformGroupMember);
  const rmMemberFn = useServerFn(removePlatformGroupMember);
  const searchFn = useServerFn(searchPlatformUsers);

  const [roles, setRoles] = useState<PRole[]>(group.roles);
  const [q, setQ] = useState("");

  const members = useQuery({
    queryKey: ["pg-members", group.id],
    queryFn: () => listMembersFn({ data: { group_id: group.id } }),
  });
  const search = useQuery({
    queryKey: ["pg-search", q], enabled: q.length > 1,
    queryFn: () => searchFn({ data: { q } }),
  });

  const saveRoles = useMutation({
    mutationFn: () => setRolesFn({ data: { group_id: group.id, roles } }),
    onSuccess: () => { toast.success("Roles saved"); qc.invalidateQueries({ queryKey: ["platform-groups"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const addM = useMutation({
    mutationFn: (uid: string) => addMemberFn({ data: { group_id: group.id, user_id: uid } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pg-members", group.id] }); qc.invalidateQueries({ queryKey: ["platform-groups"] }); setQ(""); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rmM = useMutation({
    mutationFn: (uid: string) => rmMemberFn({ data: { group_id: group.id, user_id: uid } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pg-members", group.id] }); qc.invalidateQueries({ queryKey: ["platform-groups"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{group.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Roles</Label>
            <div className="flex flex-wrap gap-3 mt-2">
              {ROLES.map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <Checkbox
                    id={`r-${r}`}
                    checked={roles.includes(r)}
                    onCheckedChange={(c) => setRoles(c ? [...roles, r] : roles.filter((x) => x !== r))}
                  />
                  <Label htmlFor={`r-${r}`} className="font-mono text-xs">{r}</Label>
                </div>
              ))}
            </div>
            <Button size="sm" className="mt-2" onClick={() => saveRoles.mutate()} disabled={saveRoles.isPending}>
              {saveRoles.isPending ? "Saving…" : "Save roles"}
            </Button>
          </div>

          <div>
            <Label>Add member</Label>
            <Input placeholder="Search by email or name…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q.length > 1 && (
              <div className="mt-2 max-h-40 overflow-auto border rounded">
                {((search.data as any[]) ?? []).map((u) => (
                  <button
                    key={u.id} type="button"
                    className="flex w-full items-center justify-between px-3 py-2 hover:bg-accent text-left text-sm"
                    onClick={() => addM.mutate(u.id)}
                  >
                    <span>{u.full_name ?? u.email}</span>
                    <UserPlus className="h-4 w-4" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Members</Label>
            <div className="space-y-1 mt-2">
              {((members.data as any[]) ?? []).map((m) => (
                <div key={m.user_id} className="flex items-center justify-between border rounded px-3 py-2">
                  <div className="text-sm">
                    <div>{m.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => rmM.mutate(m.user_id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {!members.data?.length && <p className="text-xs text-muted-foreground">No members yet.</p>}
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
