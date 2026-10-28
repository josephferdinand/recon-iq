import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy Notice — ReconIQ" },
      { name: "description", content: "How ReconIQ handles website, enquiry and account contact information." },
      { property: "og:title", content: "Privacy Notice — ReconIQ" },
      { property: "og:description", content: "How ReconIQ handles website, enquiry and account contact information." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/privacy" }],
  }),
});

const company = "ReconIQ India Pvt Limited";
const address = "13th Floor, M2 Block, North Avenue, Manyata Embassy Business Park, Outer Ring Road, Nagavara, Bengaluru, Karnataka 560045, India";

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />
      <main id="main-content" className="mx-auto max-w-4xl px-5 pb-20 pt-14 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#86868b]">Privacy &amp; trust</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Privacy Notice</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-[#a1a1a6]">
          This notice explains how we use personal information when you visit our public website, request a plan discussion or demo, or contact our team. Customer-controlled data processed inside the ReconIQ application is governed by the applicable customer agreement and instructions, not by a public enquiry form.
        </p>
        <p className="mt-4 text-sm text-[#86868b]">Last updated: 27 September 2026</p>

        <div className="mt-12 space-y-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:leading-7 [&_p]:text-[#a1a1a6] [&_li]:leading-7 [&_li]:text-[#a1a1a6]">
          <section aria-labelledby="who-we-are">
            <h2 id="who-we-are">Who is responsible</h2>
            <p>{company} operates this website and handles public enquiries. Our address is {address}. For privacy requests, use our <Link className="text-[#2997ff] underline underline-offset-4" to="/contact">contact form</Link>.</p>
          </section>

          <section aria-labelledby="information-we-receive">
            <h2 id="information-we-receive">Information we receive</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Details you submit in a contact, pricing or demo request, such as your name, work email, mobile number, company, country, selected plan and the purpose of your enquiry.</li>
              <li>Messages you choose to send to support or our website assistant, and appointment details if you request a meeting.</li>
              <li>If you use ReconIQ Copilot, your messages, conversation context and relevant knowledge-base queries. If you ask for follow-up, we may link that conversation to your enquiry. Please do not send confidential or sensitive information through the public assistant.</li>
              <li>Technical and campaign information, including IP address, browser and user-agent details, request time, page path, referrer, campaign parameters, inferred region and a site session identifier.</li>
            </ul>
          </section>

          <section aria-labelledby="why-we-use-it">
            <h2 id="why-we-use-it">Why we use it</h2>
            <p>We use enquiry details to answer your request, arrange a demonstration and prepare a relevant commercial discussion. We score and categorise enquiries so the right team can respond, and keep a record of correspondence. We use technical events to protect the site, diagnose faults and understand campaign and page performance. ReconIQ Copilot processes conversation context to generate replies; our configured AI service receives the information needed to answer. We do not use a public chat message as authority to change your application data.</p>
            <p className="mt-3">For UK/EEA visitors, we rely on the steps you request before a contract for a requested demo or proposal, legitimate interests for business-enquiry handling and site security, and consent for optional marketing communications where required. We assess device-storage and tracking requirements separately; a privacy notice is not a substitute for a consent choice where one is required.</p>
          </section>

          <section aria-labelledby="sharing">
            <h2 id="sharing">Who may receive it</h2>
            <p>Authorised ReconIQ personnel and service providers supporting website delivery, hosting, enquiry storage, email delivery and the configured AI assistant may handle information for these purposes. Public chat context can be sent to that AI service to produce a reply. We disclose information when legally required. A public enquiry does not grant a prospective customer access to another tenant&apos;s application data. Contact us for the current provider and transfer details applicable to your enquiry.</p>
          </section>

          <section aria-labelledby="location-retention">
            <h2 id="location-retention">Location and retention</h2>
            <p>Our current application production and development projects are UK-hosted. Website delivery, email and AI communications can involve providers operating in other locations; this notice is not a guarantee that every website processing step remains in one country.</p>
            <p className="mt-3">Enquiries and related correspondence are kept while we handle the request and for any subsequent commercial relationship or applicable legal need. Security and site-event records are kept for operational investigation and measurement according to their purpose. No fixed automated deletion period for marketing leads is established in the current public flow; we will not imply one. You may ask for the criteria applied to your information or request deletion via our <Link className="text-[#2997ff] underline underline-offset-4" to="/contact">contact form</Link>, subject to applicable requirements.</p>
          </section>

          <section aria-labelledby="choices-rights">
            <h2 id="choices-rights">Your choices and rights</h2>
            <p>You may ask about the information we hold about you and request access, correction, deletion, restriction or a portable copy where applicable law provides those rights. You may withdraw optional marketing consent at any time.</p>
            <p className="mt-3 font-medium text-[#f5f5f7]">You have the right to object to processing based on our legitimate interests. Tell us what you object to so we can assess your request.</p>
            <p className="mt-3">Use our <Link className="text-[#2997ff] underline underline-offset-4" to="/contact">contact form</Link>; we may need to verify your identity before acting. If your employer controls data inside a customer tenant, please also contact its administrator. UK visitors may complain to the <a className="text-[#2997ff] underline underline-offset-4" href="https://ico.org.uk/make-a-complaint/">Information Commissioner&apos;s Office</a>; others may contact their relevant data-protection authority.</p>
          </section>

          <section aria-labelledby="cookies">
            <h2 id="cookies">Cookies and similar technologies</h2>
            <p>The public website currently uses browser session storage for a site-session identifier and inferred region. We record selected page views, clicks, form submissions and downloads for campaign and site-performance analysis; events can include page path, referrer, campaign parameters, session identifier, IP address and browser user agent. Technical storage may also support security and site preferences. We are assessing which storage/access uses require a separate choice under applicable law; this page itself is not a cookie-consent control. Contact us via our <Link className="text-[#2997ff] underline underline-offset-4" to="/contact">contact form</Link> for the current technology inventory.</p>
          </section>

          <section aria-labelledby="updates">
            <h2 id="updates">Changes to this notice</h2>
            <p>We will update the date and wording on this page when our practices change. Contracted customer processing terms are handled separately through the relevant agreement.</p>
          </section>
        </div>

        <nav aria-label="Related information" className="mt-14 flex flex-wrap gap-5 border-t border-white/10 pt-6 text-sm">
          <Link className="text-[#2997ff] underline underline-offset-4" to="/legal">Legal information</Link>
          <Link className="text-[#2997ff] underline underline-offset-4" to="/security">Security overview</Link>
          <Link className="text-[#2997ff] underline underline-offset-4" to="/contact">Contact us</Link>
        </nav>
      </main>
      <MarketingFooter />
    </div>
  );
}
