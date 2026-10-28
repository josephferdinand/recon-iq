import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/developers/guides")({
  head: () => ({
    meta: [
      { title: "Integration Guides — ReconIQ Developer Portal" },
      {
        name: "description",
        content:
          "Step-by-step guides for authentication, pagination, error handling, idempotency, webhooks, and SDK usage against the ReconIQ API.",
      },
    ],
  }),
  component: Guides,
});

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 mt-12 font-display text-2xl font-semibold">
      {children}
    </h2>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold text-foreground">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{children}</p>;
}
function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 text-xs">
      <code>{children}</code>
    </pre>
  );
}

function Guides() {
  const toc: { id: string; label: string }[] = [
    { id: "auth", label: "1. Authentication" },
    { id: "requests", label: "2. Requests & responses" },
    { id: "errors", label: "3. Error model (RFC 7807)" },
    { id: "pagination", label: "4. Pagination" },
    { id: "idempotency", label: "5. Idempotency" },
    { id: "rate-limits", label: "6. Rate limits" },
    { id: "webhooks", label: "7. Webhooks" },
    { id: "versioning", label: "8. Versioning & deprecation" },
    { id: "sdks", label: "9. SDK examples" },
    { id: "connectors", label: "10. ERP connectors" },
    { id: "support", label: "11. Support" },
  ];

  return (
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-12 lg:grid-cols-[220px_1fr]">
      <aside className="hidden lg:block">
        <div className="sticky top-20">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">On this page</p>
          <ul className="mt-3 space-y-1 text-xs">
            {toc.map((i) => (
              <li key={i.id}>
                <a
                  href={`#${i.id}`}
                  className="block rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {i.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <article className="min-w-0">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Integration guides</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Build against ReconIQ</h1>
        <P>
          These guides cover everything you need to integrate with the ReconIQ API in
          production, following the same standards that back the OpenAPI 3.1 spec at{" "}
          <a href="/api/public/openapi.yaml" className="underline">/api/public/openapi.yaml</a>.
        </P>

        <H2 id="auth">1. Authentication</H2>
        <P>
          ReconIQ uses <strong>OAuth 2.0 Bearer tokens</strong> (RFC 6750). Tokens are Supabase-issued
          JWTs obtained through the sign-in flow (email/password, magic link, or your configured
          enterprise SSO — SAML 2.0 or OIDC). Every request MUST send the token in the
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">Authorization</code> header.
        </P>
        <Code>{`Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`}</Code>
        <P>
          Tokens are scoped by tenant and by role (viewer, analyst, admin, platform_admin).
          Access is enforced twice — in the server function middleware and again at the database
          via Postgres RLS. A missing or expired token returns <code>401</code>; a token that
          lacks the required role returns <code>403</code>.
        </P>

        <H2 id="requests">2. Requests & responses</H2>
        <P>
          All requests use JSON (<code>application/json; charset=utf-8</code>). Timestamps are
          ISO-8601 in UTC (<code>2026-07-05T14:22:19Z</code>). IDs are UUID v4. Money is
          returned as a decimal string plus an ISO-4217 currency code — never a float.
        </P>
        <Code>{`{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "created_at": "2026-07-05T14:22:19Z",
  "amount": "1250.00",
  "currency": "USD"
}`}</Code>

        <H2 id="errors">3. Error model (RFC 7807)</H2>
        <P>
          Errors follow{" "}
          <a
            href="https://www.rfc-editor.org/rfc/rfc7807"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            RFC 7807 problem+json
          </a>
          . Every error response carries a stable <code>type</code> URI, HTTP <code>status</code>,
          human-readable <code>title</code>, and a <code>request_id</code> you can quote when
          contacting support.
        </P>
        <Code>{`HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{
  "type":     "https://app.reconiq.example/errors/validation",
  "title":    "Validation failed",
  "status":   422,
  "detail":   "amount must be a positive decimal",
  "instance": "/api/reconciliation/batches",
  "request_id": "req_01JB3QK6H3Q0M8W2S4X7Y9Z1AB",
  "errors": [ { "field": "amount", "code": "positive_decimal" } ]
}`}</Code>

        <H2 id="pagination">4. Pagination</H2>
        <P>
          List endpoints use <strong>cursor pagination</strong> for stable ordering and O(1)
          performance. The next page cursor is opaque — treat it as a string and pass it back
          verbatim in <code>?cursor=</code>. The <code>Link</code> header (RFC 8288) mirrors the
          same information for HTTP-native clients.
        </P>
        <Code>{`GET /api/reconciliation/batches?limit=50
→ 200 OK
Link: </api/reconciliation/batches?cursor=eyJvIjoiMjAyNi0wNy0wNVQxNDoyMjoxOVoifQ>; rel="next"

{
  "data":   [ { "id": "..." }, ... ],
  "next":   "eyJvIjoiMjAyNi0wNy0wNVQxNDoyMjoxOVoifQ",
  "limit":  50
}`}</Code>

        <H2 id="idempotency">5. Idempotency</H2>
        <P>
          For any POST that creates or mutates state (batches, exports, webhook subscriptions),
          send an <code>Idempotency-Key</code> header — a client-generated UUID v4. The API
          stores the first response for 24 hours and returns it verbatim on any retry with the
          same key, so a retried network request never creates a duplicate resource.
        </P>
        <Code>{`POST /api/reconciliation/batches
Idempotency-Key: example-idempotency-key
Authorization: Bearer $FVI_TOKEN`}</Code>

        <H2 id="rate-limits">6. Rate limits</H2>
        <P>
          Every tenant is metered with a token bucket (default: 600 req/min sustained, burst 100
          per second). Responses always carry the standard headers:
        </P>
        <Code>{`RateLimit-Limit:     600
RateLimit-Remaining: 587
RateLimit-Reset:     42        # seconds until refill
Retry-After:         2         # only sent on 429`}</Code>
        <P>On <code>429 Too Many Requests</code>, back off using exponential jitter — the safe minimum is <code>Retry-After</code>.</P>

        <H2 id="webhooks">7. Webhooks</H2>
        <P>
          Subscribe via <code>POST /api/webhooks</code> with a target URL and an event filter.
          Each delivery is signed with <strong>HMAC-SHA256</strong> over the raw body using your
          per-endpoint secret; verify signatures with a timing-safe comparison before you trust
          the payload. Deliveries carry a monotonically increasing <code>webhook-id</code> and
          <code>webhook-timestamp</code>; reject any timestamp older than 5 minutes to prevent
          replay attacks.
        </P>
        <Code>{`POST /your/endpoint  HTTP/1.1
webhook-id:         evt_01JB3QK6H3Q0M8W2S4X7Y9Z1AB
webhook-timestamp:  1782529636
webhook-signature:  v1,sha256=8c...`}</Code>
        <P>Event catalogue: <code>batch.completed</code>, <code>batch.failed</code>, <code>exception.created</code>, <code>exception.resolved</code>, <code>export.ready</code>, <code>connector.sync.completed</code>.</P>

        <H2 id="versioning">8. Versioning & deprecation</H2>
        <P>
          The API follows <strong>SemVer 2.0</strong>. The current major is <code>v4</code>. Breaking
          changes ship in a new major only. When we deprecate a field or route, responses gain
          the <code>Deprecation</code> and <code>Sunset</code> headers (RFC 8594) with at least
          <strong> 12 months</strong> notice before removal.
        </P>
        <Code>{`Deprecation: true
Sunset:      Wed, 01 Jul 2027 00:00:00 GMT
Link:        <https://app.reconiq.example/developers/changelog>; rel="deprecation"`}</Code>

        <H2 id="sdks">9. SDK examples</H2>
        <H3>curl</H3>
        <Code>{`curl -sS https://app.reconiq.example/api/reconciliation/batches \\
  -H "Authorization: Bearer $FVI_TOKEN"`}</Code>
        <H3>TypeScript (fetch)</H3>
        <Code>{`const res = await fetch(
  "https://app.reconiq.example/api/reconciliation/batches",
  { headers: { Authorization: \`Bearer \${process.env.FVI_TOKEN}\` } },
);
if (!res.ok) throw new Error(await res.text());
const { data, next } = await res.json();`}</Code>
        <H3>Python (httpx)</H3>
        <Code>{`import os, httpx
r = httpx.get(
  "https://app.reconiq.example/api/reconciliation/batches",
  headers={"Authorization": f"Bearer {os.environ['FVI_TOKEN']}"},
  timeout=30,
)
r.raise_for_status()
print(r.json())`}</Code>
        <H3>Java (HttpClient)</H3>
        <Code>{`HttpRequest req = HttpRequest.newBuilder()
  .uri(URI.create("https://app.reconiq.example/api/reconciliation/batches"))
  .header("Authorization", "Bearer " + System.getenv("FVI_TOKEN"))
  .GET().build();
HttpResponse<String> res = HttpClient.newHttpClient()
  .send(req, HttpResponse.BodyHandlers.ofString());`}</Code>

        <H2 id="connectors">10. ERP connectors</H2>
        <P>
          Native connectors for SAP, Oracle EBS/Fusion, Finacle, Flexcube, and Tally normalize
          their ledgers into the ReconIQ reconciliation schema. See <code>docs/connectors/</code> in
          the platform documentation for setup runbooks, OAuth/credential flow, and the
          reconciliation output schema per connector.
        </P>

        <H2 id="support">11. Support</H2>
        <P>
          Email <a href="mailto:developers@reconiq.example" className="underline">developers@reconiq.example</a>{" "}
          with the <code>request_id</code> from the failing response. Security issues:{" "}
          <a href="mailto:security@reconiq.example" className="underline">security@reconiq.example</a> — see also
          our disclosure policy at{" "}
          <a href="/.well-known/security.txt" className="underline">/.well-known/security.txt</a>.
        </P>
      </article>
    </main>
  );
}
