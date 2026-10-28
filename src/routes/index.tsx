import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  FileSearch,
  Fingerprint,
  Landmark,
  Link2,
  Lock,
  Network,
  PlayCircle,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserCheck,
  Wallet,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { RegulatoryAlignment, StructuredData } from "@/components/fvi-landing-additions";
import { appUrl } from "@/lib/cross-domain";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "ReconIQ — AI-assisted reconciliation" },
      {
        name: "description",
        content:
          "ReconIQ helps finance teams reconcile with deterministic matching, AI explanations under human approval, and a hash-chained audit trail.",
      },
      { property: "og:title", content: "ReconIQ — Reconciliation you can verify" },
      {
        property: "og:description",
        content:
          "Deterministic matching. AI explains, humans approve. Every action recorded in a hash-chained audit trail.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/" }],
  }),
});

/* ------------------------------------------------------------------ */
/* Content                                                            */
/* ------------------------------------------------------------------ */

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect & map",
    body: "Bring the two sides of a reconciliation together and map their fields into one shared shape, so the run compares like with like.",
  },
  {
    step: "02",
    title: "Deterministic matching",
    body: "Rules — not a model — decide what matches. The same inputs always produce the same result, and every match can be replayed and checked.",
  },
  {
    step: "03",
    title: "AI explains, humans approve",
    body: "When something does not match, AI explains the likely reason and suggests a next step. A person reviews and approves before anything changes.",
  },
] as const;

const CAPABILITIES = [
  {
    icon: Wallet,
    title: "Cash & nostro",
    body: "Reconcile bank statements against your ledger, with timing, fee and FX differences surfaced as explainable breaks.",
    to: "/solutions/$slug",
    slug: "cash-reconciliation",
    linkLabel: "Cash & nostro reconciliation",
  },
  {
    icon: Landmark,
    title: "Securities & custody",
    body: "Compare positions and trades across custodians and internal books, keeping cash and position views tied together.",
    to: "/solutions/$slug",
    slug: "securities-reconciliation",
    linkLabel: "Securities reconciliation",
  },
  {
    icon: Network,
    title: "Payments",
    body: "Follow payments through authorisation, clearing and settlement, and flag where the chain does not add up.",
    to: "/solutions/$slug",
    slug: "payments-reconciliation",
    linkLabel: "Payments reconciliation",
  },
  {
    icon: Building2,
    title: "Intercompany & GL",
    body: "Match intercompany activity and general-ledger balances across entities, so close differences appear early — not at month-end.",
    to: "/solutions/$slug",
    slug: "intercompany-reconciliation",
    linkLabel: "Intercompany reconciliation",
  },
  {
    icon: FileSearch,
    title: "Regulatory reporting",
    body: "Check reported values back to their source records, field by field, and keep the evidence behind each check.",
    to: "/solutions/$slug",
    slug: "regulatory-reconciliation",
    linkLabel: "Regulatory reconciliation",
  },
  {
    icon: ShieldCheck,
    title: "Security & audit",
    body: "Tenant isolation, role-based access, and an append-only, hash-chained record of matches, breaks and approvals.",
    to: "/security",
    slug: null,
    linkLabel: "Security & compliance",
  },
] as const;

const DEMO_STEPS = [
  {
    icon: UploadCloud,
    title: "Upload two CSVs",
    body: "Sign in and load the two sample files for a reconciliation — one from each side of the comparison.",
  },
  {
    icon: ScanSearch,
    title: "Run deterministic matching",
    body: "Run the match. The rules do the deciding, so re-running the same files gives you the same outcome.",
  },
  {
    icon: Fingerprint,
    title: "Open break DEMO-002",
    body: "Most rows match. One does not: open break DEMO-002 to see exactly what differs between the two sides.",
  },
  {
    icon: Sparkles,
    title: "Read the AI explanation",
    body: "The AI explains the likely cause of the break and suggests a resolution. It advises — it does not approve anything itself.",
  },
  {
    icon: UserCheck,
    title: "Resolve it as the human",
    body: "You decide. Approve or act on the suggestion yourself, then check the hash-chained audit trail to see your decision recorded.",
  },
] as const;

