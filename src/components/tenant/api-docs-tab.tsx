import { useMemo, useState } from "react";
import {
  API_BASE_PATH,
  API_ERROR_CODES,
  API_GROUPS,
  API_SCHEMAS,
  API_SCOPES,
  API_VERSION,
  buildOpenApi,
  type ApiEndpoint,
  type ApiGroup,
  type HttpMethod,
} from "@/lib/api-catalog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen, Copy, Download, KeyRound, Search, ShieldCheck, Webhook, Zap, AlertTriangle,
  Activity, FileCode2, Layers,
} from "lucide-react";
import { toast } from "sonner";

/* ------------------------------ helpers ------------------------------ */

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  POST: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  PUT: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  PATCH: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  DELETE: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
};

function copy(text: string, label = "Copied") {
  navigator.clipboard.writeText(text);
  toast.success(label);
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="relative">
      <pre className="max-h-[420px] overflow-auto rounded-md border bg-muted/40 p-3 text-[12px] leading-relaxed">
        <code data-lang={lang}>{code}</code>
      </pre>
      <Button size="icon" variant="ghost" className="absolute right-1.5 top-1.5 h-7 w-7" onClick={() => copy(code)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ----------------------------- code samples ----------------------------- */

function makeCurl(e: ApiEndpoint, base: string, tenantSlug: string) {
  const url = `https://api.fvi.app${base}${e.path}`.replace("{tenantSlug}", tenantSlug);
  const lines = [
    `curl -X ${e.method} "${url}" \\`,
    `  -H "Authorization: Bearer $FVI_TOKEN" \\`,
    `  -H "Accept: application/json"`,
  ];
  if (e.requestBody) {
    lines.splice(2, 0, `  -H "Content-Type: ${e.requestBody.contentType}" \\`);
    if (e.requestBody.contentType === "application/json") {
      lines.push(`  -d '${e.requestBody.example.replace(/'/g, "'\\''")}'`);
    } else if (e.requestBody.contentType.startsWith("multipart")) {
      lines.push(`  -F "${e.requestBody.example}"`);
    } else {
      lines.push(`  --data-binary @payload.ndjson`);
    }
  }
  return lines.join("\n");
}

function makeJs(e: ApiEndpoint, base: string, tenantSlug: string) {
  const url = `https://api.fvi.app${base}${e.path}`.replace("{tenantSlug}", tenantSlug);
  const body = e.requestBody && e.requestBody.contentType === "application/json"
    ? `,\n  body: JSON.stringify(${e.requestBody.example})`
    : "";
  return `const res = await fetch("${url}", {
  method: "${e.method}",
  headers: {
    "Authorization": \`Bearer \${process.env.FVI_TOKEN}\`,
    "Accept": "application/json"${e.requestBody ? `,\n    "Content-Type": "${e.requestBody.contentType}"` : ""}
  }${body}
});
const data = await res.json();`;
}

function makePy(e: ApiEndpoint, base: string, tenantSlug: string) {
  const url = `https://api.fvi.app${base}${e.path}`.replace("{tenantSlug}", tenantSlug);
  const body = e.requestBody && e.requestBody.contentType === "application/json"
    ? `, json=${e.requestBody.example.replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None")}`
    : "";
  return `import os, requests
r = requests.${e.method.toLowerCase()}(
    "${url}",
    headers={"Authorization": f"Bearer {os.environ['FVI_TOKEN']}"}${body}
)
r.raise_for_status()
print(r.json())`;
}

/* ------------------------------- view ------------------------------- */

export function ApiDocsTab({ tenantSlug, tenantName }: { tenantSlug: string; tenantName: string }) {
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<string>(API_GROUPS[0].key);

  const baseUrl = useMemo(() => API_BASE_PATH.replace("{tenantSlug}", tenantSlug), [tenantSlug]);
  const fullBase = `https://api.fvi.app${baseUrl}`;

  const filteredGroups: ApiGroup[] = useMemo(() => {
    if (!query.trim()) return API_GROUPS;
    const q = query.toLowerCase();
    return API_GROUPS
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter(
          (e) =>
            e.path.toLowerCase().includes(q) ||
            e.summary.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.method.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [query]);

  const downloadOpenApi = () => {
    const spec = buildOpenApi(tenantSlug);
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `reconiq-openapi-${tenantSlug}-${API_VERSION}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      {/* HERO */}
      <Card className="overflow-hidden border-primary/20">
        <div className="relative bg-gradient-to-br from-primary/10 via-background to-accent/10 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">
                <FileCode2 className="h-3.5 w-3.5" />
                API Reference
              </div>
              <h2 className="font-display text-2xl font-semibold">ReconIQ — Public API</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Tenant-scoped REST API for {tenantName}. Authenticated with OAuth 2.0 bearer tokens, signed webhooks
                and SCIM 2.0. Every call is RLS-enforced, audit-logged, and rate-limited per tenant.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="outline" className="border-primary/30">{API_VERSION}</Badge>
                <Badge variant="outline">OpenAPI 3.0.3</Badge>
                <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Bearer + HMAC</Badge>
                <Badge variant="outline" className="gap-1"><Activity className="h-3 w-3" /> 99.95% SLA</Badge>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button onClick={downloadOpenApi} size="sm" className="gap-1.5">
                <Download className="h-4 w-4" /> Download OpenAPI 3.0
              </Button>
              <a href={`${fullBase}/docs`} target="_blank" rel="noreferrer">
                <Button size="sm" variant="ghost" className="gap-1.5"><BookOpen className="h-4 w-4" /> Open in Swagger</Button>
              </a>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-md border bg-background/80 px-3 py-2 backdrop-blur">
            <code className="flex-1 truncate text-xs">{fullBase}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(fullBase, "Base URL copied")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      {/* OVERVIEW STRIP */}
      <div className="grid gap-3 md:grid-cols-4">
        <OverviewCard icon={KeyRound} title="Authentication" desc="OAuth 2.0 client-credentials, refresh tokens, PATs and SCIM service accounts." />
        <OverviewCard icon={Zap} title="Rate limits" desc="600 req/min default · 10k records/sec streaming · per-token quotas." />
        <OverviewCard icon={Webhook} title="Webhooks" desc="HMAC-SHA256 signed, at-least-once delivery, exponential retries." />
        <OverviewCard icon={ShieldCheck} title="Security" desc="RLS, BU-scoped, audit-anchored daily SHA-256, optional IP allowlist." />
      </div>

      {/* QUICK START + AUTH + ERRORS */}
      <Tabs defaultValue="quickstart" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="quickstart">Quick start</TabsTrigger>
          <TabsTrigger value="auth">Authentication</TabsTrigger>
          <TabsTrigger value="scopes">Scopes</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="webhooks">Webhook signing</TabsTrigger>
        </TabsList>

        <TabsContent value="quickstart">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Make your first call in 60 seconds</CardTitle>
              <CardDescription>Exchange a PAT for a bearer token, then list your reconciliations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock lang="bash" code={`# 1) Get a token
curl -X POST "${fullBase}/oauth2/token" \\
  -H "Content-Type: application/json" \\
  -d '{ "grant_type": "client_credentials", "client_id": "$PAT_ID", "client_secret": "$PAT_SECRET" }'

# 2) Call the API
curl "${fullBase}/recons" -H "Authorization: Bearer $FVI_TOKEN"`} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="auth">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">OAuth 2.0 — Bearer tokens</CardTitle>
              <CardDescription>
                Personal Access Tokens (PATs) and machine clients are issued under Tenant → Security. Tokens are
                tenant- and BU-scoped; lost tokens can be revoked instantly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Access tokens: 60-minute TTL, returned as JWT with <code>tenant_id</code>, <code>bu_id</code> and <code>scope</code> claims.</li>
                <li>Refresh tokens: 30-day rolling, single-use with reuse detection.</li>
                <li>Step-up auth (WebAuthn / TOTP) required for destructive actions — server replies <code>412 step_up_required</code>.</li>
                <li>SAML/OIDC SSO sessions can mint API tokens via <code>/oauth2/token</code> with the <code>token_exchange</code> grant.</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scopes">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-4 py-2">Scope</th><th className="px-4 py-2">Grants</th></tr>
                </thead>
                <tbody>
                  {API_SCOPES.map((s) => (
                    <tr key={s.name} className="border-b last:border-b-0">
                      <td className="px-4 py-2 font-mono text-xs">{s.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{s.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Uniform error envelope</CardTitle>
              <CardDescription>Every 4xx / 5xx returns the same shape. Always log <code>request_id</code>.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock code={JSON.stringify({ error: "validation_error", message: "amount must be a number", request_id: "req_01H...", details: { field: "amount" } }, null, 2)} />
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="px-3 py-2">Status</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">When</th></tr>
                  </thead>
                  <tbody>
                    {API_ERROR_CODES.map((e) => (
                      <tr key={e.code} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-mono">{e.code}</td>
                        <td className="px-3 py-2 font-mono text-xs">{e.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{e.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Webhook className="h-4 w-4" /> Verifying webhook signatures</CardTitle>
              <CardDescription>Compare <code>X-FVI-Signature</code> against an HMAC-SHA256 of the raw body using your endpoint secret.</CardDescription>
            </CardHeader>
            <CardContent>
              <CodeBlock lang="js" code={`import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, signatureHeader, secret) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sig = Buffer.from(signatureHeader, "hex");
  const exp = Buffer.from(expected, "hex");
  return sig.length === exp.length && timingSafeEqual(sig, exp);
}`} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ENDPOINTS BROWSER */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base">Endpoints</CardTitle>
            <CardDescription>Browse by group. Every endpoint includes request, response and copy-ready samples.</CardDescription>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search endpoints, paths…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            {/* Sidebar */}
            <nav className="space-y-1 md:sticky md:top-2 md:self-start">
              {filteredGroups.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setActiveGroup(g.key)}
                  className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm transition ${
                    activeGroup === g.key ? "border-primary/40 bg-primary/5 font-medium" : "border-transparent hover:bg-muted/50"
                  }`}
                >
                  <span className="truncate">{g.name}</span>
                  <Badge variant="outline" className="ml-2 h-5 text-[10px]">{g.endpoints.length}</Badge>
                </button>
              ))}
              {filteredGroups.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">No endpoints match “{query}”.</p>
              )}
            </nav>

            {/* Content */}
            <div className="space-y-6">
              {filteredGroups
                .filter((g) => g.key === activeGroup || query.trim().length > 0)
                .map((g) => (
                  <section key={g.key} id={`g-${g.key}`} className="space-y-2">
                    <div>
                      <h3 className="font-display text-lg font-semibold">{g.name}</h3>
                      <p className="text-xs text-muted-foreground">{g.blurb}</p>
                    </div>
                    <Accordion type="multiple" className="space-y-2">
                      {g.endpoints.map((e) => (
                        <AccordionItem key={e.id} value={e.id} className="rounded-md border px-3">
                          <AccordionTrigger className="py-3 hover:no-underline">
                            <div className="flex w-full items-center gap-3 text-left">
                              <Badge variant="outline" className={`shrink-0 font-mono text-[10px] ${METHOD_COLOR[e.method]}`}>{e.method}</Badge>
                              <code className="flex-1 truncate text-xs">{e.path.replace("{tenantSlug}", tenantSlug)}</code>
                              <span className="hidden text-xs text-muted-foreground sm:inline">{e.summary}</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <EndpointDetail e={e} baseUrl={baseUrl} tenantSlug={tenantSlug} />
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </section>
                ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SCHEMAS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> Schemas</CardTitle>
          <CardDescription>Canonical object shapes referenced by request bodies and responses.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="space-y-2">
            {API_SCHEMAS.map((s) => (
              <AccordionItem key={s.name} value={s.name} className="rounded-md border px-3">
                <AccordionTrigger className="py-2.5 hover:no-underline">
                  <div className="flex items-center gap-3">
                    <code className="text-xs font-semibold">{s.name}</code>
                    <span className="text-xs text-muted-foreground">{s.description}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                      <tr><th className="py-2">Field</th><th className="py-2">Type</th><th className="py-2">Required</th><th className="py-2">Description</th></tr>
                    </thead>
                    <tbody>
                      {s.fields.map((f) => (
                        <tr key={f.name} className="border-b last:border-b-0">
                          <td className="py-2 font-mono text-xs">{f.name}</td>
                          <td className="py-2 font-mono text-xs text-muted-foreground">{f.type}</td>
                          <td className="py-2 text-xs">{f.required ? <Badge variant="outline">required</Badge> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="py-2 text-xs text-muted-foreground">{f.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

/* --------------------------- subcomponents --------------------------- */

function OverviewCard({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" /> {title}
        </div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function EndpointDetail({ e, baseUrl, tenantSlug }: { e: ApiEndpoint; baseUrl: string; tenantSlug: string }) {
  return (
    <div className="space-y-4 pb-3">
      <p className="text-sm text-muted-foreground">{e.description}</p>

      {e.rateLimit && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Rate limit: {e.rateLimit}
        </div>
      )}

      {e.params.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Parameters</h4>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Required</th><th className="px-3 py-2">Description</th></tr>
              </thead>
              <tbody>
                {e.params.map((p) => (
                  <tr key={p.name} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{p.name}</td>
                    <td className="px-3 py-2 text-xs"><Badge variant="outline">{p.in}</Badge></td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.type}{p.enum ? ` (${p.enum.join("|")})` : ""}</td>
                    <td className="px-3 py-2 text-xs">{p.required ? <Badge variant="outline">required</Badge> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {p.description}
                      {p.example !== undefined ? <span className="ml-1 text-[11px]">e.g. <code>{String(p.example)}</code></span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {e.requestBody && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Request body <span className="ml-1 font-mono normal-case text-[11px]">({e.requestBody.contentType})</span>
          </h4>
          <CodeBlock code={e.requestBody.example} />
        </div>
      )}

      <div>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Responses</h4>
        <div className="space-y-2">
          {e.responses.map((r) => (
            <div key={r.status} className="rounded-md border p-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs">
                <Badge
                  variant="outline"
                  className={
                    r.status < 300
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : r.status < 500
                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                        : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                  }
                >
                  {r.status}
                </Badge>
                <span className="text-muted-foreground">{r.description}</span>
              </div>
              {r.body && <CodeBlock code={r.body} />}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Examples</h4>
        <Tabs defaultValue="curl">
          <TabsList>
            <TabsTrigger value="curl">cURL</TabsTrigger>
            <TabsTrigger value="js">Node.js</TabsTrigger>
            <TabsTrigger value="py">Python</TabsTrigger>
          </TabsList>
          <TabsContent value="curl"><CodeBlock lang="bash" code={makeCurl(e, baseUrl, tenantSlug)} /></TabsContent>
          <TabsContent value="js"><CodeBlock lang="js" code={makeJs(e, baseUrl, tenantSlug)} /></TabsContent>
          <TabsContent value="py"><CodeBlock lang="python" code={makePy(e, baseUrl, tenantSlug)} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
