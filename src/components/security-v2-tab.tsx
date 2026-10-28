// Enterprise Identity & Security v2 — tenant-scoped UI.
// Tabs: BYOK / KMS · Field Encryption · Private Link · WORM Ledger · DLP

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listKmsKeys, upsertKmsKey, verifyKmsKey, rotateKmsKey, deleteKmsKey,
  listEncryptedColumns, upsertEncryptedColumn, deleteEncryptedColumn,
  listPrivateLinkRequests, createPrivateLinkRequest, decidePrivateLinkRequest,
  listWormEvidence,
  getDlpPolicy, upsertDlpPolicy, scanTextForDlp, listDlpScanResults, reviewDlpScanResult,
} from "@/lib/security-v2.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  KeyRound, ShieldCheck, Network, FileLock2, ScanLine, RefreshCw, Trash2, Plus, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

type Props = { tenantId: string; isPlatformAdmin?: boolean };

export function SecurityV2Tab({ tenantId, isPlatformAdmin = false }: Props) {
  return (
    <Tabs defaultValue="kms" className="space-y-4">
      <TabsList className="grid grid-cols-5 w-full">
        <TabsTrigger value="kms"><KeyRound className="mr-2 h-3.5 w-3.5" />BYOK Keys</TabsTrigger>
        <TabsTrigger value="enc"><ShieldCheck className="mr-2 h-3.5 w-3.5" />Field Encryption</TabsTrigger>
        <TabsTrigger value="plink"><Network className="mr-2 h-3.5 w-3.5" />Private Link</TabsTrigger>
        <TabsTrigger value="worm"><FileLock2 className="mr-2 h-3.5 w-3.5" />WORM Evidence</TabsTrigger>
        <TabsTrigger value="dlp"><ScanLine className="mr-2 h-3.5 w-3.5" />DLP</TabsTrigger>
      </TabsList>

      <TabsContent value="kms"><KmsPanel tenantId={tenantId} /></TabsContent>
      <TabsContent value="enc"><EncColPanel tenantId={tenantId} /></TabsContent>
      <TabsContent value="plink"><PrivateLinkPanel tenantId={tenantId} isPlatformAdmin={isPlatformAdmin} /></TabsContent>
      <TabsContent value="worm"><WormPanel tenantId={tenantId} /></TabsContent>
      <TabsContent value="dlp"><DlpPanel tenantId={tenantId} /></TabsContent>
    </Tabs>
  );
}

