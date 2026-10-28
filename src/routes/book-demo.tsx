import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Clock,
  CheckCircle2,
  Sparkles,
  Shield,
  Building2,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parsePublicLeadResponse, publicLeadEndpoint } from "@/lib/public-lead-client";

export const Route = createFileRoute("/book-demo")({
  component: BookDemo,
  loader: () => ({ slotAnchorDate: new Date().toISOString().slice(0, 10) }),
  head: () => ({
    meta: [
      { title: "Book a ReconIQ demo — reconciliation, AI automation, exceptions" },
      {
        name: "description",
        content:
          "Schedule a 30–60 minute session with ReconIQ: product demo, discovery, technical deep-dive, or executive discussion.",
      },
      { property: "og:title", content: "Book a ReconIQ demo" },
      {
        property: "og:description",
        content: "Product demo, discovery call, technical consultation, or executive discussion.",
      },
    ],
  }),
});

const NOIR_BG = "var(--brand-coffee-deep)";
const CREAM = "var(--brand-cream)";
const GOLD = "var(--brand-gold)";

const TYPES = [
  {
    slug: "product_demo",
    title: "Product demo",
    duration: "45 min",
    desc: "Live walkthrough of the platform",
  },
  {
    slug: "discovery",
    title: "Discovery call",
    duration: "30 min",
    desc: "Understand your recon landscape",
  },
  {
    slug: "technical",
    title: "Technical consultation",
    duration: "60 min",
    desc: "Deep-dive with a solutions architect",
  },
  {
    slug: "executive",
    title: "Executive discussion",
    duration: "45 min",
    desc: "Strategic alignment for enterprise adoption",
  },
];

export function nextBusinessSlots(anchorDate: string): { date: string; slots: string[] }[] {
  const out: { date: string; slots: string[] }[] = [];
  const start = new Date(`${anchorDate}T12:00:00.000Z`);
  let added = 0;
  for (let i = 1; added < 5 && i < 14; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push({
      date: d.toISOString().slice(0, 10),
      slots: ["09:30", "11:00", "14:00", "15:30", "17:00"],
    });
    added++;
  }
  return out;
}

