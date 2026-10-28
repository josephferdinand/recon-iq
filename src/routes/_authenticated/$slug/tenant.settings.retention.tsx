import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listRetentionPolicies,
  setRetentionOverride,
} from "@/lib/retention.functions";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldCheck, Lock, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/$slug/tenant/settings/retention")({
  loader: async ({ params }) => {
    const tenant = await getTenantBySlug({ data: { slug: params.slug } });
    if (!tenant?.id) throw new Error("Tenant not found");
    const policies = await listRetentionPolicies({ data: { tenant_id: tenant.id } });
    return { tenant, policies };
  },
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-10 text-sm">
        <p className="mb-3 text-destructive">{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
        <Button onClick={() => { router.invalidate(); reset(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-10">Not found</div>,
  head: () => ({
    meta: [
      { title: "Data Retention — Tenant Settings" },
      { name: "description", content: "Tenant-level data retention overrides." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TenantRetentionSettings,
});

type Row = {
  table_name: string;
  default_days: number | null;
  floor_days: number | null;
  configurable: boolean;
  basis: string | null;
  override_days: number | null;
  override_reason: string | null;
  effective_days: number | null;
};

function TenantRetentionSettings() {
  const { tenant } = Route.useLoaderData();
  const qc = useQueryClient();
  const list = useServerFn(listRetentionPolicies);
  const save = useServerFn(setRetentionOverride);

  const { data } = useQuery({
    queryKey: ["retention.policies", tenant.id],
    queryFn: () => list({ data: { tenant_id: tenant.id } }),
    initialData: Route.useLoaderData().policies,
  });

  const [editing, setEditing] = useState<Row | null>(null);
  const [draftDays, setDraftDays] = useState<string>("");
  const [draftReason, setDraftReason] = useState<string>("");

  const mutation = useMutation({
    mutationFn: async (input: { table_name: string; retention_days: number | null; reason?: string }) =>
      save({ data: { tenant_id: tenant.id, ...input } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["retention.policies", tenant.id] });
      toast.success("Retention updated");
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message ?? "Update failed"),
  });

  const rows = (data?.tables ?? []) as Row[];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Tenant Admin · {tenant.name}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Data retention</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Extend retention for any tenant-configurable data class up to 10 years (3650 days).
          Reductions below the platform floor are rejected at the database level.
          See the public{" "}
          <a className="underline" href="/retention" target="_blank" rel="noreferrer">
            retention policy
          </a>{" "}
          for the regulatory basis behind each default.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Policies</CardTitle>
          <CardDescription>One row per data class. Effective = override if set, else platform default.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Data class</th>
                <th className="px-4 py-2">Platform default</th>
                <th className="px-4 py-2">Floor</th>
                <th className="px-4 py-2">Tenant override</th>
                <th className="px-4 py-2">Effective</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.table_name} className="border-b align-top">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs">{r.table_name}</div>
                    <div className="text-xs text-muted-foreground">{r.basis ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{r.default_days ?? "—"} d</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.floor_days != null ? `${r.floor_days} d` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.override_days != null ? (
                      <Badge>{r.override_days} d</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{r.effective_days ?? "—"} d</td>
                  <td className="px-4 py-3 text-right">
                    {r.configurable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(r);
                          setDraftDays(String(r.override_days ?? r.default_days ?? ""));
                          setDraftReason(r.override_reason ?? "");
                        }}
                      >
                        Edit
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="h-3 w-3" /> Read-only
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override retention · {editing?.table_name}</DialogTitle>
            <DialogDescription>
              Platform default {editing?.default_days} days. Minimum {editing?.floor_days ?? "—"} days.
              Maximum 3650 days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ret-days">Retention (days)</Label>
              <Input
                id="ret-days"
                type="number"
                min={editing?.floor_days ?? 1}
                max={3650}
                value={draftDays}
                onChange={(e) => setDraftDays(e.target.value)}
              />
              {editing?.floor_days != null && Number(draftDays) < editing.floor_days && (
                <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" /> Below platform floor of {editing.floor_days} days.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="ret-reason">Reason (audit trail)</Label>
              <Textarea
                id="ret-reason"
                rows={3}
                placeholder="Why is this override needed?"
                value={draftReason}
                onChange={(e) => setDraftReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {editing?.override_days != null && (
              <Button
                variant="outline"
                onClick={() =>
                  mutation.mutate({
                    table_name: editing.table_name,
                    retention_days: null,
                  })
                }
                disabled={mutation.isPending}
              >
                Clear override
              </Button>
            )}
            <Button
              onClick={() => {
                const days = Number(draftDays);
                if (!Number.isFinite(days) || days < 1 || days > 3650) {
                  toast.error("Enter a value between 1 and 3650 days");
                  return;
                }
                if (editing?.floor_days != null && days < editing.floor_days) {
                  toast.error(`Below floor of ${editing.floor_days} days`);
                  return;
                }
                mutation.mutate({
                  table_name: editing!.table_name,
                  retention_days: days,
                  reason: draftReason || undefined,
                });
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Saving…" : "Save override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
