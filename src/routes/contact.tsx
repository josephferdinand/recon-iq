import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, MessageSquare } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AREAS_OF_INTEREST } from "@/lib/mkt-leads.functions";
import { parsePublicLeadResponse, publicLeadEndpoint } from "@/lib/public-lead-client";
import { appUrl } from "@/lib/cross-domain";
import { notifyUserError } from "@/lib/user-feedback";

const CONTACT_PLANS = ["Professional", "Institutional", "Enterprise", "Not sure yet"] as const;

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => ({
    meta: [
      { title: "Contact ReconIQ — Talk to reconciliation experts" },
      { name: "description", content: "Speak with ReconIQ about enterprise reconciliation, exception management, and AI automation. Book a demo, contact sales, or chat with ReconIQ Copilot." },
      { property: "og:title", content: "Contact ReconIQ" },
      { property: "og:description", content: "Enterprise reconciliation, AI automation — talk to our experts." },
      { property: "og:url", content: "https://reconintelligence.app/contact" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/contact" }],
  }),
});

const COMPANY_SIZE = ["1–49","50–249","250–999","1,000–4,999","5,000–9,999","10,000+"];
const INDUSTRIES = ["Banking","Capital Markets","Asset Management","Insurance","Wealth Management","Fintech","Broker Dealer","Custody","Exchange","Clearing","Other"];
const VOLUME = ["<10k","10k–100k","100k–1M","1M–10M","10M+"];

const inputClass =
  "h-11 rounded-xl border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3.5 text-[var(--mkt-text)] placeholder:text-[var(--mkt-text-3)] focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]";
const selectClass =
  "h-11 rounded-xl border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3.5 text-[var(--mkt-text)] data-[placeholder]:text-[var(--mkt-text-3)] focus:ring-2 focus:ring-[var(--mkt-accent)]";
const textareaClass =
  "rounded-xl border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3.5 py-3 text-[var(--mkt-text)] placeholder:text-[var(--mkt-text-3)] focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]";

