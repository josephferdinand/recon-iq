import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/legal")({
  component: LegalPage,
  head: () => ({
    meta: [
      { title: "Legal Information — ReconIQ" },
      { name: "description", content: "Operator details and website-use information for ReconIQ." },
      { property: "og:title", content: "Legal Information — ReconIQ" },
      { property: "og:description", content: "Operator details and website-use information for ReconIQ." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/legal" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/legal" }],
  }),
});

function LegalPage() {
  return (
    <div className="min-h-screen bg-[var(--mkt-bg)] text-[var(--mkt-text)] transition-colors duration-300">
      <MarketingNav />
      <main id="main-content" className="mx-auto max-w-4xl px-5 pb-20 pt-14 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--mkt-text-3)]">Company information</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Legal information</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-[var(--mkt-text-2)]">This page identifies the operator of the ReconIQ website and explains how public website information relates to a commercial agreement.</p>
        <p className="mt-4 text-sm text-[var(--mkt-text-3)]">Last updated: 27 September 2026</p>

        <div className="mt-12 space-y-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:leading-7 [&_p]:text-[var(--mkt-text-2)]">
          <section aria-labelledby="operator">
            <h2 id="operator">Website operator</h2>
            <p>ReconIQ India Pvt Limited</p>
            <p>13th Floor, M2 Block, North Avenue<br />Manyata Embassy Business Park<br />Outer Ring Road, Nagavara<br />Bengaluru, Karnataka 560045<br />India</p>
          </section>

          <section aria-labelledby="enquiries">
            <h2 id="enquiries">Enquiries</h2>
            <p>For product, commercial or privacy enquiries, use our <Link className="text-[var(--mkt-accent)] underline underline-offset-4" to="/contact">contact form</Link>.</p>
          </section>

          <section aria-labelledby="website-information">
            <h2 id="website-information">Website information and service agreements</h2>
            <p>Website demonstrations, plan descriptions, illustrations and estimates are information for discussion. They are not a customer-specific quotation, guaranteed outcome, service-level commitment or statement that a planned capability is currently available. The scope, price, data handling, support and service levels for a customer are set out in an agreed order form and applicable written terms.</p>
          </section>

          <section aria-labelledby="materials">
            <h2 id="materials">Materials and third-party references</h2>
            <p>ReconIQ names, artwork and website materials belong to their respective rights holders. References to laws, standards, platforms or third-party products describe context; they do not imply certification, endorsement or a legal opinion. Contact us before reusing substantial website content.</p>
          </section>

          <section aria-labelledby="privacy-reference">
            <h2 id="privacy-reference">Privacy</h2>
            <p>Our <Link className="text-[var(--mkt-accent)] underline underline-offset-4" to="/privacy">Privacy Notice</Link> explains public website and enquiry information. Customer application data is subject to the relevant customer agreement and instructions.</p>
          </section>
        </div>

        <nav aria-label="Related information" className="mt-14 flex flex-wrap gap-5 border-t border-[var(--mkt-line)] pt-6 text-sm">
          <Link className="text-[var(--mkt-accent)] underline underline-offset-4" to="/privacy">Privacy Notice</Link>
          <Link className="text-[var(--mkt-accent)] underline underline-offset-4" to="/security">Security overview</Link>
          <Link className="text-[var(--mkt-accent)] underline underline-offset-4" to="/contact">Contact us</Link>
          <a className="text-[var(--mkt-accent)] underline underline-offset-4" href="mailto:legal@reconintelligence.app">legal@reconintelligence.app</a>
        </nav>
      </main>
      <MarketingFooter />
    </div>
  );
}
