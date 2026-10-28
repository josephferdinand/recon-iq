import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTenantMembers, inviteMember, listInvitations, revokeInvitation,
  updateMemberRole, removeMember, assignableForInvite,
} from "@/lib/members.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, UserPlus, Trash2, ShieldCheck, Building2 } from "lucide-react";
import { toast } from "sonner";

type CoarseRole = "tenant_admin" | "tenant_analyst" | "tenant_viewer";

interface InviteForm {
  email: string;
  full_name: string;
  role: CoarseRole;
  role_ids: string[];
  group_ids: string[];
  bu_id: string | undefined;
}

const EMPTY_FORM: InviteForm = {
  email: "", full_name: "", role: "tenant_analyst", role_ids: [], group_ids: [], bu_id: undefined,
};

export function MembersTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listM = useServerFn(listTenantMembers);
  const listI = useServerFn(listInvitations);
  const invite = useServerFn(inviteMember);
  const revokeI = useServerFn(revokeInvitation);
  const updateR = useServerFn(updateMemberRole);
  const remove = useServerFn(removeMember);
  const loadOptions = useServerFn(assignableForInvite);

  const membersQ = useQuery({ queryKey: ["members", tenantId], queryFn: () => listM({ data: { tenant_id: tenantId } }) });
  const invitesQ = useQuery({ queryKey: ["invites", tenantId], queryFn: () => listI({ data: { tenant_id: tenantId } }) });
  const optionsQ = useQuery({
    queryKey: ["invite-options", tenantId],
    queryFn: () => loadOptions({ data: { tenant_id: tenantId } }),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<InviteForm>(EMPTY_FORM);
  const [issuedInvite, setIssuedInvite] = useState<{ email: string; token: string; link: string } | null>(null);

  const mInvite = useMutation({
    mutationFn: () => invite({ data: { tenant_id: tenantId, ...form, full_name: form.full_name.trim() || undefined } }),
    onSuccess: (row: any) => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const link = `${origin}/accept-invite?token=${encodeURIComponent(row.token)}`;
      setIssuedInvite({ email: row.email, token: row.token, link });
      toast.success("Invitation created — share the link with the invitee");
      setOpen(false); setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["invites", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const roles = optionsQ.data?.roles ?? [];
  const groups = optionsQ.data?.groups ?? [];
  const businessUnits = optionsQ.data?.business_units ?? [];

  const roleLookup = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const groupLookup = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const buLookup = useMemo(() => new Map(businessUnits.map((b) => [b.id, b])), [businessUnits]);

  const toggle = (key: "role_ids" | "group_ids", id: string, checked: boolean) =>
    setForm((f) => ({
      ...f,
      [key]: checked ? Array.from(new Set([...f[key], id])) : f[key].filter((x) => x !== id),
    }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" />Tenant members</CardTitle>
            <CardDescription>Invite users with selectable RBAC roles, groups, and Business-Unit scope.</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><UserPlus className="mr-1 h-4 w-4" />Invite</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Invite a member</DialogTitle></DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <Label>Full name</Label>
                    <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Jane Doe" maxLength={120} />
                    <p className="mt-1 text-xs text-muted-foreground">Displayed across the app until the user updates their profile.</p>
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@company.com" />
                  </div>
                  <div>
                    <Label>Base membership role</Label>
                    <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as CoarseRole })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tenant_admin">Tenant admin</SelectItem>
                        <SelectItem value="tenant_analyst">Tenant analyst</SelectItem>
                        <SelectItem value="tenant_viewer">Tenant viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Required coarse role. Add granular permissions via roles/groups below.
                    </p>
                  </div>
                  <div>
                    <Label className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />Business Unit scope (optional)</Label>
                    <Select
                      value={form.bu_id ?? "__none__"}
                      onValueChange={(v) => setForm({ ...form, bu_id: v === "__none__" ? undefined : v })}
                    >
                      <SelectTrigger><SelectValue placeholder="No scope (tenant-wide)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No scope (tenant-wide)</SelectItem>
                        {businessUnits.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      If set, the user's direct grants below are restricted to this BU.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Direct roles</Label>
                    <ScrollArea className="mt-1 h-40 rounded border p-2">
                      <div className="space-y-1.5">
                        {roles.map((r) => (
                          <label key={r.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={form.role_ids.includes(r.id)}
                              onCheckedChange={(c) => toggle("role_ids", r.id, c === true)}
                            />
                            <span className="font-mono text-xs">{r.key}</span>
                            <span className="text-muted-foreground">— {r.name}</span>
                            {r.is_system ? <Badge variant="secondary" className="ml-auto text-[10px]">system</Badge> : null}
                          </label>
                        ))}
                        {!roles.length && <p className="text-xs text-muted-foreground">No roles available.</p>}
                      </div>
                    </ScrollArea>
                  </div>

                  <div>
                    <Label className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />Groups</Label>
                    <ScrollArea className="mt-1 h-40 rounded border p-2">
                      <div className="space-y-1.5">
                        {groups.map((g) => (
                          <label key={g.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={form.group_ids.includes(g.id)}
                              onCheckedChange={(c) => toggle("group_ids", g.id, c === true)}
                            />
                            <span>{g.name}</span>
                            {g.is_system ? <Badge variant="secondary" className="ml-auto text-[10px]">preset</Badge> : null}
                          </label>
                        ))}
                        {!groups.length && <p className="text-xs text-muted-foreground">No groups available.</p>}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              </div>
              <DialogFooter className="mt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  disabled={!form.email || mInvite.isPending}
                  onClick={() => mInvite.mutate()}
                >
                  {mInvite.isPending ? "Sending…" : "Send invitation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Joined</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(membersQ.data ?? []).map((m: any) => (
                <tr key={m.id} className="border-b">
                  <td className="px-4 py-2 font-medium">{m.profile?.full_name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{m.profile?.email ?? m.user_id}</td>
                  <td className="px-4 py-2">
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        updateR({ data: { tenant_id: tenantId, user_id: m.user_id, role: v as CoarseRole } })
                          .then(() => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["members", tenantId] }); })
                          .catch((e: any) => toast.error(e.message))
                      }
                    >
                      <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tenant_admin">tenant_admin</SelectItem>
                        <SelectItem value="tenant_analyst">tenant_analyst</SelectItem>
                        <SelectItem value="tenant_viewer">tenant_viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(m.joined_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="ghost" size="icon"
                      onClick={() =>
                        remove({ data: { tenant_id: tenantId, user_id: m.user_id } })
                          .then(() => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["members", tenantId] }); })
                          .catch((e: any) => toast.error(e.message))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending invitations</CardTitle>
          <CardDescription>Tokens are stored only as SHA-256 hashes. Share the raw token shown at creation time over a trusted channel.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Invitee</th>
                <th className="px-4 py-2">Base role</th>
                <th className="px-4 py-2">Direct roles</th>
                <th className="px-4 py-2">Groups</th>
                <th className="px-4 py-2">BU</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(invitesQ.data ?? []).map((i: any) => (
                <tr key={i.id} className="border-b align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium">{i.full_name || <span className="text-muted-foreground">—</span>}</div>
                    <div className="text-xs text-muted-foreground">{i.email}</div>
                  </td>
                  <td className="px-4 py-2"><Badge variant="outline">{i.role}</Badge></td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(i.role_ids ?? []).map((rid: string) => (
                        <Badge key={rid} variant="secondary" className="text-[10px]">
                          {roleLookup.get(rid)?.key ?? rid.slice(0, 6)}
                        </Badge>
                      ))}
                      {!(i.role_ids ?? []).length && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(i.group_ids ?? []).map((gid: string) => (
                        <Badge key={gid} variant="secondary" className="text-[10px]">
                          {groupLookup.get(gid)?.name ?? gid.slice(0, 6)}
                        </Badge>
                      ))}
                      {!(i.group_ids ?? []).length && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {i.bu_id ? (buLookup.get(i.bu_id)?.name ?? i.bu_id.slice(0, 6)) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(i.expires_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{i.accepted_at ? <Badge>accepted</Badge> : <Badge variant="outline">pending</Badge>}</td>
                  <td className="px-4 py-2 text-right">
                    {!i.accepted_at ? (
                      <Button
                        variant="ghost" size="icon"
                        onClick={() =>
                          revokeI({ data: { id: i.id } })
                            .then(() => qc.invalidateQueries({ queryKey: ["invites", tenantId] }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {invitesQ.data && invitesQ.data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No pending invitations.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!issuedInvite} onOpenChange={(o) => !o && setIssuedInvite(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Invitation ready to share</DialogTitle>
          </DialogHeader>
          {issuedInvite ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Send this link to <span className="font-medium text-foreground">{issuedInvite.email}</span>.
                They must sign in with that email address, then the invitation will be accepted automatically.
              </p>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">One-click accept link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={issuedInvite.link} onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(issuedInvite.link);
                      toast.success("Link copied");
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Raw token (fallback)</Label>
                <div className="flex gap-2">
                  <Input readOnly value={issuedInvite.token} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(issuedInvite.token);
                      toast.success("Token copied");
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                For security, this token is stored only as a hash. Close this dialog and it cannot be shown again — you would need to revoke and reissue.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setIssuedInvite(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
