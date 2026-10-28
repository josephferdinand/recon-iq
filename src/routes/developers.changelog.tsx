import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/developers/changelog")({
  head: () => ({
    meta: [
      { title: "API Changelog — ReconIQ Developer Portal" },
      {
        name: "description",
        content:
          "ReconIQ API changelog. SemVer 2.0 versioning, deprecation timelines, and migration notes for every release.",
      },
    ],
  }),
  component: Changelog,
});

type Entry = {
  version: string;
  date: string;
  type: "major" | "minor" | "patch" | "deprecation";
  items: string[];
};

const ENTRIES: Entry[] = [
  {
    version: "4.0.0",
    date: "2026-07-05",
    type: "major",
    items: [
      "Adopted OpenAPI 3.1.0 with JSON Schema 2020-12 semantics.",
      "Standardised errors on RFC 7807 problem+json with stable type URIs.",
      "Switched list endpoints to cursor pagination + RFC 8288 Link header.",
      "Introduced Idempotency-Key on all mutating routes (24h replay window).",
      "Published ERP connector endpoints for SAP, Oracle, Finacle, Flexcube, Tally.",
    ],
  },
  {
    version: "3.6.0",
    date: "2026-05-14",
    type: "minor",
    items: [
      "Added tenant-scoped webhook subscriptions with HMAC-SHA256 signing.",
      "Added SIEM+APM tap endpoints for authorised observability integrations.",
    ],
  },
  {
    version: "3.5.2",
    date: "2026-04-02",
    type: "patch",
    items: ["Hardened rate-limit headers to the IETF draft standard names."],
  },
  {
    version: "3.4.0",
    date: "2026-02-18",
    type: "deprecation",
    items: [
      "Deprecated offset pagination (?page=, ?per_page=). Sunset: 2027-02-18. Use cursor pagination.",
    ],
  },
];

function Badge({ type }: { type: Entry["type"] }) {
  const cls: Record<Entry["type"], string> = {
    major: "bg-primary/15 text-primary border-primary/30",
    minor: "bg-emerald-500/10 text-emerald-800 border-emerald-500/30 dark:text-emerald-300",
    patch: "bg-muted text-muted-foreground border-border",
    deprecation: "bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls[type]}`}>
      {type}
    </span>
  );
}

function Changelog() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">API Changelog</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Releases</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        The ReconIQ API follows <strong>Semantic Versioning 2.0.0</strong>. Breaking changes ship in
        a new major only, with at least 12 months of notice via the{" "}
        <code>Deprecation</code> and <code>Sunset</code> response headers (RFC 8594).
      </p>

      <div className="mt-10 space-y-8 border-l border-border/60 pl-6">
        {ENTRIES.map((e) => (
          <div key={e.version} className="relative">
            <span className="absolute -left-[27px] top-2 h-2 w-2 rounded-full bg-primary" />
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-semibold">v{e.version}</h2>
              <Badge type={e.type} />
              <time className="text-xs text-muted-foreground">{e.date}</time>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {e.items.map((i) => (
                <li key={i} className="pl-4 -indent-4">• {i}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