function BookDemo() {
  const { slotAnchorDate } = Route.useLoaderData();
  const [type, setType] = useState(TYPES[0].slug);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ when: string; type: string } | null>(null);
  const days = useMemo(() => nextBusinessSlots(slotAnchorDate), [slotAnchorDate]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!date || !slot) {
      toast.error("Pick a date and time");
      return;
    }
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
          purpose: `Book a demo: ${type} on ${date} at ${slot}`,
          job_title: fd.get("job_title") || null,
          country: fd.get("country") || null,
          areas_of_interest: [],
          message: `[BOOK DEMO — ${type}] ${date} ${slot}\n\n${fd.get("message") ?? ""}`,
          consent: true,
          source: "book_demo",
        }),
      });
      await parsePublicLeadResponse(res);
      setDone({ when: `${date} at ${slot}`, type });
      toast.success("Request received; we’ll confirm availability.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const goldBorder = (pct: number) => `color-mix(in oklab, ${GOLD} ${pct}%, transparent)`;
  const creamMix = (pct: number) => `color-mix(in oklab, ${CREAM} ${pct}%, transparent)`;

  return (
    <div className="min-h-screen" style={{ background: NOIR_BG, color: CREAM }}>
      <MarketingNav />

      {/* Hero — noir cinematic */}
      <section
        className="relative overflow-hidden border-b"
        style={{ borderColor: goldBorder(18) }}
      >
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

        <div className="relative mx-auto max-w-6xl px-4 py-16 md:py-20">
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition hover:opacity-80"
            style={{ borderColor: goldBorder(35), color: CREAM, background: goldBorder(6) }}
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
              border: `1px solid ${goldBorder(35)}`,
              background: goldBorder(8),
            }}
          >
            <Sparkles className="h-3 w-3" /> Book a session
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
            className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl"
          >
            Meet the team behind{" "}
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
            style={{ color: creamMix(78) }}
          >
            Pick the format that fits your evaluation stage. Our team will review your request and
            confirm availability.
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-10 grid gap-4 sm:grid-cols-3"
          >
            {[
              { icon: Shield, label: "SOC 2 · ISO 27001", sub: "Enterprise controls" },
              { icon: Clock, label: "Availability confirmation", sub: "From our team" },
              { icon: Building2, label: "Global banks & FIs", sub: "Deployed in production" },
            ].map(({ icon: Icon, label, sub }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border px-4 py-3"
                style={{ borderColor: goldBorder(18), background: creamMix(3) }}
              >
                <Icon className="h-5 w-5" style={{ color: GOLD }} />
                <div>
                  <div className="text-sm font-medium" style={{ color: CREAM }}>
                    {label}
                  </div>
                  <div
                    className="text-[11px] uppercase tracking-wider"
                    style={{ color: creamMix(60) }}
                  >
                    {sub}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Body */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        {done ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border p-8"
            style={{ borderColor: goldBorder(30), background: creamMix(4) }}
          >
            <CheckCircle2 className="h-8 w-8" style={{ color: GOLD }} />
            <h2 className="mt-4 font-display text-2xl font-semibold">Booking request received</h2>
            <p className="mt-2 text-sm" style={{ color: creamMix(78) }}>
              We received your request for {TYPES.find((t) => t.slug === done.type)?.title} on{" "}
              <b style={{ color: GOLD }}>{done.when}</b>. We’ll confirm availability by email.
            </p>
            <div className="mt-6 flex gap-3">
              <p className="text-xs" style={{ color: creamMix(70) }}>
                By confirming, you consent to ReconIQ contacting you about this booking. Read our{" "}
                <Link to="/privacy" className="underline underline-offset-2">Privacy Notice</Link>.
              </p>
              <Button
                asChild
                style={{ background: GOLD, color: NOIR_BG }}
                className="hover:opacity-90"
              >
                <Link to="/">Return home</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                style={{ borderColor: goldBorder(40), color: CREAM, background: "transparent" }}
              >
                <Link to="/contact">Contact sales</Link>
              </Button>
            </div>
          </motion.div>
        ) : (
          <div className="grid gap-8 md:grid-cols-[1fr_1.4fr]">
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6 }}
              className="space-y-3"
            >
              {TYPES.map((t, i) => {
                const active = type === t.slug;
                return (
                  <motion.button
                    key={t.slug}
                    onClick={() => setType(t.slug)}
                    whileHover={{ y: -2 }}
                    transition={{ delay: i * 0.05 }}
                    className="w-full rounded-xl border p-4 text-left transition"
                    style={{
                      borderColor: active ? goldBorder(60) : goldBorder(20),
                      background: active ? goldBorder(10) : creamMix(3),
                      boxShadow: active ? `0 0 24px ${goldBorder(20)}` : "none",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium" style={{ color: CREAM }}>
                        {t.title}
                      </span>
                      <span
                        className="flex items-center gap-1 text-xs"
                        style={{ color: creamMix(65) }}
                      >
                        <Clock className="h-3 w-3" /> {t.duration}
                      </span>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: creamMix(65) }}>
                      {t.desc}
                    </p>
                  </motion.button>
                );
              })}
            </motion.div>

            <motion.form
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              onSubmit={submit}
              className="space-y-7 rounded-xl border p-6 md:p-8"
              style={{
                borderColor: goldBorder(22),
                background: creamMix(4),
                backdropFilter: "blur(6px)",
              }}
            >
              <div>
                <Label
                  className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em]"
                  style={{ color: GOLD }}
                >
                  <CalendarIcon className="mr-1 inline h-3.5 w-3.5" /> Choose a date
                </Label>
                <div className="grid grid-cols-5 gap-2">
                  {days.map((d) => {
                    const active = date === d.date;
                    return (
                      <button
                        type="button"
                        key={d.date}
                        onClick={() => {
                          setDate(d.date);
                          setSlot(null);
                        }}
                        className="rounded-md border p-2 text-center text-xs transition"
                        style={{
                          borderColor: active ? goldBorder(60) : goldBorder(22),
                          background: active ? goldBorder(15) : "transparent",
                          color: CREAM,
                        }}
                      >
                        {new Date(`${d.date}T12:00:00.000Z`).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </button>
                    );
                  })}
                </div>
              </div>

              {date && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <Label
                    className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em]"
                    style={{ color: GOLD }}
                  >
                    Time (your local time)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {(days.find((d) => d.date === date)?.slots ?? []).map((s) => {
                      const active = slot === s;
                      return (
                        <button
                          type="button"
                          key={s}
                          onClick={() => setSlot(s)}
                          className="rounded-md border px-3 py-1.5 text-xs transition"
                          style={{
                            borderColor: active ? GOLD : goldBorder(25),
                            background: active ? GOLD : "transparent",
                            color: active ? NOIR_BG : CREAM,
                          }}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <NoirField name="first_name" label="First name" required />
                <NoirField name="last_name" label="Last name" required />
                <NoirField name="email" type="email" label="Business email" required />
                <NoirField name="mobile" label="Mobile" />
                <NoirField name="company" label="Company" required />
                <NoirField name="job_title" label="Job title" />
                <NoirField name="country" label="Country" />
              </div>

              <div>
                <Label
                  htmlFor="message"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.18em]"
                  style={{ color: GOLD }}
                >
                  Anything we should prepare?
                </Label>
                <Textarea
                  id="message"
                  name="message"
                  rows={3}
                  style={{
                    background: creamMix(4),
                    borderColor: goldBorder(25),
                    color: CREAM,
                  }}
                />
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={submitting || !date || !slot}
                style={{ background: GOLD, color: NOIR_BG }}
                className="hover:opacity-90 disabled:opacity-40"
              >
                {submitting ? "Booking…" : "Confirm booking"}
              </Button>
            </motion.form>
          </div>
        )}
      </section>
    </div>
  );
}

function NoirField({
  name,
  label,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  const GOLD_LOCAL = "var(--brand-gold)";
  const CREAM_LOCAL = "var(--brand-cream)";
  return (
    <div>
      <Label
        htmlFor={name}
        className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.18em]"
        style={{ color: GOLD_LOCAL }}
      >
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        required={required}
        style={{
          background: `color-mix(in oklab, ${CREAM_LOCAL} 4%, transparent)`,
          borderColor: `color-mix(in oklab, ${GOLD_LOCAL} 25%, transparent)`,
          color: CREAM_LOCAL,
        }}
      />
    </div>
  );
}
