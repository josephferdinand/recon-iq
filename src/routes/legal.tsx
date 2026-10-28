import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingNav } from "@/components/marketing-nav";

export const Route = createFileRoute("/legal")({
  component: LegalPage,
  head: () => ({
    meta: [
      { title: "Legal Information — ReconIQ" },
      { name: "description", content: "Operator details and website-use information for ReconIQ." },
    ],
    links: [{ rel: "canonical", href: "https://reconiq.example/legal" }],
  }),
});

function LegalPage() {
  return (
    <div className="min-h-screen bg-[#03070e] text-[#e8e3d8]">
      <MarketingNav />
      <main id="main-content" className="mx-auto max-w-4xl px-5 pb-20 pt-14 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d4b776]">Company information</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Legal information</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-[#c2c5ca]">This page identifies the operator of the ReconIQ website and explains how public website information relates to a commercial agreement.</p>
        <p className="mt-4 text-sm text-[#aeb4bd]">Last updated: 27 September 2026</p>

        <div className="mt-12 space-y-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:leading-7 [&_p]:text-[#c2c5ca]">
          <section aria-labelledby="operator">
            <h2 id="operator">Website operator</h2>
            <p>ReconIQ India Pvt Limited</p>
            <p>13th Floor, M2 Block, North Avenue<br />Manyata Embassy Business Park<br />Outer Ring Road, Nagavara<br />Bengaluru, Karnataka 560045<br />India</p>
          </section>

          <section aria-labelledby="enquiries">
            <h2 id="enquiries">Enquiries</h2>
            <p>For product or commercial enquiries, use our <Link className="text-[#e7c77d] underline underline-offset-4" to="/contact">contact form</Link>. For privacy matters, email <a className="text-[#e7c77d] underline underline-offset-4" href="mailto:privacy@reconiq.example">privacy@reconiq.example</a>.</p>
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
            <p>Our <Link className="text-[#e7c77d] underline underline-offset-4" to="/privacy">Privacy Notice</Link> explains public website and enquiry information. Customer application data is subject to the relevant customer agreement and instructions.</p>
          </section>
        </div>

        <nav aria-label="Related information" className="mt-14 flex flex-wrap gap-5 border-t border-[#d4b776]/20 pt-6 text-sm">
          <Link className="text-[#e7c77d] underline underline-offset-4" to="/privacy">Privacy Notice</Link>
          <Link className="text-[#e7c77d] underline underline-offset-4" to="/security">Security overview</Link>
          <Link className="text-[#e7c77d] underline underline-offset-4" to="/contact">Contact us</Link>
        </nav>
      </main>
    </div>
  );
}