function ContactPage() {
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<{ notificationQueued: boolean } | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [requestedPlan, setRequestedPlan] = useState<string>("");
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [companySize, setCompanySize] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");
  const [volume, setVolume] = useState<string>("");

  useEffect(() => {
    const queryPlan = new URLSearchParams(window.location.search).get("plan");
    if (queryPlan && (CONTACT_PLANS as readonly string[]).includes(queryPlan)) setRequestedPlan(queryPlan);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!consent) { toast.error("Please provide consent to continue."); return; }
    if (!(selectedPlan || requestedPlan)) { toast.error("Please select a plan of interest."); return; }
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    try {
      const res = await fetch(publicLeadEndpoint(window.location.origin, import.meta.env.VITE_FVI_APP_API_ORIGIN), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: fd.get("first_name"),
          last_name: fd.get("last_name"),
          email: fd.get("email"),
          mobile: fd.get("mobile") || null,
          company: fd.get("company"),
          plan: selectedPlan || requestedPlan || null,
          purpose: fd.get("purpose"),
          job_title: fd.get("job_title") || null,
          country: fd.get("country") || null,
          industry: industry || null,
          company_size: companySize || null,
          current_recon_tool: fd.get("current_recon_tool") || null,
          erp_platform: fd.get("erp_platform") || null,
          monthly_txn_volume: volume || null,
          areas_of_interest: areas,
          message: fd.get("message") || null,
          consent: true,
          source: "contact_form",
        }),
      });
      const body = await parsePublicLeadResponse(res);
      setOk({ notificationQueued: body.notification_queued });
      toast.success("Thanks — we’ve received your enquiry.");
    } catch (err) {
      notifyUserError(err, "contact_form");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleArea(a: string) {
    setAreas((cur) => cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]);
  }

  return (
    <div className="min-h-screen bg-[var(--mkt-bg)] text-[var(--mkt-text)] transition-colors duration-300">
      <MarketingNav />

      <main>
        <section className="border-b border-[var(--mkt-line)]">
          <div className="mx-auto max-w-6xl px-6 pb-14 pt-16 md:pt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">Contact</p>
            <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
              Talk to us about reconciliation.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--mkt-text-2)] md:text-lg">
              Tell us about your reconciliation workflows and what you are evaluating. If you would
              rather see the product first, book a demo or open the live product.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="bg-[var(--mkt-btn-bg)] text-[var(--mkt-btn-text)] hover:opacity-85">
                <Link to="/book-demo">Book a demo</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-[var(--mkt-line-strong)] bg-transparent text-[var(--mkt-text)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]"
              >
                <a href={appUrl("/auth")}>Open the live product</a>
              </Button>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("dr-falcon:open"))}
                className="inline-flex h-10 items-center gap-2 px-2 text-sm font-medium text-[var(--mkt-accent)] transition-colors hover:text-[var(--mkt-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)] rounded-md"
              >
                <MessageSquare className="h-4 w-4" /> Ask ReconIQ Copilot
              </button>
            </div>
          </div>
        </section>

        <section aria-label="Email directory" className="border-b border-[var(--mkt-line)]">
          <div className="mx-auto max-w-6xl px-6 py-12">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">
              Prefer email?
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "General", email: "hello@reconintelligence.app", note: "Sales, partnerships, anything else" },
                { label: "Support", email: "support@reconintelligence.app", note: "Product help for customers" },
                { label: "Security", email: "security@reconintelligence.app", note: "Report a security concern" },
                { label: "Privacy", email: "privacy@reconintelligence.app", note: "Privacy and data requests" },
                { label: "Legal", email: "legal@reconintelligence.app", note: "Contracts and legal notices" },
              ].map((c) => (
                <div key={c.email} className="rounded-2xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-5">
                  <p className="text-sm font-semibold">{c.label}</p>
                  <a
                    href={`mailto:${c.email}`}
                    className="mt-1.5 block break-all text-sm text-[var(--mkt-accent)] underline-offset-4 hover:underline"
                  >
                    {c.email}
                  </a>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--mkt-text-2)]">{c.note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="form" className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-[1.6fr_1fr]">
          {ok ? (
            <div className="h-fit rounded-3xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">Enquiry received</p>
              <h2 className="mt-3 font-display text-2xl font-semibold">Thanks — we’ve received your enquiry.</h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--mkt-text-2)]">
                {ok.notificationQueued
                  ? "We’ll follow up about your enquiry using the details you provided."
                  : "We’ve received your enquiry. If you need help sooner, visit the Support center."}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild className="bg-[var(--mkt-btn-bg)] text-[var(--mkt-btn-text)] hover:opacity-85"><Link to="/book-demo">Book a demo now</Link></Button>
                <Button asChild variant="outline" className="border-[var(--mkt-line-strong)] bg-transparent text-[var(--mkt-text)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]">
                  <Link to="/support">Visit Support center</Link>
                </Button>
                <Button asChild variant="ghost" className="text-[var(--mkt-text-2)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]">
                  <Link to="/">Return home</Link>
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              className="h-fit space-y-10 rounded-3xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-6 md:p-8"
            >
              <FormSection title="Contact information" step="01">
                <div className="grid gap-5 md:grid-cols-2">
                  <Field name="first_name" label="First name" required autoComplete="given-name" />
                  <Field name="last_name" label="Last name" required autoComplete="family-name" />
                  <Field name="email" type="email" label="Business email" required autoComplete="email" helper="We’ll only use this to reply to your enquiry." />
                  <Field name="mobile" label="Mobile number" required autoComplete="tel" />
                  <Field name="company" label="Company name" required autoComplete="organization" />
                  <Field name="job_title" label="Job title" autoComplete="organization-title" />
                  <Field name="country" label="Country" required autoComplete="country-name" />
                  <div>
                    <FieldLabel htmlFor="industry">Industry</FieldLabel>
                    <Select value={industry} onValueChange={setIndustry}>
                      <SelectTrigger id="industry" className={selectClass}><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>{INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </FormSection>

              <FormSection title="Business details" step="02">
                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="company-size">Company size</FieldLabel>
                    <Select value={companySize} onValueChange={setCompanySize}>
                      <SelectTrigger id="company-size" className={selectClass}><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>{COMPANY_SIZE.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="monthly-transaction-volume">Monthly transaction volume</FieldLabel>
                    <Select value={volume} onValueChange={setVolume}>
                      <SelectTrigger id="monthly-transaction-volume" className={selectClass}><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>{VOLUME.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Field name="current_recon_tool" label="Current reconciliation tool" helper="For example, a spreadsheet process or an existing platform." />
                  <Field name="erp_platform" label="ERP platform" />
                </div>

                <div className="mt-6">
                  <FieldLabel>Areas of interest</FieldLabel>
                  <p className="mb-3 text-xs text-[var(--mkt-text-3)]">Select any that apply — this helps us route your enquiry.</p>
                  <div className="flex flex-wrap gap-2">
                    {AREAS_OF_INTEREST.map((a) => {
                      const active = areas.includes(a);
                      return (
                        <button
                          type="button"
                          key={a}
                          aria-pressed={active}
                          onClick={() => toggleArea(a)}
                          className={
                            active
                              ? "rounded-full border border-[var(--mkt-btn-bg)] bg-[var(--mkt-btn-bg)] px-3.5 py-1.5 text-xs font-medium text-[var(--mkt-btn-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                              : "rounded-full border border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3.5 py-1.5 text-xs text-[var(--mkt-text-2)] transition-colors hover:border-[var(--mkt-line-strong)] hover:text-[var(--mkt-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                          }
                        >
                          {a}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </FormSection>

              <FormSection title="Your inquiry" step="03">
                <div className="mb-5">
                  <FieldLabel htmlFor="plan">Plan of interest *</FieldLabel>
                  <Select required value={selectedPlan || requestedPlan || ""} onValueChange={setSelectedPlan}>
                    <SelectTrigger id="plan" className={selectClass}><SelectValue placeholder="Select a plan…" /></SelectTrigger>
                    <SelectContent>{CONTACT_PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <FieldLabel htmlFor="purpose">Purpose of your request *</FieldLabel>
                <Textarea
                  id="purpose"
                  name="purpose"
                  required
                  maxLength={240}
                  rows={2}
                  placeholder="For example: pricing, product briefing, or deployment discussion."
                  className={textareaClass}
                />
                <div className="mt-5">
                  <FieldLabel htmlFor="message">Message / requirements</FieldLabel>
                  <Textarea
                    id="message"
                    name="message"
                    rows={5}
                    placeholder="Tell us about your reconciliation landscape, pain points, or RFP timeline."
                    className={textareaClass}
                  />
                </div>
              </FormSection>

              <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-[var(--mkt-text-2)]">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} className="mt-0.5 border-[var(--mkt-line-strong)] data-[state=checked]:border-[var(--mkt-btn-bg)] data-[state=checked]:bg-[var(--mkt-btn-bg)] data-[state=checked]:text-[var(--mkt-btn-text)]" />
                <span>
                  I consent to ReconIQ contacting me regarding my inquiry. Read our{" "}
                  <Link to="/privacy" className="text-[var(--mkt-accent)] underline underline-offset-2 hover:text-[var(--mkt-text)]">Privacy Notice</Link>.
                </span>
              </label>

              <div>
                <Button
                  type="submit"
                  size="lg"
                  disabled={submitting}
                  className="bg-[var(--mkt-btn-bg)] text-[var(--mkt-btn-text)] hover:opacity-85"
                >
                  {submitting ? "Submitting…" : "Request Consultation"}
                </Button>
                <p className="mt-3 text-xs text-[var(--mkt-text-3)]">Fields marked * are required. We’ll reply using the details above.</p>
              </div>
            </form>
          )}

          <aside className="space-y-4">
            <div className="rounded-3xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">Other ways to reach us</h3>
              <ul className="mt-4 space-y-3 text-sm">
                <li>
                  <Link to="/support" className="inline-flex items-center gap-1.5 font-medium text-[var(--mkt-accent)] hover:text-[var(--mkt-text)]">
                    Support center <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <p className="mt-1 text-[var(--mkt-text-2)]">Guides, workflows, and troubleshooting.</p>
                </li>
                <li>
                  <Link to="/book-demo" className="inline-flex items-center gap-1.5 font-medium text-[var(--mkt-accent)] hover:text-[var(--mkt-text)]">
                    Book a demo <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <p className="mt-1 text-[var(--mkt-text-2)]">See the platform with your use case in mind.</p>
                </li>
                <li>
                  <a href={appUrl("/auth")} className="inline-flex items-center gap-1.5 font-medium text-[var(--mkt-accent)] hover:text-[var(--mkt-text)]">
                    Open the live product <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                  <p className="mt-1 text-[var(--mkt-text-2)]">ReconIQ is live — explore the working product.</p>
                </li>
              </ul>
            </div>

            <div className="rounded-3xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-6">
              <MessageSquare className="h-5 w-5 text-[var(--mkt-text-2)]" />
              <h3 className="mt-3 font-display text-lg font-semibold">Ask ReconIQ Copilot</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--mkt-text-2)]">
                Ask product questions and get pointed to the right demo or guide.
              </p>
              <Button
                className="mt-4 border-[var(--mkt-line-strong)] bg-transparent text-[var(--mkt-text)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]"
                variant="outline"
                onClick={() => window.dispatchEvent(new CustomEvent("dr-falcon:open"))}
              >
                Start conversation
              </Button>
            </div>

            <div className="rounded-3xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">What ReconIQ does</h3>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--mkt-text-2)]">
                <li>Deterministic matching for reconciliation workflows</li>
                <li>Human-approved, AI-assisted break resolution</li>
                <li>Hash-chained audit trail for every decision</li>
                <li>Tenant-scoped data with database-enforced isolation</li>
              </ul>
              <p className="mt-4 border-t border-[var(--mkt-line)] pt-4 text-xs leading-relaxed text-[var(--mkt-text-3)]">
                Security controls are designed with reference to SOC 2 and ISO 27001 frameworks.
                ReconIQ does not claim SOC 2 or ISO certification — see the Security page for status.
              </p>
            </div>
          </aside>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

function FormSection({ title, step, children }: { title: string; step: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-flex h-6 min-w-8 items-center justify-center rounded-full border border-[var(--mkt-line)] px-2 font-mono text-[10px] tracking-wider text-[var(--mkt-text-2)]">
          {step}
        </span>
        <h2 className="font-display text-lg font-semibold text-[var(--mkt-text)]">{title}</h2>
        <div className="ml-2 h-px flex-1 bg-[var(--mkt-surface-2)]" />
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <Label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-[var(--mkt-text)]">
      {children}
    </Label>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = false,
  autoComplete,
  helper,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  helper?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={name}>
        {label}{required ? " *" : ""}
      </FieldLabel>
      <Input id={name} name={name} type={type} required={required} autoComplete={autoComplete} className={inputClass} aria-describedby={helper ? `${name}-helper` : undefined} />
      {helper ? <p id={`${name}-helper`} className="mt-1.5 text-xs text-[var(--mkt-text-3)]">{helper}</p> : null}
    </div>
  );
}