/* ----------------------------------------------------------- KMS */
function KmsPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listKmsKeys);
  const upsert = useServerFn(upsertKmsKey);
  const verify = useServerFn(verifyKmsKey);
  const rotate = useServerFn(rotateKmsKey);
  const remove = useServerFn(deleteKmsKey);
  const q = useQuery({ queryKey: ["kms", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });

  const [form, setForm] = useState({
    provider: "aws_kms" as const, alias: "", key_arn: "", region: "us-east-1",
    purpose: "data_at_rest" as const, rotation_period_days: 365,
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ["kms", tenantId] });
  const mAdd = useMutation({
    mutationFn: () => upsert({ data: { tenant_id: tenantId, ...form } }),
    onSuccess: () => { toast.success("Key registered"); refetch();
      setForm({ ...form, alias: "", key_arn: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer-Managed Encryption Keys (BYOK)</CardTitle>
        <CardDescription>
          Register your AWS KMS, Azure Key Vault, GCP KMS, or HashiCorp Vault keys. ReconIQ wraps tenant data
          encryption keys with your KEK so you retain cryptographic control and can revoke access at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <Label>Provider</Label>
            <Select value={form.provider} onValueChange={(v: any) => setForm({ ...form, provider: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aws_kms">AWS KMS</SelectItem>
                <SelectItem value="azure_key_vault">Azure Key Vault</SelectItem>
                <SelectItem value="gcp_kms">GCP KMS</SelectItem>
                <SelectItem value="hashicorp_vault">HashiCorp Vault</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Alias</Label>
            <Input value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} placeholder="prod-primary" />
          </div>
          <div className="md:col-span-2">
            <Label>Region</Label>
            <Input value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} />
          </div>
          <div className="md:col-span-4">
            <Label>Key identifier (ARN / Key URI)</Label>
            <Input value={form.key_arn} onChange={e => setForm({ ...form, key_arn: e.target.value })}
              placeholder="arn:aws:kms:us-east-1:123:key/abc" />
          </div>
          <div className="md:col-span-2">
            <Label>Purpose</Label>
            <Select value={form.purpose} onValueChange={(v: any) => setForm({ ...form, purpose: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="data_at_rest">Data at rest</SelectItem>
                <SelectItem value="backup">Backups</SelectItem>
                <SelectItem value="field_envelope">Field envelope</SelectItem>
                <SelectItem value="signing">Signing</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => mAdd.mutate()} disabled={!form.alias || !form.key_arn || mAdd.isPending}>
          <Plus className="mr-2 h-3.5 w-3.5" />Register key
        </Button>
        <Separator />
        <Table>
          <TableHeader><TableRow>
            <TableHead>Alias</TableHead><TableHead>Provider</TableHead><TableHead>Purpose</TableHead>
            <TableHead>Status</TableHead><TableHead>Last rotated</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(q.data ?? []).map((k: any) => (
              <TableRow key={k.id}>
                <TableCell className="font-mono text-xs">{k.alias}</TableCell>
                <TableCell>{k.provider}</TableCell>
                <TableCell>{k.purpose}</TableCell>
                <TableCell><Badge variant={k.status === "active" ? "default" : "secondary"}>{k.status}</Badge></TableCell>
                <TableCell className="text-xs">{k.last_rotated_at ? new Date(k.last_rotated_at).toLocaleString() : "—"}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={async () => { await verify({ data: { id: k.id, tenant_id: tenantId } }); toast.success("Verified"); refetch(); }}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={async () => { await rotate({ data: { id: k.id, tenant_id: tenantId } }); toast.success("Rotation triggered"); refetch(); }}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={async () => { await remove({ data: { id: k.id, tenant_id: tenantId } }); refetch(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------- Encrypted columns */
function EncColPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listEncryptedColumns);
  const keys = useServerFn(listKmsKeys);
  const upsert = useServerFn(upsertEncryptedColumn);
  const remove = useServerFn(deleteEncryptedColumn);
  const q = useQuery({ queryKey: ["enc-cols", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });
  const kq = useQuery({ queryKey: ["kms", tenantId], queryFn: () => keys({ data: { tenant_id: tenantId } }) });
  const [f, setF] = useState({ kek_id: "", table_name: "", column_name: "", classification: "pii" as const });
  const refetch = () => qc.invalidateQueries({ queryKey: ["enc-cols", tenantId] });
  const mAdd = useMutation({
    mutationFn: () => upsert({ data: { tenant_id: tenantId, ...f } }),
    onSuccess: () => { toast.success("Column registered"); refetch(); setF({ ...f, table_name: "", column_name: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Field-Level Envelope Encryption</CardTitle>
        <CardDescription>
          Map sensitive PII / PCI / PHI columns to a wrapping KEK. Stored data is encrypted with a per-record DEK
          that is itself encrypted under your KMS key (envelope encryption, AES-256-GCM).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label>Wrapping KEK</Label>
            <Select value={f.kek_id} onValueChange={v => setF({ ...f, kek_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select key" /></SelectTrigger>
              <SelectContent>
                {(kq.data ?? []).filter((k: any) => k.status === "active").map((k: any) =>
                  <SelectItem key={k.id} value={k.id}>{k.alias} · {k.provider}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Table</Label><Input value={f.table_name} onChange={e => setF({ ...f, table_name: e.target.value })} placeholder="customers" /></div>
          <div><Label>Column</Label><Input value={f.column_name} onChange={e => setF({ ...f, column_name: e.target.value })} placeholder="tax_id" /></div>
          <div>
            <Label>Classification</Label>
            <Select value={f.classification} onValueChange={(v: any) => setF({ ...f, classification: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pii">PII</SelectItem>
                <SelectItem value="pci">PCI</SelectItem>
                <SelectItem value="phi">PHI</SelectItem>
                <SelectItem value="secret">Secret</SelectItem>
                <SelectItem value="financial">Financial</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={() => mAdd.mutate()} disabled={!f.kek_id || !f.table_name || !f.column_name || mAdd.isPending} className="w-full">
              <Plus className="mr-2 h-3.5 w-3.5" />Add
            </Button>
          </div>
        </div>
        <Separator />
        <Table>
          <TableHeader><TableRow>
            <TableHead>Table.Column</TableHead><TableHead>Classification</TableHead>
            <TableHead>KEK</TableHead><TableHead>Algorithm</TableHead><TableHead className="text-right" /></TableRow></TableHeader>
          <TableBody>
            {(q.data ?? []).map((c: any) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">{c.table_name}.{c.column_name}</TableCell>
                <TableCell><Badge variant="outline">{c.classification}</Badge></TableCell>
                <TableCell className="text-xs">{c.tenant_kms_keys?.alias} · {c.tenant_kms_keys?.provider}</TableCell>
                <TableCell className="text-xs">{c.envelope_alg}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="destructive" onClick={async () => { await remove({ data: { id: c.id, tenant_id: tenantId } }); refetch(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------- Private Link / VPC */
function PrivateLinkPanel({ tenantId, isPlatformAdmin }: { tenantId: string; isPlatformAdmin: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listPrivateLinkRequests);
  const create = useServerFn(createPrivateLinkRequest);
  const decide = useServerFn(decidePrivateLinkRequest);
  const q = useQuery({ queryKey: ["plink", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });
  const [f, setF] = useState({ provider: "aws_kms" as const, region: "us-east-1", customer_account_id: "", vpc_id: "" });
  const refetch = () => qc.invalidateQueries({ queryKey: ["plink", tenantId] });
  const mAdd = useMutation({
    mutationFn: () => create({ data: { tenant_id: tenantId, ...f } }),
    onSuccess: () => { toast.success("Request submitted"); refetch(); setF({ ...f, customer_account_id: "", vpc_id: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Private Link / VPC Peering</CardTitle>
        <CardDescription>
          Available for silo-tier tenants. Submit a request and our platform team provisions a dedicated endpoint
          so traffic between your VPC and ReconIQ never traverses the public internet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label>Cloud</Label>
            <Select value={f.provider} onValueChange={(v: any) => setF({ ...f, provider: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aws_kms">AWS PrivateLink</SelectItem>
                <SelectItem value="azure_key_vault">Azure Private Endpoint</SelectItem>
                <SelectItem value="gcp_kms">GCP Private Service Connect</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Region</Label><Input value={f.region} onChange={e => setF({ ...f, region: e.target.value })} /></div>
          <div><Label>Account / Subscription</Label><Input value={f.customer_account_id} onChange={e => setF({ ...f, customer_account_id: e.target.value })} /></div>
          <div><Label>VPC / VNet ID</Label><Input value={f.vpc_id} onChange={e => setF({ ...f, vpc_id: e.target.value })} placeholder="vpc-..." /></div>
          <div className="flex items-end">
            <Button onClick={() => mAdd.mutate()} disabled={!f.customer_account_id || mAdd.isPending} className="w-full">Submit</Button>
          </div>
        </div>
        <Separator />
        <Table>
          <TableHeader><TableRow>
            <TableHead>Provider</TableHead><TableHead>Region</TableHead><TableHead>Account</TableHead>
            <TableHead>Status</TableHead><TableHead>Endpoint</TableHead>
            {isPlatformAdmin && <TableHead className="text-right">Decide</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {(q.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.provider}</TableCell>
                <TableCell>{r.region}</TableCell>
                <TableCell className="font-mono text-xs">{r.customer_account_id}</TableCell>
                <TableCell><Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                <TableCell className="text-xs">{r.endpoint_id ?? "—"}</TableCell>
                {isPlatformAdmin && (
                  <TableCell className="text-right space-x-1">
                    {r.status === "requested" && <>
                      <Button size="sm" variant="outline" onClick={async () => { await decide({ data: { id: r.id, tenant_id: tenantId, decision: "approved" } }); refetch(); }}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={async () => { await decide({ data: { id: r.id, tenant_id: tenantId, decision: "rejected", rejection_reason: "Insufficient details" } }); refetch(); }}>Reject</Button>
                    </>}
                    {r.status === "approved" && <Button size="sm" onClick={async () => {
                      const endpoint_id = prompt("Endpoint ID");
                      if (endpoint_id) { await decide({ data: { id: r.id, tenant_id: tenantId, decision: "active", endpoint_id } }); refetch(); }
                    }}>Activate</Button>}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------- WORM */
function WormPanel({ tenantId }: { tenantId: string }) {
  const list = useServerFn(listWormEvidence);
  const q = useQuery({ queryKey: ["worm", tenantId], queryFn: () => list({ data: { tenant_id: tenantId, limit: 100 } }) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>WORM Evidence Ledger</CardTitle>
        <CardDescription>
          Append-only audit ledger of evidence written to immutable storage (S3 Object Lock / Azure immutable blob).
          Each row carries the SHA-256 of the artifact and a chained hash so any tampering is mathematically detectable.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Recorded</TableHead><TableHead>Type</TableHead><TableHead>Resource</TableHead>
            <TableHead>SHA-256</TableHead><TableHead>Retention until</TableHead><TableHead>Chain hash</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(q.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{new Date(r.recorded_at).toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline">{r.evidence_type}</Badge></TableCell>
                <TableCell className="text-xs">{r.resource_type}/{r.resource_id ?? "—"}</TableCell>
                <TableCell className="font-mono text-[10px]">{r.sha256.slice(0, 12)}…</TableCell>
                <TableCell className="text-xs">{r.object_lock_until ? new Date(r.object_lock_until).toLocaleDateString() : "—"}</TableCell>
                <TableCell className="font-mono text-[10px]">{r.chain_hash.slice(0, 12)}…</TableCell>
              </TableRow>
            ))}
            {(q.data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No evidence recorded yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------- DLP */
function DlpPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const getP = useServerFn(getDlpPolicy);
  const upsertP = useServerFn(upsertDlpPolicy);
  const scan = useServerFn(scanTextForDlp);
  const listR = useServerFn(listDlpScanResults);
  const review = useServerFn(reviewDlpScanResult);

  const pq = useQuery({ queryKey: ["dlp-policy", tenantId], queryFn: () => getP({ data: { tenant_id: tenantId } }) });
  const rq = useQuery({ queryKey: ["dlp-results", tenantId], queryFn: () => listR({ data: { tenant_id: tenantId, limit: 50 } }) });
  const [text, setText] = useState("");
  const [scanRes, setScanRes] = useState<any>(null);
  const p = pq.data ?? {
    detect_pan: true, detect_iban: true, detect_ssn: true, detect_email: false,
    detect_aba: true, detect_swift_bic: false, default_action: "quarantine", block_on_high: true, enabled: true,
  };

  const mSave = useMutation({
    mutationFn: (patch: any) => upsertP({ data: { tenant_id: tenantId, ...p, ...patch } }),
    onSuccess: () => { toast.success("Policy updated"); qc.invalidateQueries({ queryKey: ["dlp-policy", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mScan = useMutation({
    mutationFn: () => scan({ data: { tenant_id: tenantId, text, source_kind: "manual", filename: "ad-hoc-paste", persist: true } }),
    onSuccess: (r) => { setScanRes(r); qc.invalidateQueries({ queryKey: ["dlp-results", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>DLP Policy</CardTitle>
          <CardDescription>
            Scan uploaded files and pasted text for cards (PAN, Luhn-validated), IBANs, SSNs, ABA routing numbers,
            SWIFT BICs, and custom regex patterns. High/critical findings can be auto-quarantined or blocked.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            ["detect_pan", "Card (PAN)"],
            ["detect_iban", "IBAN"],
            ["detect_ssn", "US SSN"],
            ["detect_aba", "ABA routing"],
            ["detect_swift_bic", "SWIFT BIC"],
            ["detect_email", "Email"],
            ["block_on_high", "Block on high/critical"],
            ["enabled", "DLP enabled"],
          ] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between rounded border p-2">
              <Label className="text-xs">{label}</Label>
              <Switch checked={!!(p as any)[k]} onCheckedChange={(v) => mSave.mutate({ [k]: v })} />
            </div>
          ))}
          <div className="col-span-2 md:col-span-4">
            <Label>Default action on detection</Label>
            <Select value={p.default_action} onValueChange={(v: any) => mSave.mutate({ default_action: v })}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">Allow (log only)</SelectItem>
                <SelectItem value="redact">Redact</SelectItem>
                <SelectItem value="quarantine">Quarantine</SelectItem>
                <SelectItem value="block">Block</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ad-hoc DLP scan</CardTitle>
          <CardDescription>Paste up to 2 MB of text to scan. Matches are stored with samples redacted.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={6} placeholder="Paste content here…" value={text} onChange={e => setText(e.target.value)} />
          <Button onClick={() => mScan.mutate()} disabled={!text || mScan.isPending}>
            <ScanLine className="mr-2 h-3.5 w-3.5" />Scan
          </Button>
          {scanRes && (
            <div className="rounded border p-3 text-sm space-y-1">
              <div>Severity <Badge variant={scanRes.severity === "critical" ? "destructive" : "outline"}>{scanRes.severity}</Badge>
                {" · "}Action <Badge variant="outline">{scanRes.action}</Badge>
                {" · "}Total matches <strong>{scanRes.total}</strong></div>
              <ul className="list-disc pl-5">
                {scanRes.matches.map((m: any, i: number) => (
                  <li key={i}><strong>{m.type}</strong>: {m.count}× (samples: {m.samples.join(", ") || "—"})</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent findings</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Severity</TableHead>
              <TableHead>Action</TableHead><TableHead>Matches</TableHead><TableHead className="text-right">Review</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(rq.data ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r.source_kind} · {r.filename ?? "—"}</TableCell>
                  <TableCell><Badge variant={r.severity === "critical" ? "destructive" : "outline"}>{r.severity}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{r.action_taken}</Badge></TableCell>
                  <TableCell className="text-xs">{(r.matches ?? []).map((m: any) => `${m.type}×${m.count}`).join(", ")}</TableCell>
                  <TableCell className="text-right">
                    {!r.reviewed_at ? (
                      <Button size="sm" variant="outline" onClick={async () => {
                        const resolution = prompt("Resolution note");
                        if (resolution) {
                          await review({ data: { id: r.id, tenant_id: tenantId, resolution } });
                          qc.invalidateQueries({ queryKey: ["dlp-results", tenantId] });
                        }
                      }}>Resolve</Button>
                    ) : <span className="text-xs text-muted-foreground">resolved</span>}
                  </TableCell>
                </TableRow>
              ))}
              {(rq.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No DLP findings.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
