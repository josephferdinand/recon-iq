import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Beaker,
  Check,
  ChevronRight,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Play,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createSandboxClient,
  listSandboxClients,
  revokeSandboxClient,
  runSandboxRequest,
} from "@/lib/sandbox.functions";
import {
  SANDBOX_OPERATIONS,
  operationsByTag,
  type SandboxOperation,
  type SandboxParam,
} from "@/lib/sandbox-operations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/docs/sandbox")({
  head: () => ({
    meta: [
      { title: "API Sandbox — ReconIQ Developer Portal" },
      { name: "description", content: "Interactive try-it console for the ReconIQ API using OAuth2 client-credentials or the current user session." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SandboxPage,
});

type TokenState = {
  token: string;
  expiresAt: number;
  scope: string;
  clientId: string;
} | null;

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: (id: string, text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(id);
        toast.success("Copied");
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
      });
    },
  };
}

function methodBadge(method: string) {
  const colors: Record<string, string> = {
    GET: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
    POST: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    PUT: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    PATCH: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    DELETE: "bg-rose-500/10 text-rose-600 border-rose-500/30",
  };
  return <span className={`inline-flex min-w-[52px] justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${colors[method] ?? "border-border"}`}>{method}</span>;
}

function CreateClientDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<("read" | "write")[]>(["read"]);
  const [reveal, setReveal] = useState<{ id: string; secret: string; clientId: string } | null>(null);
  const create = useServerFn(createSandboxClient);
  const [busy, setBusy] = useState(false);
  const { copy, copied } = useCopy();

  async function submit() {
    if (!name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      const res = await create({ data: { name: name.trim(), description: description.trim() || undefined, scopes } });
      setReveal({ id: res.client.id, secret: res.client_secret, clientId: res.client.client_id });
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create client");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setName(""); setDescription(""); setScopes(["read"]); setReveal(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1.5 h-3.5 w-3.5" />New client</Button>
      </DialogTrigger>
      <DialogContent>
        {!reveal ? (
          <>
            <DialogHeader>
              <DialogTitle>Create sandbox OAuth client</DialogTitle>
              <DialogDescription>Machine-to-machine credentials for the try-it console. The secret is displayed once.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="sbn">Name</Label>
                <Input id="sbn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Local dev · Alice" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sbd">Description (optional)</Label>
                <Input id="sbd" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Used from Postman while integrating exports" />
              </div>
              <div className="space-y-1.5">
                <Label>Allowed scopes</Label>
                <div className="flex gap-4">
                  {(["read", "write"] as const).map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={scopes.includes(s)} onCheckedChange={(v) => {
                        setScopes((prev) => v ? Array.from(new Set([...prev, s])) : prev.filter((x) => x !== s));
                      }} />
                      <span className="font-mono">{s}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">read = safe GETs. write = required for POST/PUT/PATCH/DELETE.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={busy || scopes.length === 0}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Create</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Save your client secret</DialogTitle>
              <DialogDescription>This is the only time the secret is shown. Store it in a password manager.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Client ID</Label>
                <div className="mt-1 flex items-center gap-2 rounded border bg-muted/40 px-2 py-1.5 font-mono text-xs">
                  <span className="flex-1 truncate">{reveal.clientId}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Copy client ID" onClick={() => copy("cid", reveal.clientId)}>{copied === "cid" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Client Secret</Label>
                <div className="mt-1 flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 font-mono text-xs">
                  <span className="flex-1 break-all">{reveal.secret}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Copy client secret" onClick={() => copy("cs", reveal.secret)}>{copied === "cs" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ClientList() {
  const qc = useQueryClient();
  const list = useServerFn(listSandboxClients);
  const revoke = useServerFn(revokeSandboxClient);
  const { data, isLoading } = useQuery({ queryKey: ["sandbox-clients"], queryFn: () => list() });
  const revokeMut = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => { toast.success("Client revoked"); qc.invalidateQueries({ queryKey: ["sandbox-clients"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Revoke failed"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> OAuth clients</CardTitle>
        <CreateClientDialog onCreated={() => qc.invalidateQueries({ queryKey: ["sandbox-clients"] })} />
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="py-4 text-center text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /></div> : null}
        {!isLoading && data?.clients?.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No clients yet. Create one to exchange for a bearer token.</p>
        ) : null}
        <div className="divide-y">
          {data?.clients?.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.active && !c.revoked_at ? (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="border-rose-500/40 text-rose-600">Revoked</Badge>
                  )}
                  {c.allowed_scopes.map((s: string) => <Badge key={s} variant="secondary" className="font-mono text-[10px]">{s}</Badge>)}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{c.client_id}</div>
              </div>
              {c.active && !c.revoked_at ? (
                <Button size="sm" variant="ghost" onClick={() => revokeMut.mutate(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TokenExchange({ onToken }: { onToken: (t: TokenState) => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scope, setScope] = useState("read");
  const [busy, setBusy] = useState(false);

  async function exchange() {
    if (!clientId || !clientSecret) return toast.error("Enter client_id and client_secret");
    setBusy(true);
    try {
      const res = await fetch("/api/public/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error_description ?? body.error ?? `HTTP ${res.status}`);
      onToken({ token: body.access_token, scope: body.scope, expiresAt: Date.now() + body.expires_in * 1000, clientId });
      toast.success(`Token issued · expires in ${Math.round(body.expires_in / 60)} min`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Token exchange failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">client_id</Label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="fvi_…" className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">client_secret</Label>
          <PasswordInput revealLabel="client secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="sk_…" className="font-mono text-xs" />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">scope</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="read">read</SelectItem>
              <SelectItem value="read write">read write</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button onClick={exchange} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Exchange</Button>
        </div>
      </div>
    </div>
  );
}

function ResponseView({ result }: { result: Awaited<ReturnType<typeof runSandboxRequest>> | null }) {
  const { copy, copied } = useCopy();
  if (!result) return null;
  const ok = result.status >= 200 && result.status < 300;
  const pretty = (() => {
    try { return JSON.stringify(JSON.parse(result.body), null, 2); } catch { return result.body; }
  })();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={ok ? "default" : "destructive"} className="font-mono">{result.status || "ERR"} {result.statusText}</Badge>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Timer className="h-3 w-3" /> {result.durationMs} ms</span>
        <span className="text-xs text-muted-foreground">{result.bodyBytes} B{result.truncated ? " · truncated" : ""}</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7" aria-label="Copy response body" onClick={() => copy("body", pretty)}>{copied === "body" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
      </div>
      <Tabs defaultValue="body">
        <TabsList><TabsTrigger value="body">Body</TabsTrigger><TabsTrigger value="headers">Headers</TabsTrigger></TabsList>
        <TabsContent value="body">
          <ScrollArea className="h-72 rounded-md border bg-muted/30">
            <pre className="overflow-x-auto p-3 text-xs"><code>{pretty}</code></pre>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="headers">
          <ScrollArea className="h-72 rounded-md border bg-muted/30">
            <pre className="overflow-x-auto p-3 text-xs"><code>{Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}</code></pre>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SandboxPage() {
  const [selectedId, setSelectedId] = useState<string>(SANDBOX_OPERATIONS[0].id);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState<string>("");
  const [authMode, setAuthMode] = useState<"session" | "client_credentials">("session");
  const [token, setToken] = useState<TokenState>(null);
  const [baseUrl, setBaseUrl] = useState("https://app-fvi.reconiq.example");
  const [result, setResult] = useState<Awaited<ReturnType<typeof runSandboxRequest>> | null>(null);
  const [busy, setBusy] = useState(false);
  const { copy, copied } = useCopy();
  const run = useServerFn(runSandboxRequest);

  const op = SANDBOX_OPERATIONS.find((o) => o.id === selectedId)!;
  const tags = useMemo(() => operationsByTag(), []);
  const hasWriteScope = token?.scope?.split(/\s+/).includes("write") ?? false;
  const tokenExpired = token ? token.expiresAt < Date.now() : true;

  function updateParam(name: string, v: string) {
    setParamValues((p) => ({ ...p, [name]: v }));
  }

  function buildPathAndQuery(): string {
    let path = op.path;
    const q = new URLSearchParams();
    for (const p of op.params) {
      const v = paramValues[p.name] ?? "";
      if (!v) continue;
      if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(v));
      else q.set(p.name, v);
    }
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  }

  async function send() {
    // Validate required params
    for (const p of op.params) {
      if (p.required && !paramValues[p.name]) return toast.error(`Missing required param: ${p.name}`);
    }
    if (op.method !== "GET" && op.requiresWriteScope && authMode === "client_credentials" && !hasWriteScope) {
      return toast.error("Client-credentials token needs scope=write for this endpoint");
    }

    let bearer: string;
    if (authMode === "session") {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return toast.error("No user session. Sign in first.");
      bearer = data.session.access_token;
    } else {
      if (!token || tokenExpired) return toast.error("Exchange for an access token first");
      bearer = token.token;
    }

    setBusy(true);
    setResult(null);
    try {
      const res = await run({
        data: {
          method: op.method,
          path: buildPathAndQuery(),
          baseUrl,
          headers: {},
          body: op.method === "GET" || op.method === "DELETE" ? undefined : body,
          authMode,
          bearer,
        },
      });
      setResult(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const fullUrl = `${baseUrl}${buildPathAndQuery()}`;
  const curl = buildCurl(op.method, fullUrl, authMode, token?.token, body);
  const tsSnippet = buildTsSnippet(op, paramValues);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Beaker className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">API Sandbox</h1>
          <Badge variant="outline">Try-it console</Badge>
        </div>
        <p className="max-w-3xl text-muted-foreground">
          Test any ReconIQ endpoint safely. Requests are proxied server-side so browser CORS doesn't
          apply, and the sandbox enforces host allow-listing, size caps, and a 15s timeout.
          Choose the auth mode below.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* LEFT — endpoint list + auth */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Endpoints</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[360px]">
                <div className="space-y-3 p-2">
                  {[...tags.entries()].map(([tag, ops]) => (
                    <div key={tag}>
                      <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{tag}</div>
                      {ops.map((o: SandboxOperation) => (
                        <button
                          key={o.id}
                          onClick={() => { setSelectedId(o.id); setParamValues({}); setBody(o.requestExample ?? ""); }}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted ${selectedId === o.id ? "bg-muted" : ""}`}
                        >
                          {methodBadge(o.method)}
                          <span className="flex-1 truncate font-mono">{o.path}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Authorization</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <RadioGroup value={authMode} onValueChange={(v) => setAuthMode(v as typeof authMode)}>
                <label className="flex items-start gap-2 rounded border p-2 text-sm">
                  <RadioGroupItem value="session" className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-medium">My user session</div>
                    <div className="text-xs text-muted-foreground">Uses your Supabase JWT — RLS enforces tenant scope.</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 rounded border p-2 text-sm">
                  <RadioGroupItem value="client_credentials" className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-medium">OAuth2 client_credentials</div>
                    <div className="text-xs text-muted-foreground">Machine-to-machine token. Admin endpoints are blocked.</div>
                  </div>
                </label>
              </RadioGroup>

              {authMode === "client_credentials" ? (
                <>
                  <Separator />
                  <TokenExchange onToken={setToken} />
                  {token ? (
                    <div className="rounded border bg-muted/30 p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant={tokenExpired ? "destructive" : "default"} className="font-mono">
                          {tokenExpired ? "Expired" : `${Math.max(0, Math.round((token.expiresAt - Date.now()) / 60000))} min left`}
                        </Badge>
                        <span className="font-mono text-muted-foreground">scope: {token.scope}</span>
                        <Button size="icon" variant="ghost" className="ml-auto h-6 w-6" aria-label="Copy access token" onClick={() => copy("t", token.token)}>{copied === "t" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</Button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </CardContent>
          </Card>

          <ClientList />
        </div>

        {/* RIGHT — request builder */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                {methodBadge(op.method)}
                <span className="font-mono text-sm">{op.path}</span>
                <Badge variant="secondary" className="text-[10px]">{op.tag}</Badge>
                {op.adminOnly ? <Badge variant="outline" className="border-amber-500/50 text-amber-600"><ShieldAlert className="mr-1 h-3 w-3" />admin</Badge> : null}
                {op.requiresWriteScope ? <Badge variant="outline" className="text-[10px]">scope: write</Badge> : null}
              </div>
              <CardTitle className="text-base font-normal text-muted-foreground">{op.summary}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                <Label className="text-xs text-muted-foreground">Base URL</Label>
                <Select value={baseUrl} onValueChange={setBaseUrl}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="https://app-fvi.reconiq.example">Production · app-fvi.reconiq.example</SelectItem>
                    <SelectItem value="https://reconintelligence.app">Meta · reconintelligence.app</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {op.params.length > 0 ? (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Parameters</Label>
                  <div className="space-y-2">
                    {op.params.map((p: SandboxParam) => (
                      <div key={p.name} className="grid grid-cols-[140px_1fr] items-start gap-2">
                        <div className="pt-2 text-xs">
                          <span className="font-mono">{p.name}</span>
                          {p.required ? <span className="ml-1 text-rose-500">*</span> : null}
                          <div className="text-[10px] text-muted-foreground">{p.in}</div>
                        </div>
                        {p.enum ? (
                          <Select value={paramValues[p.name] ?? ""} onValueChange={(v) => updateParam(p.name, v)}>
                            <SelectTrigger className="h-8"><SelectValue placeholder={p.example ?? "…"} /></SelectTrigger>
                            <SelectContent>{p.enum.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <Input
                            value={paramValues[p.name] ?? ""}
                            onChange={(e) => updateParam(p.name, e.target.value)}
                            placeholder={p.example ?? p.description ?? p.name}
                            className="h-8 font-mono text-xs"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {op.method !== "GET" && op.method !== "DELETE" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Request body (JSON)</Label>
                  <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="{}" className="font-mono text-xs" />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={send} disabled={busy}>
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}Send request
                </Button>
                <span className="truncate font-mono text-xs text-muted-foreground">{fullUrl}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3"><CardTitle className="text-base">Response</CardTitle></CardHeader>
            <CardContent>
              {result ? <ResponseView result={result} /> : <p className="text-sm text-muted-foreground">Send a request to see the response here.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3"><CardTitle className="text-base">Copy as</CardTitle></CardHeader>
            <CardContent>
              <Tabs defaultValue="curl">
                <TabsList><TabsTrigger value="curl">cURL</TabsTrigger><TabsTrigger value="ts">TypeScript SDK</TabsTrigger></TabsList>
                <TabsContent value="curl">
                  <div className="relative">
                    <pre className="overflow-x-auto rounded border bg-muted/30 p-3 text-xs"><code>{curl}</code></pre>
                    <Button size="icon" variant="ghost" className="absolute right-1 top-1 h-6 w-6" aria-label="Copy cURL command" onClick={() => copy("curl", curl)}>{copied === "curl" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
                  </div>
                </TabsContent>
                <TabsContent value="ts">
                  <div className="relative">
                    <pre className="overflow-x-auto rounded border bg-muted/30 p-3 text-xs"><code>{tsSnippet}</code></pre>
                    <Button size="icon" variant="ghost" className="absolute right-1 top-1 h-6 w-6" aria-label="Copy TypeScript example" onClick={() => copy("ts", tsSnippet)}>{copied === "ts" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function buildCurl(method: string, url: string, mode: "session" | "client_credentials", token: string | undefined, body: string): string {
  const bearer = token ?? (mode === "session" ? "$FVI_USER_TOKEN" : "$FVI_ACCESS_TOKEN");
  const parts = [
    `curl -X ${method} '${url}'`,
    `  -H 'authorization: Bearer ${bearer}'`,
    `  -H 'accept: application/json'`,
  ];
  if (method !== "GET" && method !== "DELETE" && body) {
    parts.push(`  -H 'content-type: application/json'`);
    parts.push(`  -d '${body.replace(/'/g, "\\''")}'`);
  }
  return parts.join(" \\\n");
}

function methodToSdkName(op: SandboxOperation): string {
  // Mirrors scripts/generate-sdk.mjs naming rules.
  const parts = op.path.replace(/\{([^}]+)\}/g, "by_$1").split("/").filter(Boolean).filter((p) => p !== "api");
  const joined = [op.method.toLowerCase(), ...parts].join("_");
  return joined.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase());
}

function buildTsSnippet(op: SandboxOperation, params: Record<string, string>): string {
  const tag = op.tag.toLowerCase();
  const name = methodToSdkName(op);
  const argEntries: string[] = [];
  for (const p of op.params) {
    const v = params[p.name];
    if (v) argEntries.push(`${p.name}: ${JSON.stringify(v)}`);
  }
  const argStr = argEntries.length ? `{ ${argEntries.join(", ")} }` : "";
  return `import { FviClient } from "@falconveritas/fvi-sdk";

const fvi = new FviClient({ token: process.env.FVI_TOKEN! });

const result = await fvi.${tag}.${name}(${argStr});
console.log(result);`;
}
