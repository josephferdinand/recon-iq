import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listApiTokens, createApiToken, revokeApiToken,
  listMigrationImports, startMigrationImport,
  listSyntheticJobs, createSyntheticJob,
  listChatOps, upsertChatOps,
} from "@/lib/gtm.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Key, Database, Sparkles, MessageSquare, Copy } from "lucide-react";
import { API_TOKEN_SCOPE_GROUPS } from "@/lib/api-token-scopes";

export function GtmTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  return (
    <Tabs defaultValue="api">
      <TabsList>
        <TabsTrigger value="api"><Key className="mr-1 h-3.5 w-3.5" /> Headless API</TabsTrigger>
        <TabsTrigger value="migration"><Database className="mr-1 h-3.5 w-3.5" /> Migration importer</TabsTrigger>
        <TabsTrigger value="synthetic"><Sparkles className="mr-1 h-3.5 w-3.5" /> Synthetic data</TabsTrigger>
        <TabsTrigger value="chat"><MessageSquare className="mr-1 h-3.5 w-3.5" /> Teams / Slack</TabsTrigger>
      </TabsList>
      <TabsContent value="api"><ApiTokensPanel tenantId={tenantId} canWrite={canWrite} /></TabsContent>
      <TabsContent value="migration"><MigrationPanel tenantId={tenantId} canWrite={canWrite} /></TabsContent>
      <TabsContent value="synthetic"><SyntheticPanel tenantId={tenantId} canWrite={canWrite} /></TabsContent>
      <TabsContent value="chat"><ChatOpsPanel tenantId={tenantId} canWrite={canWrite} /></TabsContent>
    </Tabs>
  );
}

function ApiTokensPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listApiTokens);
  const createFn = useServerFn(createApiToken);
  const revokeFn = useServerFn(revokeApiToken);
  const q = useQuery({ queryKey: ["api-tokens", tenantId], queryFn: () => listFn({ data: { tenant_id: tenantId } }) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", scopes: ["recons.read"], expires_in_days: 90 });
  const [revealed, setRevealed] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => createFn({ data: { tenant_id: tenantId, ...form } }),
    onSuccess: (r: any) => {
      setRevealed(r.token);
      qc.invalidateQueries({ queryKey: ["api-tokens", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const rev = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { toast.success("Token revoked"); qc.invalidateQueries({ queryKey: ["api-tokens", tenantId] }); },
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">Headless Recon API tokens</CardTitle>
          <CardDescription>
            Least-privilege tokens for supported ReconIQ API routes. Hashed at rest (SHA-256); plaintext shown only once at creation.
          </CardDescription>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setRevealed(null); }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> New token</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{revealed ? "Token created" : "New API token"}</DialogTitle></DialogHeader>
              {revealed ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Copy this token now — it will not be shown again.</p>
                  <div className="flex items-center gap-2 rounded-md border bg-muted p-2 font-mono text-xs break-all">
                    {revealed}
                    <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(revealed); toast.success("Copied"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Button onClick={() => { setOpen(false); setRevealed(null); }}>Done</Button>
                </div>
              ) : (
                <div className="grid gap-3">
                  <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <fieldset className="max-h-[min(45vh,24rem)] space-y-3 overflow-y-auto pr-1">
                    <legend className="text-sm font-medium">API scopes</legend>
                    <p className="text-xs text-muted-foreground">Select only the capabilities this integration needs. These names match currently implemented route checks; scopes are not aliases for older permission names.</p>
                    {API_TOKEN_SCOPE_GROUPS.map((group) => (
                      <section key={group.label} className="space-y-1.5">
                        <h3 className="text-xs font-semibold text-muted-foreground">{group.label}</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {group.scopes.map(({ id, description }) => {
                            const checked = form.scopes.includes(id);
                            return (
                              <label key={id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 accent-primary"
                                  aria-label={`${id}: ${description}`}
                                  checked={checked}
                                  onChange={() => setForm({
                                    ...form,
                                    scopes: checked ? form.scopes.filter((scope: string) => scope !== id) : [...form.scopes, id],
                                  })}
                                />
                                <span className="min-w-0">
                                  <span className="block font-mono text-xs">{id}</span>
                                  <span className="block text-xs text-muted-foreground">{description}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </fieldset>
                  <div><Label>Expires in (days)</Label>
                    <Input type="number" value={form.expires_in_days}
                      onChange={(e) => setForm({ ...form, expires_in_days: +e.target.value })} />
                  </div>
                  <Button disabled={!form.name || form.scopes.length === 0 || m.isPending} onClick={() => m.mutate()}>
                    Create token
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Prefix</TableHead><TableHead>Scopes</TableHead>
              <TableHead>Expires</TableHead><TableHead>Last used</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((t: any) => (
              <TableRow key={t.id} className={t.revoked_at ? "opacity-50" : ""}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="font-mono text-xs">{t.prefix}…</TableCell>
                <TableCell className="text-xs">{t.scopes.join(", ")}</TableCell>
                <TableCell className="text-xs">{t.expires_at ? new Date(t.expires_at).toLocaleDateString() : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "never"}</TableCell>
                <TableCell className="text-right">
                  {canWrite && !t.revoked_at ? (
                    <Button size="sm" variant="ghost" onClick={() => rev.mutate(t.id)}>Revoke</Button>
                  ) : t.revoked_at ? <Badge variant="secondary">revoked</Badge> : null}
                </TableCell>
              </TableRow>
            ))}
            {q.data && q.data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No API tokens yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MigrationPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMigrationImports);
  const startFn = useServerFn(startMigrationImport);
  const q = useQuery({ queryKey: ["migration", tenantId], queryFn: () => listFn({ data: { tenant_id: tenantId } }) });
  const [form, setForm] = useState<any>({ source_system: "duco", file_name: "", definitions_found: 0 });
  const m = useMutation({
    mutationFn: () => startFn({ data: { tenant_id: tenantId, ...form } }),
    onSuccess: () => { toast.success("Import mapping generated"); qc.invalidateQueries({ queryKey: ["migration", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Definition migration importer</CardTitle>
        <CardDescription>
          Import rule definitions from Duco, TLM, SmartStream Frontier/IntelliMatch and produce a confidence-scored mapping report into ReconIQ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <div className="grid gap-3 md:grid-cols-4">
            <div><Label>Source</Label>
              <Select value={form.source_system} onValueChange={(v) => setForm({ ...form, source_system: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="duco">Duco</SelectItem>
                  <SelectItem value="tlm">SmartStream TLM</SelectItem>
                  <SelectItem value="smartstream">SmartStream RTB</SelectItem>
                  <SelectItem value="frontier">Frontier</SelectItem>
                  <SelectItem value="intellimatch">IntelliMatch</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>File name</Label><Input value={form.file_name} onChange={(e) => setForm({ ...form, file_name: e.target.value })} /></div>
            <div><Label>Definitions found</Label>
              <Input type="number" value={form.definitions_found}
                onChange={(e) => setForm({ ...form, definitions_found: +e.target.value })} />
            </div>
            <div className="flex items-end"><Button disabled={m.isPending} onClick={() => m.mutate()}>Generate mapping</Button></div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow><TableHead>Source</TableHead><TableHead>File</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Found</TableHead><TableHead className="text-right">Imported</TableHead><TableHead>Created</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell><Badge variant="outline">{r.source_system}</Badge></TableCell>
                <TableCell className="text-xs">{r.file_name ?? "—"}</TableCell>
                <TableCell><Badge>{r.status}</Badge></TableCell>
                <TableCell className="text-right">{r.definitions_found}</TableCell>
                <TableCell className="text-right">{r.definitions_imported}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {q.data && q.data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No imports yet. Example: import ReconIQ GTM contacts from HubSpot or upload demo-leads.csv.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SyntheticPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSyntheticJobs);
  const createFn = useServerFn(createSyntheticJob);
  const q = useQuery({ queryKey: ["synthetic", tenantId], queryFn: () => listFn({ data: { tenant_id: tenantId } }) });
  const [form, setForm] = useState<any>({ preset_code: "tpl-fx-confirms", rows_per_side: 1000, break_rate_pct: 5, seed: 42 });
  const m = useMutation({
    mutationFn: () => createFn({ data: { tenant_id: tenantId, ...form } }),
    onSuccess: () => { toast.success("Synthetic dataset queued"); qc.invalidateQueries({ queryKey: ["synthetic", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Synthetic data generator</CardTitle>
        <CardDescription>
          Deterministic seeded datasets for QA, UAT and regression — no PII risk. Choose a template and the expected break rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <div className="grid gap-3 md:grid-cols-5">
            <div><Label>Preset</Label>
              <Select value={form.preset_code} onValueChange={(v) => setForm({ ...form, preset_code: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tpl-custody-3way">Custody 3-way</SelectItem>
                  <SelectItem value="tpl-collateral-vm-im">Collateral VM/IM</SelectItem>
                  <SelectItem value="tpl-nav-3way">NAV 3-way</SelectItem>
                  <SelectItem value="tpl-fx-confirms">FX confirms</SelectItem>
                  <SelectItem value="tpl-card-scheme">Card scheme</SelectItem>
                  <SelectItem value="tpl-iso20022-pacs">ISO 20022 pacs</SelectItem>
                  <SelectItem value="tpl-mt564-ca">Corporate actions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Rows / side</Label><Input type="number" value={form.rows_per_side} onChange={(e) => setForm({ ...form, rows_per_side: +e.target.value })} /></div>
            <div><Label>Break %</Label><Input type="number" step="0.1" value={form.break_rate_pct} onChange={(e) => setForm({ ...form, break_rate_pct: +e.target.value })} /></div>
            <div><Label>Seed</Label><Input type="number" value={form.seed} onChange={(e) => setForm({ ...form, seed: +e.target.value })} /></div>
            <div className="flex items-end"><Button disabled={m.isPending} onClick={() => m.mutate()}>Generate</Button></div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow><TableHead>Preset</TableHead><TableHead className="text-right">Rows</TableHead><TableHead className="text-right">Break %</TableHead><TableHead className="text-right">Seed</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell><Badge variant="outline">{r.preset_code}</Badge></TableCell>
                <TableCell className="text-right">{r.rows_per_side}</TableCell>
                <TableCell className="text-right">{r.break_rate_pct}</TableCell>
                <TableCell className="text-right">{r.seed}</TableCell>
                <TableCell><Badge>{r.status}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {q.data && q.data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No jobs yet. Example: outbound GTM sequence to Demo Bank prospects in EMEA banking sector.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const CHAT_EVENTS = ["break.new", "break.assigned", "break.closed", "run.failed", "approval.requested", "sla.breach"];

function ChatOpsPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listChatOps);
  const saveFn = useServerFn(upsertChatOps);
  const q = useQuery({ queryKey: ["chatops", tenantId], queryFn: () => listFn({ data: { tenant_id: tenantId } }) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    platform: "slack", channel: "", webhook_url: "", events: ["break.new", "run.failed"], enabled: true,
  });
  const m = useMutation({
    mutationFn: () => saveFn({ data: { tenant_id: tenantId, ...form } }),
    onSuccess: () => { toast.success("Subscription saved"); setOpen(false); qc.invalidateQueries({ queryKey: ["chatops", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">Teams / Slack conversational ops</CardTitle>
          <CardDescription>
            Push break notifications, run failures, SLA breaches and approval prompts to chat channels — and let users action them in-channel.
          </CardDescription>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> New subscription</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New chat subscription</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Platform</Label>
                  <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="slack">Slack</SelectItem>
                      <SelectItem value="teams">Microsoft Teams</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Channel</Label><Input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="#demo-bank-ops" /></div>
                <div><Label>Webhook URL</Label><Input value={form.webhook_url} onChange={(e) => setForm({ ...form, webhook_url: e.target.value })} placeholder="https://hooks.slack.com/services/T0DEMO/B0OPS/XXXX" /></div>
                <div><Label>Events</Label>
                  <div className="flex flex-wrap gap-2">
                    {CHAT_EVENTS.map((ev) => {
                      const on = form.events.includes(ev);
                      return (
                        <Badge key={ev} variant={on ? "default" : "outline"} className="cursor-pointer"
                          onClick={() => setForm({ ...form, events: on ? form.events.filter((e: string) => e !== ev) : [...form.events, ev] })}>
                          {ev}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <Button disabled={!form.channel || !form.webhook_url || m.isPending} onClick={() => m.mutate()}>Save subscription</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Platform</TableHead><TableHead>Channel</TableHead><TableHead>Events</TableHead><TableHead>Status</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((s: any) => (
              <TableRow key={s.id}>
                <TableCell><Badge variant="outline">{s.platform}</Badge></TableCell>
                <TableCell className="font-medium">{s.channel}</TableCell>
                <TableCell className="text-xs">{s.events.join(", ")}</TableCell>
                <TableCell><Badge variant={s.enabled ? "default" : "secondary"}>{s.enabled ? "active" : "paused"}</Badge></TableCell>
              </TableRow>
            ))}
            {q.data && q.data.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">No subscriptions.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