const FAQ_TEASERS = [
  {
    q: "Does the AI ever approve a break on its own?",
    a: "No. Deterministic code computes the match result. AI only explains breaks and suggests next steps — a human approves before any state changes.",
  },
  {
    q: "Is ReconIQ SOC 2 or ISO 27001 certified?",
    a: "No. Controls are designed with reference to those frameworks, and formal certification is on the roadmap. We do not claim certifications we have not earned.",
  },
  {
    q: "Can I try ReconIQ before booking a demo?",
    a: "Yes. Sign in to the live product and run the guided demo: upload two CSVs, run a deterministic match, work break DEMO-002, and inspect the audit trail.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Small building blocks                                              */
/* ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#86868b]">
      {children}
    </p>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-display text-4xl font-medium tracking-tight text-[#f5f5f7] md:text-5xl">
        {title}
      </h2>
      {body ? (
        <p className="mt-4 text-base leading-relaxed text-[#a1a1a6]">{body}</p>
      ) : null}
    </div>
  );
}

function PrimaryLink({
  to,
  children,
}: {
  to: "/book-demo";
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/85"
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

function SignInLink({ label = "Sign in" }: { label?: string }) {
  return (
    <a
      href={appUrl("/auth")}
      className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-[#f5f5f7] transition hover:border-white/40 hover:bg-white/5"
    >
      {label}
      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

function Landing() {
  return (
    <div className="min-h-screen bg-black font-sans text-[#f5f5f7] antialiased">
      <StructuredData />
      <MarketingNav />

      <main id="main-content">
        {/* ------------------------------ Hero ------------------------------ */}
        <section className="border-b border-white/10 bg-black">
          <div className="mx-auto max-w-7xl px-6 py-24 md:py-32">
            <div className="max-w-4xl">
              <Eyebrow>ReconIQ · AI-assisted reconciliation</Eyebrow>
              <h1 className="mt-6 font-display text-5xl font-medium leading-[1.05] tracking-tight text-[#f5f5f7] md:text-7xl">
                Reconciliation you can verify, break by break.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#a1a1a6]">
                ReconIQ matches your records with deterministic rules, uses AI to
                explain what did not match, and leaves the decision — and the
                audit trail — with your team.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <PrimaryLink to="/book-demo">Book a demo</PrimaryLink>
                <SignInLink />
              </div>
              <p className="mt-6 text-sm text-[#86868b]">
                Or try it first: the live demo is inside the product, after sign-in.
              </p>
            </div>
          </div>
        </section>

        {/* --------------------------- How it works -------------------------- */}
        <section aria-labelledby="how-heading" className="bg-[#0b0b0f]">
          <div className="mx-auto max-w-7xl px-6 py-24">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading
                eyebrow="How it works"
                title="Three steps, in order."
                body="No black box. Each step has a clear owner: your data, deterministic rules, then a person."
              />
              <Link
                to="/solutions"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2997ff] hover:underline"
              >
                See it by use case
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <ol className="mt-14 grid gap-4 md:grid-cols-3">
              {HOW_IT_WORKS.map((item) => (
                <li
                  key={item.step}
                  className="rounded-3xl border border-white/10 bg-[#161617] p-8"
                >
                  <p className="font-mono text-xs tracking-[0.2em] text-[#86868b]">
                    {item.step}
                  </p>
                  <h3 className="mt-5 font-display text-2xl font-medium tracking-tight text-[#f5f5f7]">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#a1a1a6]">
                    {item.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --------------------------- Capabilities -------------------------- */}
        <section
          aria-labelledby="capabilities-heading"
          className="border-t border-white/10 bg-black"
        >
          <div className="mx-auto max-w-7xl px-6 py-24">
            <SectionHeading
              eyebrow="What ReconIQ reconciles"
              title="One product, the reconciliations finance teams actually run."
              body="Start with the workflow closest to yours. Each one uses the same matching, break and audit foundations."
            />

            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((cap) => {
                const Icon = cap.icon;
                const cardClass =
                  "group flex h-full flex-col rounded-3xl border border-white/10 bg-[#161617] p-7 transition hover:border-white/25 hover:bg-[#1c1c1f]";
                const inner = (
                  <>
                    <Icon className="h-6 w-6 text-[#f5f5f7]" aria-hidden="true" />
                    <h3 className="mt-6 font-display text-xl font-medium tracking-tight text-[#f5f5f7]">
                      {cap.title}
                    </h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-[#a1a1a6]">
                      {cap.body}
                    </p>
                    <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#2997ff]">
                      {cap.linkLabel}
                      <ArrowRight
                        className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                  </>
                );

                return cap.slug ? (
                  <Link
                    key={cap.title}
                    to="/solutions/$slug"
                    params={{ slug: cap.slug }}
                    className={cardClass}
                  >
                    {inner}
                  </Link>
                ) : (
                  <Link key={cap.title} to="/security" className={cardClass}>
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* ------------------------ Regulatory alignment --------------------- */}
        <div className="border-t border-white/10 bg-[#0b0b0f]">
          <RegulatoryAlignment />
        </div>

        {/* ----------------------------- Live demo --------------------------- */}
        <section
          aria-labelledby="demo-heading"
          className="border-t border-white/10 bg-black"
        >
          <div className="mx-auto max-w-7xl px-6 py-24">
            <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
              <div>
                <Eyebrow>Try the live demo</Eyebrow>
                <h2
                  id="demo-heading"
                  className="mt-4 font-display text-4xl font-medium tracking-tight text-[#f5f5f7] md:text-5xl"
                >
                  Don&apos;t take our word for it. Run it.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-[#a1a1a6]">
                  The product itself is the proof. Sign in, work through one
                  reconciliation end to end, and inspect the same audit trail
                  your auditors would see.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href={appUrl("/auth")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/85"
                  >
                    <PlayCircle className="h-4 w-4" aria-hidden="true" />
                    Sign in to try the demo
                  </a>
                  <PrimaryLink to="/book-demo">Book a demo</PrimaryLink>
                </div>
                <p className="mt-6 flex items-start gap-2 text-sm leading-relaxed text-[#86868b]">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  Use the sample files provided in the demo. Nothing in the demo
                  requires — or should contain — real customer data.
                </p>
              </div>

              <ol className="space-y-3">
                {DEMO_STEPS.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <li
                      key={item.title}
                      className="flex gap-5 rounded-3xl border border-white/10 bg-[#161617] p-6"
                    >
                      <div className="flex flex-col items-center">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#1c1c1f]">
                          <Icon className="h-5 w-5 text-[#f5f5f7]" aria-hidden="true" />
                        </span>
                        {index < DEMO_STEPS.length - 1 ? (
                          <span aria-hidden="true" className="mt-3 w-px flex-1 bg-white/10" />
                        ) : null}
                      </div>
                      <div className="pb-1">
                        <p className="font-mono text-[11px] tracking-[0.2em] text-[#86868b]">
                          STEP {index + 1}
                        </p>
                        <h3 className="mt-1.5 font-display text-lg font-medium tracking-tight text-[#f5f5f7]">
                          {item.title}
                        </h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-[#a1a1a6]">
                          {item.body}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>

        {/* ------------------------------ FAQ teaser ------------------------- */}
        <section
          aria-labelledby="faq-heading"
          className="border-t border-white/10 bg-[#0b0b0f]"
        >
          <div className="mx-auto max-w-7xl px-6 py-24">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading
                eyebrow="Questions"
                title="Straight answers, up front."
              />
              <Link
                to="/enterprise-faq"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2997ff] hover:underline"
              >
                Read the enterprise FAQ
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <dl className="mt-12 grid gap-4 md:grid-cols-3">
              {FAQ_TEASERS.map((item) => (
                <div
                  key={item.q}
                  className="rounded-3xl border border-white/10 bg-[#161617] p-7"
                >
                  <dt className="flex items-start gap-2 font-display text-lg font-medium tracking-tight text-[#f5f5f7]">
                    <BookOpenCheck
                      className="mt-1 h-5 w-5 shrink-0 text-[#86868b]"
                      aria-hidden="true"
                    />
                    {item.q}
                  </dt>
                  <dd className="mt-3 text-sm leading-relaxed text-[#a1a1a6]">
                    {item.a}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ------------------------------ Final CTA -------------------------- */}
        <section className="border-t border-white/10 bg-black">
          <div className="mx-auto max-w-7xl px-6 py-24">
            <div className="rounded-[2rem] border border-white/10 bg-[#161617] px-8 py-16 text-center md:px-16">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-[#1c1c1f]">
                <CheckCircle2 className="h-6 w-6 text-[#f5f5f7]" aria-hidden="true" />
              </div>
              <h2 className="mx-auto mt-8 max-w-3xl font-display text-4xl font-medium tracking-tight text-[#f5f5f7] md:text-5xl">
                See a break explained, approved, and sealed — in the product.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[#a1a1a6]">
                Book a demo with your own workflow in mind, or sign in and run
                the live demo today.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <PrimaryLink to="/book-demo">Book a demo</PrimaryLink>
                <SignInLink />
              </div>
              <p className="mt-8 flex items-center justify-center gap-2 text-xs text-[#86868b]">
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                reconintelligence.app — one product, from first upload to audit trail.
              </p>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
