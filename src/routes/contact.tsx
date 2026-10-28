import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, Mail, MapPin, MessageSquare, Sparkles, Shield, Clock, Building2 } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AREAS_OF_INTEREST } from "@/lib/mkt-leads.functions";
import { parsePublicLeadResponse, publicLeadEndpoint } from "@/lib/public-lead-client";

const CONTACT_PLANS = ["Professional", "Institutional", "Enterprise", "Not sure yet"] as const;

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => ({
    meta: [
      { title: "Contact ReconIQ — Talk to reconciliation experts" },
      { name: "description", content: "Speak with ReconIQ about enterprise reconciliation, exception management, and AI automation. Book a demo, contact sales, or chat with ReconIQ Copilot." },
      { property: "og:title", content: "Contact ReconIQ" },
      { property: "og:description", content: "Enterprise reconciliation, AI automation — talk to our experts." },
    ],
  }),
});

const COMPANY_SIZE = ["1–49","50–249","250–999","1,000–4,999","5,000–9,999","10,000+"];
const INDUSTRIES = ["Banking","Capital Markets","Asset Management","Insurance","Wealth Management","Fintech","Broker Dealer","Custody","Exchange","Clearing","Other"];
const VOLUME = ["<10k","10k–100k","100k–1M","1M–10M","10M+"];

