// Platform · Sandbox access — per-tenant enable/disable for the 4th (lowest)
// environment. Only platform admins can reach this tab (backed by an RPC that
// re-checks the role server-side).
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTenantSandboxStatus,
  setTenantSandbox,
} from "@/lib/tenant-sandbox.functions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { FlaskConical, Layers } from "lucide-react";

type Row = {
  id: string; slug: string; name: string; environment: string;
  sandbox_enabled: boolean;
  sandbox_enabled_at: string | null;
  sandbox_expires_at: string | null;
  sandbox_notes: string | null;
};

export function PlatformSandboxTab() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listTenantSandboxStatus);
  const setFn = useServerFn(setTenantSandbox);

  const q = useQuery({
    queryKey: ["platform-tenant-sandbox"],
    queryFn: () => fetchList(),
  });

  const mut = useMutation({
    mutationFn: (input: { tenant_id: string; enabled: boolean; expires_at?: string | null; notes?: string | null }) =>
      setFn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-tenant-sandbox"] });
      toast.success("Sandbox updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [dialog, setDialog] = useState<Row | null>(null);
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");

  const rows: Row[] = q.data?.tenants ?? [];
  const enabledCount = rows.filter((r) => r.sandbox_enabled).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Environments per tenant</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Layers className="h-5 w-5" /> PROD · UAT · DEV · Sandbox
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            PROD / UAT / DEV are provisioned by default. <strong>Sandbox</strong> is the
            4th and lowest tier — off by default, enable per tenant.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tenants with sandbox enabled</CardDescription>
            <CardTitle className="text-2xl">{enabledCount} / {rows.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Sandbox host pattern: <code className="text-xs">&lt;slug&gt;-sandbox.reconiq.example</code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Data isolation posture</CardDescription>
            <CardTitle className="text-2xl">Logical (shared DB)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            All four envs share the Cloud Postgres today; separation is by
            <code className="mx-1 text-xs">tenant_id</code>+<code className="text-xs">env</code> + RLS.
            Physical per-env DBs require separate Cloud projects.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Sandbox access per tenant
          </CardTitle>
          <CardDescription>
            Enable the sandbox environment for a tenant. Optional expiry auto-disables it.
            Every change is audit-logged.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Tenant</th>
                  <th className="px-4 py-2">Slug</th>
                  <th className="px-4 py-2">Primary env</th>
                  <th className="px-4 py-2">Sandbox</th>
                  <th className="px-4 py-2">Enabled at</th>
                  <th className="px-4 py-2">Expires</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading && (<tr><td className="px-4 py-6 text-muted-foreground" colSpan={7}>Loading…</td></tr>)}
                {!q.isLoading && rows.length === 0 && (
                  <tr><td className="px-4 py-6 text-muted-foreground" colSpan={7}>No tenants.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.slug}</td>
                    <td className="px-4 py-2"><Badge variant="outline">{r.environment}</Badge></td>
                    <td className="px-4 py-2">
                      <Switch
                        checked={r.sandbox_enabled}
                        onCheckedChange={(v) => {
                          if (v) {
                            setDialog(r);
                            setExpiry("");
                            setNotes(r.sandbox_notes ?? "");
                          } else {
                            mut.mutate({ tenant_id: r.id, enabled: false });
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {r.sandbox_enabled_at ? new Date(r.sandbox_enabled_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {r.sandbox_expires_at ? new Date(r.sandbox_expires_at).toLocaleString() : (r.sandbox_enabled ? "no expiry" : "—")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.sandbox_enabled && (
                        <Button size="sm" variant="outline" onClick={() => {
                          setDialog(r);
                          setExpiry(r.sandbox_expires_at ? r.sandbox_expires_at.slice(0, 16) : "");
                          setNotes(r.sandbox_notes ?? "");
                        }}>Edit</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable sandbox — {dialog?.name}</DialogTitle>
            <DialogDescription>
              Sandbox host will be <code>{dialog?.slug}-sandbox.reconiq.example</code>.
              Set an optional expiry to auto-disable.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="exp">Expires at (optional)</Label>
              <Input id="exp" type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="notes">Reason / notes</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Onboarding pilot for JPMC — Q3 evaluation." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!dialog) return;
                mut.mutate({
                  tenant_id: dialog.id,
                  enabled: true,
                  expires_at: expiry ? new Date(expiry).toISOString() : null,
                  notes: notes || null,
                });
                setDialog(null);
              }}
            >Enable sandbox</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
