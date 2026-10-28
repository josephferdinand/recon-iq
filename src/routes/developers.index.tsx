import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BookOpen,
  KeyRound,
  ShieldCheck,
  Webhook,
  Terminal,
  Code2,
  ArrowRight,
  Gauge,
  GitBranch,
  FileJson,
} from "lucide-react";

export const Route = createFileRoute("/developers/")({
  head: () => ({
    meta: [
      { title: "Developer Portal — ReconIQ API" },
      {
        name: "description",
        content:
          "Start here: authentication, base URLs, error model, rate limits, pagination, webhooks, and links to the full OpenAPI 3.1 reference.",
      },
      { property: "og:title", content: "ReconIQ Developer Portal" },
      {
        property: "og:description",
        content:
          "Start here: authentication, base URLs, error model, rate limits, pagination, webhooks, and links to the full OpenAPI 3.1 reference.",
      },
      { property: "og:url", content: "https://reconintelligence.app/developers" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/developers" }],
  }),
  component: DevelopersHome,
});

function Card({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col rounded-2xl border border-white/10 bg-[#161617] p-5 transition-colors hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2997ff]"
    >
      <Icon className="h-6 w-6 text-[#a1a1a6]" />
      <h3 className="mt-3 text-sm font-semibold text-[#f5f5f7]">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-[#a1a1a6]">{desc}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#2997ff] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        Open <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

export default function DevelopersHome() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12 md:py-16">
      <section className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#86868b]">Developer Portal</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-[#f5f5f7] md:text-5xl">
          ReconIQ API
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[#a1a1a6] md:text-base">
          The ReconIQ API is a REST-over-HTTPS interface built to OpenAPI 3.1, following industry
          standards (RFC 7807 problem details, RFC 6750 bearer tokens, RFC 8288 pagination links,
          RFC 7231 conditional requests, and the IETF <em>API Versioning</em> guidance).
          Every endpoint is tenant-scoped and enforced at the database via Postgres RLS.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/developers/api-reference"
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-black hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2997ff]"
          >
            Open API Reference <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <a
            href="/api/public/openapi.yaml"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-medium text-[#f5f5f7] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2997ff]"
          >
            <FileJson className="h-3.5 w-3.5" /> Download OpenAPI 3.1 (YAML)
          </a>
          <Link
            to="/developers/guides"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-medium text-[#f5f5f7] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2997ff]"
          >
            <BookOpen className="h-3.5 w-3.5" /> Integration Guides
          </Link>
        </div>
      </section>

      <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card to="/developers/api-reference" icon={Code2} title="API Reference" desc="Full OpenAPI 3.1 rendered with Redoc — all endpoints, schemas, examples." />
        <Card to="/developers/guides" icon={BookOpen} title="Integration Guides" desc="Auth, pagination, webhooks, idempotency, error handling, SDK snippets." />
        <Card to="/developers/changelog" icon={GitBranch} title="Changelog & Versioning" desc="Semantic versioning, deprecation policy, migration notes." />
      </section>

      <section className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-[#f5f5f7]">Base URLs</h2>
          <div className="mt-3 space-y-2 text-xs">
            <div className="rounded-xl border border-white/10 bg-[#1c1c1f] p-3 font-mono text-[#f5f5f7]">
              https://reconintelligence.app <span className="text-[#86868b]">(production)</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#1c1c1f] p-3 font-mono text-[#f5f5f7]">
              https://reconintelligence.app <span className="text-[#86868b]">(hosted production alias)</span>
            </div>
          </div>
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold text-[#f5f5f7]">Standards we follow</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#a1a1a6]">
            <li>· OpenAPI 3.1.0</li>
            <li>· RFC 7807 problem+json</li>
            <li>· RFC 6750 Bearer tokens</li>
            <li>· RFC 5789 PATCH / JSON Merge</li>
            <li>· RFC 7232 ETag / If-Match</li>
            <li>· RFC 8594 Sunset header</li>
            <li>· ISO-8601 timestamps (UTC)</li>
            <li>· SemVer 2.0 versioning</li>
          </ul>
        </div>
      </section>

      <section className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card to="/developers/guides" icon={KeyRound} title="Authentication" desc="Bearer JWT, session lifetime, SSO/SAML notes." />
        <Card to="/developers/guides" icon={Gauge} title="Rate limits" desc="Per-tenant token bucket. Retry-After semantics." />
        <Card to="/developers/guides" icon={Webhook} title="Webhooks" desc="HMAC signature, replay protection, event catalogue." />
        <Card to="/developers/guides" icon={ShieldCheck} title="Security" desc="TLS 1.3, tenant isolation, BYOK, audit trail." />
      </section>

      <section className="mt-12 rounded-2xl border border-white/10 bg-[#161617] p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-[#f5f5f7]">
          <Terminal className="h-5 w-5 text-[#a1a1a6]" /> Quick start (60 seconds)
        </h2>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-black p-4 text-xs leading-relaxed text-[#d4d4da]">
{`# 1. Exchange your credentials for a bearer JWT via the sign-in flow
export FVI_TOKEN="eyJhbGciOi..."

# 2. Call the API — every request is tenant-scoped
curl -sS https://reconintelligence.app/api/session \\
  -H "Authorization: Bearer $FVI_TOKEN" \\
  -H "Accept: application/json"

# 3. List reconciliation batches for your tenant
curl -sS https://reconintelligence.app/api/reconciliation/batches \\
  -H "Authorization: Bearer $FVI_TOKEN"`}
        </pre>
      </section>
    </main>
  );
}
