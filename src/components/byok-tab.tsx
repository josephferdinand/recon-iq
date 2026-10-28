import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listByokKeys, upsertByokKey, rotateByokKey } from "@/lib/platform-depth.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { KeyRound, Plus, RefreshCw } from "lucide-react";

export function ByokTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listByokKeys);
  const saveFn = useServerFn(upsertByokKey);
  const rotateFn = useServerFn(rotateByokKey);
  const q = useQuery({ queryKey: ["byok", tenantId], queryFn: () => listFn({ data: { tenant_id: tenantId } }) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    alias: "", provider: "aws-kms", key_arn: "", mode: "BYOK", algorithm: "AES_256", status: "active",
  });
  const m = useMutation({
    mutationFn: () => saveFn({ data: { tenant_id: tenantId, ...form } }),
    onSuccess: () => { toast.success("Key registered"); setOpen(false); qc.invalidateQueries({ queryKey: ["byok", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const rot = useMutation({
    mutationFn: (id: string) => rotateFn({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { toast.success("Rotation initiated"); qc.invalidateQueries({ queryKey: ["byok", tenantId] }); },
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> BYOK / HYOK encryption keys
          </CardTitle>
          <CardDescription>
            Register customer-managed keys from AWS KMS, GCP KMS, Azure KV, Vault or Thales HSM. Plaintext key material never touches ReconIQ — we only store the ARN/alias and reference it at runtime.
          </CardDescription>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> New key</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Register customer-managed key</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Alias</Label><Input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Provider</Label>
                    <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="aws-kms">AWS KMS</SelectItem>
                        <SelectItem value="gcp-kms">GCP KMS</SelectItem>
                        <SelectItem value="azure-kv">Azure Key Vault</SelectItem>
                        <SelectItem value="hashicorp-vault">HashiCorp Vault</SelectItem>
                        <SelectItem value="thales-hsm">Thales Luna HSM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Mode</Label>
                    <Select value={form.mode} onValueChange={(v) => setForm({ ...form, mode: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BYOK">BYOK (envelope encryption)</SelectItem>
                        <SelectItem value="HYOK">HYOK (hold-your-own-key)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Key ARN / URI</Label>
                  <Input value={form.key_arn} onChange={(e) => setForm({ ...form, key_arn: e.target.value })}
                    placeholder="e.g. arn:aws:kms:eu-west-1:123456789012:key/demo-bank-data-residency-eu" />
                </div>
                <Button disabled={!form.alias || !form.key_arn || m.isPending} onClick={() => m.mutate()}>
                  Register key
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alias</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>ARN</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((k: any) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.alias}</TableCell>
                <TableCell><Badge variant="outline">{k.provider}</Badge></TableCell>
                <TableCell><Badge>{k.mode}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[260px]">{k.key_arn}</TableCell>
                <TableCell><Badge variant={k.status === "active" ? "default" : "secondary"}>{k.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {canWrite && k.status === "active" ? (
                    <Button size="sm" variant="ghost" onClick={() => rot.mutate(k.id)}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {q.data && q.data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No customer keys registered.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
