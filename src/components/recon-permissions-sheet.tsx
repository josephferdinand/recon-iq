import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getReconAccess, setReconVisibility, grantReconPermission, revokeReconPermission } from "@/lib/recon-permissions.functions";
import { listGroups } from "@/lib/groups.functions";
import { listTenantMembers } from "@/lib/members.functions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";

const PERMS = ["read", "run", "edit", "approve"] as const;

export function ReconPermissionsSheet({ reconId, tenantId, trigger }: { reconId: string; tenantId: string; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger ?? <Button size="sm" variant="outline"><Lock className="mr-1 h-3 w-3" /> Permissions</Button>}</SheetTrigger>
      <SheetContent className="w-[420px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle>Rekon permissions</SheetTitle>
          <SheetDescription>Control who can read, run, edit and approve this recon.</SheetDescription>
        </SheetHeader>
        {open ? <Body reconId={reconId} tenantId={tenantId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({ reconId, tenantId }: { reconId: string; tenantId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getReconAccess);
  const visFn = useServerFn(setReconVisibility);
  const grantFn = useServerFn(grantReconPermission);
  const revokeFn = useServerFn(revokeReconPermission);
  const groupsFn = useServerFn(listGroups);
  const membersFn = useServerFn(listTenantMembers);

  const aQ = useQuery({ queryKey: ["recon-access", reconId], queryFn: () => getFn({ data: { recon_id: reconId } }) });
  const gQ = useQuery({ queryKey: ["groups", tenantId], queryFn: () => groupsFn({ data: { tenant_id: tenantId } }) });
  const mQ = useQuery({
    queryKey: ["members", tenantId],
    queryFn: async () => {
      const rows = await membersFn({ data: { tenant_id: tenantId } });
      return (rows ?? []).map((r: any) => ({ user_id: r.user_id, email: r.profile?.email ?? r.user_id.slice(0, 8) }));
    },
  });

  const [pType, setPType] = useState<"user" | "group">("user");
  const [pId, setPId] = useState("");
  const [perm, setPerm] = useState<typeof PERMS[number]>("read");
  const [message, setMessage] = useState<UserMessage | null>(null);

  function failure(error: unknown, action: string): UserMessage {
    const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
    const code = typeof candidate.code === "string" ? candidate.code : undefined;
    const status = typeof candidate.status === "number" ? candidate.status : undefined;
    const mapped = mapKnownFailure(code, status);
    const definite = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
    const category: UserMessageCategory = definite ? mapped.category : "unknown_write_outcome";
    return formatUserMessage({ ...mapped, category, action, code, status, availableActions: category === "unknown_write_outcome" ? [{ id: "check-permissions", label: "Refresh permission state" }] : [] });
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["recon-access", reconId] });

  const mVis = useMutation({
    mutationFn: (v: "tenant" | "restricted") => visFn({ data: { recon_id: reconId, visibility: v } }),
    onSuccess: () => { setMessage(null); toast.success("Visibility updated"); invalidate(); },
    onError: (error) => setMessage(failure(error, "change reconciliation visibility")),
  });
  const mGrant = useMutation({
    mutationFn: () => grantFn({ data: { recon_id: reconId, principal_type: pType, principal_id: pId, permission: perm } }),
    onSuccess: () => { setMessage(null); toast.success("Permission granted"); setPId(""); invalidate(); },
    onError: (error) => setMessage(failure(error, "grant this reconciliation permission")),
  });
  const mRev = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { permission_id: id } }),
    onSuccess: () => { setMessage(null); invalidate(); },
    onError: (error) => setMessage(failure(error, "revoke this reconciliation permission")),
  });

  if (aQ.isPending) return <div role="status" className="mt-6 text-sm text-muted-foreground">Loading reconciliation permissions…</div>;
  if (aQ.isError || !aQ.data) return <div role="alert" aria-live="assertive" className="mt-6 rounded-md border border-destructive/30 p-3 text-sm"><p>Reconciliation permissions could not be loaded, so no access changes can be confirmed.</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void aQ.refetch()}>Refresh permissions</Button></div>;
  const principals = pType === "group" ? (gQ.data ?? []).map((g: any) => ({ id: g.id, label: g.name }))
                                       : (mQ.data ?? []).map((m: any) => ({ id: m.user_id, label: m.email }));

  return (
    <div className="mt-4 space-y-5">
      {message ? <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">{message.title}</p><p className="mt-1">{message.humanMessage}</p>{message.nextActions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2" onClick={() => { if (action.id === "check-permissions") void aQ.refetch(); }}>{action.label}</Button>)}</div> : null}
      <div>
        <Label>Visibility</Label>
        <Select value={aQ.data.def.visibility} onValueChange={(v) => mVis.mutate(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tenant">Tenant — all members can read</SelectItem>
            <SelectItem value="restricted">Restricted — only admins + explicit grants</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border p-3 space-y-3">
        <div className="text-sm font-medium">Grant permission</div>
        {gQ.isError ? <div role="alert" className="text-xs text-destructive">Groups could not be loaded. <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => void gQ.refetch()}>Refresh groups</Button></div> : null}
        {mQ.isError ? <div role="alert" className="text-xs text-destructive">Tenant members could not be loaded. <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => void mQ.refetch()}>Refresh members</Button></div> : null}
        <div className="grid grid-cols-3 gap-2">
          <Select value={pType} onValueChange={(v) => { setPType(v as any); setPId(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="group">Group</SelectItem>
            </SelectContent>
          </Select>
          <Select value={pId} onValueChange={setPId}>
            <SelectTrigger><SelectValue placeholder="e.g. jane.doe@demo-bank.example or group:demo-bank-cash-ops-emea" /></SelectTrigger>
            <SelectContent>
              {principals.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={perm} onValueChange={(v) => setPerm(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERMS.map((p) => (<SelectItem key={p} value={p}>{p}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" disabled={!pId || mGrant.isPending || (pType === "group" ? gQ.isError : mQ.isError)} onClick={() => mGrant.mutate()}>Grant</Button>
      </div>

      <div>
        <Label>Active grants</Label>
        <div className="mt-2 space-y-1">
          {(aQ.data.perms ?? []).map((p: any) => {
            const label = p.principal_type === "group"
              ? (gQ.data ?? []).find((g: any) => g.id === p.principal_id)?.name ?? p.principal_id.slice(0,8)
              : (mQ.data ?? []).find((m: any) => m.user_id === p.principal_id)?.email ?? p.principal_id.slice(0,8);
            return (
              <div key={p.id} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
                <span><Badge variant="outline" className="mr-2">{p.principal_type}</Badge>{label}</span>
                <span className="flex items-center gap-2">
                  <Badge>{p.permission}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => mRev.mutate(p.id)}><Trash2 className="h-3 w-3" /></Button>
                </span>
              </div>
            );
          })}
          {aQ.data.perms.length === 0 ? <div className="text-xs text-muted-foreground">No explicit grants.</div> : null}
        </div>
      </div>
    </div>
  );
}
