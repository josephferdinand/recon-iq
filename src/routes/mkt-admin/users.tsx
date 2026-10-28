import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listMktAdmins, grantMktRole, revokeMktRole, mktRoles } from "@/lib/mkt-admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/mkt-admin/users")({
  component: Users,
});

function Users() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMktAdmins);
  const grantFn = useServerFn(grantMktRole);
  const revokeFn = useServerFn(revokeMktRole);
  const q = useQuery({ queryKey: ["mkt","admins"], queryFn: () => listFn({ data: undefined }) });
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<(typeof mktRoles._def.values)[number]>("sales_admin");
  const grantMut = useMutation({
    mutationFn: () => grantFn({ data: { user_id: userId, role } }),
    onSuccess: () => { toast.success("Role granted"); setUserId(""); qc.invalidateQueries({ queryKey: ["mkt","admins"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const revokeMut = useMutation({
    mutationFn: (v: { user_id: string; role: (typeof mktRoles._def.values)[number] }) => revokeFn({ data: v }),
    onSuccess: () => { toast.success("Revoked"); qc.invalidateQueries({ queryKey: ["mkt","admins"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold">Users & roles</h1>

      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Grant role</h3>
        <div className="grid gap-3 md:grid-cols-[1fr_200px_auto]">
          <div><Label>User ID (auth.users.id UUID)</Label><Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="e.g. 3f0…" /></div>
          <div><Label htmlFor="mkt-admin-role">Role</Label>
            <select id="mkt-admin-role" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {mktRoles._def.values.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-end"><Button onClick={() => grantMut.mutate()} disabled={!userId || grantMut.isPending}>Grant</Button></div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Current admins</div>
        <ul className="divide-y divide-border">
          {(q.data ?? []).map((r) => {
            const u = (r as unknown as { mkt_admin_users?: { display_name?: string | null } }).mkt_admin_users;
            return (
              <li key={`${r.user_id}-${r.role}`} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm font-medium">{u?.display_name ?? r.user_id}</div>
                  <div className="text-xs text-muted-foreground">{r.user_id}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge>{r.role}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => revokeMut.mutate({ user_id: r.user_id, role: r.role })}>Revoke</Button>
                </div>
              </li>
            );
          })}
          {(q.data ?? []).length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">No admins.</li>}
        </ul>
      </section>
    </div>
  );
}