const NOIR_BG = "var(--brand-coffee-deep)";
const CREAM = "var(--brand-cream)";
const GOLD = "var(--brand-gold)";

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
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleArea(a: string) {
    setAreas((cur) => cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]);
  }

  return (
    <div className="min-h-screen" style={{ background: NOIR_BG, color: CREAM }}>
      <MarketingNav />

      {/* Hero — noir cinematic */}
      <section className="relative overflow-hidden border-b" style={{ borderColor: `color-mix(in oklab, ${GOLD} 18%, transparent)` }}>
        {/* Ambient gold aurora */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2 }}
          style={{
            background: `radial-gradient(600px 400px at 15% 20%, color-mix(in oklab, ${GOLD} 14%, transparent), transparent 65%), radial-gradient(500px 380px at 85% 80%, color-mix(in oklab, ${GOLD} 8%, transparent), transparent 70%)`,
          }}
        />
        {/* Gold beam */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
          style={{
            background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
            boxShadow: `0 0 12px color-mix(in oklab, ${GOLD} 60%, transparent)`,
            transformOrigin: "left",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-4 py-16 md:py-24">
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition hover:opacity-80"
            style={{
              borderColor: `color-mix(in oklab, ${GOLD} 35%, transparent)`,
              color: CREAM,
              background: `color-mix(in oklab, ${GOLD} 6%, transparent)`,
            }}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to main
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em]"
            style={{
              color: GOLD,
              border: `1px solid color-mix(in oklab, ${GOLD} 35%, transparent)`,
              background: `color-mix(in oklab, ${GOLD} 8%, transparent)`,
            }}
          >
            <Sparkles className="h-3 w-3" /> Enterprise engagement
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
            className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl"
          >
            Talk to the team behind{" "}
            <span
              style={{
                background: `linear-gradient(90deg, ${CREAM}, ${GOLD}, ${CREAM})`,
                backgroundSize: "200% 100%",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              ReconIQ
            </span>
            .
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
            className="mt-5 max-w-2xl text-base md:text-lg"
            style={{ color: `color-mix(in oklab, ${CREAM} 78%, transparent)` }}
          >
            Enterprise reconciliation, exception management, and agentic AI —
            engineered for regulated institutions. Book a demo, brief our architects,
            or start a live conversation with ReconIQ Copilot.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <Button
              asChild
              size="lg"
              style={{ background: GOLD, color: NOIR_BG }}
              className="hover:opacity-90"
            >
              <Link to="/book-demo">Book a Demo</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              style={{ borderColor: `color-mix(in oklab, ${GOLD} 40%, transparent)`, color: CREAM, background: "transparent" }}
            >
              <a href="#form">Contact Sales</a>
            </Button>
            <Button
              size="lg"
              variant="ghost"
              style={{ color: CREAM }}
              onClick={() => window.dispatchEvent(new CustomEvent("dr-falcon:open"))}
            >
              <Sparkles className="mr-2 h-4 w-4" style={{ color: GOLD }} /> Talk to ReconIQ Copilot
            </Button>
          </motion.div>

          {/* Trust ribbon */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-12 grid gap-4 sm:grid-cols-3"
          >
            {[
              { icon: Shield, label: "SOC 2 · ISO 27001", sub: "Enterprise controls" },
              { icon: Clock, label: "Personalized follow-up", sub: "From our sales team" },
              { icon: Building2, label: "Global banks & FIs", sub: "Deployed in production" },
            ].map(({ icon: Icon, label, sub }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border px-4 py-3"
                style={{
                  borderColor: `color-mix(in oklab, ${GOLD} 18%, transparent)`,
                  background: `color-mix(in oklab, ${CREAM} 3%, transparent)`,
                }}
              >
                <Icon className="h-5 w-5" style={{ color: GOLD }} />
                <div>
                  <div className="text-sm font-medium" style={{ color: CREAM }}>{label}</div>
                  <div className="text-[11px] uppercase tracking-wider" style={{ color: `color-mix(in oklab, ${CREAM} 60%, transparent)` }}>{sub}</div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Body: form + rail */}
      <section id="form" className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[1.6fr_1fr]">
        {ok ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border p-8"
            style={{
              borderColor: `color-mix(in oklab, ${GOLD} 30%, transparent)`,
              background: `color-mix(in oklab, ${CREAM} 4%, transparent)`,
            }}
          >
            <h2 className="font-display text-2xl font-semibold">Received — thank you.</h2>
            <p className="mt-2 text-sm" style={{ color: `color-mix(in oklab, ${CREAM} 75%, transparent)` }}>
              {ok.notificationQueued
                ? "We’ll follow up about your enquiry."
                : "We’ve received your enquiry. For urgent follow-up, please email support@reconiq.example."}
            </p>
            <div className="mt-6 flex gap-3">
              <Button asChild style={{ background: GOLD, color: NOIR_BG }}><Link to="/book-demo">Book a demo now</Link></Button>
              <Button asChild variant="outline" style={{ borderColor: `color-mix(in oklab, ${GOLD} 40%, transparent)`, color: CREAM, background: "transparent" }}>
                <Link to="/">Return home</Link>
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.form
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            onSubmit={onSubmit}
            className="space-y-10 rounded-xl border p-6 md:p-8"
            style={{
              borderColor: `color-mix(in oklab, ${GOLD} 22%, transparent)`,
              background: `color-mix(in oklab, ${CREAM} 4%, transparent)`,
              backdropFilter: "blur(6px)",
            }}
          >
            <FormSection title="Contact information" step="01">
              <div className="grid gap-4 md:grid-cols-2">
                <Field name="first_name" label="First name" required />
                <Field name="last_name" label="Last name" required />
                <Field name="email" type="email" label="Business email" required />
                <Field name="mobile" label="Mobile number" required />
                <Field name="company" label="Company name" required />
                <Field name="job_title" label="Job title" />
                <Field name="country" label="Country" required />
                <div>
                  <FieldLabel htmlFor="industry">Industry</FieldLabel>
                  <Select value={industry} onValueChange={setIndustry}>
                    <SelectTrigger id="industry" className="border-0" style={selectStyle}><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>{INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </FormSection>

            <FormSection title="Business details" step="02">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="company-size">Company size</FieldLabel>
                  <Select value={companySize} onValueChange={setCompanySize}>
                    <SelectTrigger id="company-size" className="border-0" style={selectStyle}><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>{COMPANY_SIZE.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <FieldLabel htmlFor="monthly-transaction-volume">Monthly transaction volume</FieldLabel>
                  <Select value={volume} onValueChange={setVolume}>
                    <SelectTrigger id="monthly-transaction-volume" className="border-0" style={selectStyle}><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>{VOLUME.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Field name="current_recon_tool" label="Current reconciliation tool" />
                <Field name="erp_platform" label="ERP platform" />
              </div>

              <div className="mt-6">
                <FieldLabel>Areas of interest</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {AREAS_OF_INTEREST.map((a) => {
                    const active = areas.includes(a);
                    return (
                      <motion.button
                        type="button"
                        key={a}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => toggleArea(a)}
                        className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                        style={
                          active
                            ? { borderColor: GOLD, background: GOLD, color: NOIR_BG }
                            : {
                                borderColor: `color-mix(in oklab, ${GOLD} 25%, transparent)`,
                                background: `color-mix(in oklab, ${CREAM} 4%, transparent)`,
                                color: `color-mix(in oklab, ${CREAM} 80%, transparent)`,
                              }
                        }
                      >
                        {a}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </FormSection>

            <FormSection title="Your inquiry" step="03">
              <div className="mb-5">
                <FieldLabel htmlFor="plan">Plan of interest</FieldLabel>
                <Select required value={selectedPlan || requestedPlan || ""} onValueChange={setSelectedPlan}>
                  <SelectTrigger id="plan" className="border-0" style={selectStyle}><SelectValue placeholder="Select a plan…" /></SelectTrigger>
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
                className="mb-5 border-0 focus-visible:ring-0"
                style={{ background: `color-mix(in oklab, ${CREAM} 6%, transparent)`, color: CREAM, border: `1px solid color-mix(in oklab, ${GOLD} 22%, transparent)` }}
              />
              <FieldLabel htmlFor="message">Message / requirements</FieldLabel>
              <Textarea
                id="message"
                name="message"
                rows={5}
                placeholder="Tell us about your reconciliation landscape, pain points, or RFP timeline."
                className="border-0 focus-visible:ring-0"
                style={{
                  background: `color-mix(in oklab, ${CREAM} 6%, transparent)`,
                  color: CREAM,
                  border: `1px solid color-mix(in oklab, ${GOLD} 22%, transparent)`,
                }}
              />
            </FormSection>

            <label className="flex items-start gap-3 text-sm" style={{ color: `color-mix(in oklab, ${CREAM} 78%, transparent)` }}>
              <Checkbox checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} />
              <span>
                I consent to ReconIQ contacting me regarding my inquiry. Read our{" "}
                <Link to="/privacy" className="underline underline-offset-2">Privacy Notice</Link>.
              </span>
            </label>

            <div>
              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                style={{ background: GOLD, color: NOIR_BG }}
                className="hover:opacity-90"
              >
                {submitting ? "Submitting…" : "Request Consultation"}
              </Button>
            </div>
          </motion.form>
        )}

        <motion.aside
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="space-y-6"
        >
          <div
            className="rounded-xl border p-6"
            style={{
              borderColor: `color-mix(in oklab, ${GOLD} 22%, transparent)`,
              background: `color-mix(in oklab, ${CREAM} 4%, transparent)`,
            }}
          >
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-5 w-5" style={{ color: GOLD }} />
              <div>
                <div className="text-xs uppercase tracking-wide" style={{ color: `color-mix(in oklab, ${CREAM} 60%, transparent)` }}>Customer support</div>
                <a href="mailto:support@reconiq.example" className="text-sm font-medium hover:underline" style={{ color: CREAM }}>
                  support@reconiq.example
                </a>
              </div>
            </div>
            <div className="mt-5 flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5" style={{ color: GOLD }} />
              <div className="text-sm" style={{ color: `color-mix(in oklab, ${CREAM} 80%, transparent)` }}>
                <div className="text-xs uppercase tracking-wide" style={{ color: `color-mix(in oklab, ${CREAM} 60%, transparent)` }}>Headquarters</div>
                <div className="font-medium" style={{ color: CREAM }}>ReconIQ HQ</div>
                <div>Solarium City</div>
                <div>Bangalore – 560043</div>
              </div>
            </div>
          </div>

          <div
            className="relative overflow-hidden rounded-xl border p-6"
            style={{
              borderColor: `color-mix(in oklab, ${GOLD} 35%, transparent)`,
              background: `linear-gradient(140deg, color-mix(in oklab, ${GOLD} 14%, transparent), transparent 70%)`,
            }}
          >
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full"
              animate={{ scale: [1, 1.15, 1], opacity: [0.35, 0.6, 0.35] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              style={{ background: `radial-gradient(circle, ${GOLD}, transparent 70%)` }}
            />
            <MessageSquare className="h-6 w-6" style={{ color: GOLD }} />
            <h3 className="mt-3 font-display text-lg font-semibold" style={{ color: CREAM }}>Talk to ReconIQ Copilot</h3>
            <p className="mt-1 text-sm" style={{ color: `color-mix(in oklab, ${CREAM} 78%, transparent)` }}>
              Our AI product advisor is available 24/7 to answer product questions and schedule demos.
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => window.dispatchEvent(new CustomEvent("dr-falcon:open"))}
              style={{ borderColor: `color-mix(in oklab, ${GOLD} 45%, transparent)`, color: CREAM, background: "transparent" }}
            >
              Start conversation
            </Button>
          </div>

          <div
            className="rounded-xl border p-6"
            style={{
              borderColor: `color-mix(in oklab, ${GOLD} 22%, transparent)`,
              background: `color-mix(in oklab, ${CREAM} 4%, transparent)`,
            }}
          >
            <div className="text-xs uppercase tracking-[0.18em]" style={{ color: GOLD }}>Why teams switch to ReconIQ</div>
            <ul className="mt-3 space-y-2 text-sm" style={{ color: `color-mix(in oklab, ${CREAM} 82%, transparent)` }}>
              <li>◂ Hours-to-live, not months</li>
              <li>◂ Agentic exception resolution</li>
              <li>◂ BYO-LLM &amp; data sovereignty</li>
              <li>◂ SHA-256 hash-chained audit</li>
            </ul>
          </div>
        </motion.aside>
      </section>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: `color-mix(in oklab, ${CREAM} 6%, transparent)`,
  color: CREAM,
  border: `1px solid color-mix(in oklab, ${GOLD} 22%, transparent)`,
};

function FormSection({ title, step, children }: { title: string; step: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <span
          className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded-full px-2 font-mono text-[10px] tracking-wider"
          style={{
            color: GOLD,
            border: `1px solid color-mix(in oklab, ${GOLD} 35%, transparent)`,
            background: `color-mix(in oklab, ${GOLD} 8%, transparent)`,
          }}
        >
          {step}
        </span>
        <h2 className="font-display text-lg font-semibold" style={{ color: CREAM }}>{title}</h2>
        <div className="ml-2 h-px flex-1" style={{ background: `color-mix(in oklab, ${GOLD} 22%, transparent)` }} />
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <Label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em]"
      style={{ color: `color-mix(in oklab, ${CREAM} 65%, transparent)` }}
    >
      {children}
    </Label>
  );
}

function Field({ name, label, type = "text", required = false }: { name: string; label: string; type?: string; required?: boolean }) {
  return (
    <div>
      <FieldLabel htmlFor={name}>
        {label}{required ? " *" : ""}
      </FieldLabel>
      <Input
        id={name}
        name={name}
        type={type}
        required={required}
        className="border-0 focus-visible:ring-0"
        style={{
          background: `color-mix(in oklab, ${CREAM} 6%, transparent)`,
          color: CREAM,
          border: `1px solid color-mix(in oklab, ${GOLD} 22%, transparent)`,
        }}
      />
    </div>
  );
}
