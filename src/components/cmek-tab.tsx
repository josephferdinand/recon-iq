import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listCmekKeys, registerCmekKey, setCmekStatus } from "@/lib/cmek.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KeyRound } from "lucide-react";

const PROVIDERS = [
  { v: "aws_kms", l: "AWS KMS" },
  { v: "gcp_kms", l: "Google Cloud KMS" },
  { v: "azure_kv", l: "Azure Key Vault" },
  { v: "hashicorp_vault", l: "HashiCorp Vault" },
];

export function CmekTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listCmekKeys);
  const reg = useServerFn(registerCmekKey);
  const setSt = useServerFn(setCmekStatus);

  const q = useQuery({ queryKey: ["cmek", tenantId], queryFn: () => list({ data: { tenantId } }) });

  const [provider, setProvider] = useState<string>("aws_kms");
  const [keyUri, setKeyUri] = useState("arn:aws:kms:eu-west-2:123456789012:key/falcon-fvi-prod");
  const [alias, setAlias] = useState("Demo Bank — EMEA prod");

  const mReg = useMutation({
    mutationFn: () =>
      reg({
        data: {
          tenantId,
          provider: provider as "aws_kms" | "gcp_kms" | "azure_kv" | "hashicorp_vault",
          keyUri,
          alias,
        },
      }),
    onSuccess: () => {
      toast.success("CMEK key registered — pending activation by ReconIQ Platform Security");
      qc.invalidateQueries({ queryKey: ["cmek", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mStatus = useMutation({
    mutationFn: (v: { id: string; status: "pending" | "active" | "rotating" | "disabled" }) =>
      setSt({ data: { ...v, tenantId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cmek", tenantId] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Customer-managed encryption keys (CMEK / BYOK)
          </CardTitle>
          <CardDescription>
            Register your own KMS key reference. ReconIQ envelope-encrypts tenant data with a per-record DEK wrapped by your KEK.
            Disabling a key here immediately renders new writes unable to be decrypted by ReconIQ background workers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider} disabled={!canWrite}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.v} value={p.v}>{p.l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Key URI / ARN</Label>
              <Input value={keyUri} onChange={(e) => setKeyUri(e.target.value)} disabled={!canWrite} />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label>Alias (for humans)</Label>
              <Input value={alias} onChange={(e) => setAlias(e.target.value)} disabled={!canWrite} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={!canWrite || mReg.isPending} onClick={() => mReg.mutate()}>
              Register key
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered keys</CardTitle>
          <CardDescription>Activate, rotate, or disable a key reference.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(q.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No CMEK keys registered yet.</p>
          )}
          {(q.data ?? []).map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{k.alias ?? k.key_uri}</div>
                <div className="truncate text-xs text-muted-foreground">{k.provider} · {k.key_uri}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    k.status === "active" ? "default" :
                    k.status === "disabled" ? "destructive" : "secondary"
                  }
                >
                  {k.status}
                </Badge>
                {canWrite && (
                  <Select
                    value={k.status}
                    onValueChange={(v) =>
                      mStatus.mutate({
                        id: k.id,
                        status: v as "pending" | "active" | "rotating" | "disabled",
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">pending</SelectItem>
                      <SelectItem value="active">active</SelectItem>
                      <SelectItem value="rotating">rotating</SelectItem>
                      <SelectItem value="disabled">disabled</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
