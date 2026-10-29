import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Calendar as CalendarIcon, Clock, CheckCircle2 } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parsePublicLeadResponse, publicLeadEndpoint } from "@/lib/public-lead-client";
import { appUrl } from "@/lib/cross-domain";
import { notifyUserError } from "@/lib/user-feedback";

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
      { property: "og:url", content: "https://reconintelligence.app/book-demo" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/book-demo" }],
  }),
});

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

const inputClass =
  "h-11 rounded-xl border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3.5 text-[var(--mkt-text)] placeholder:text-[var(--mkt-text-3)] focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]";

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
      notifyUserError(err, "book_demo_form");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--mkt-bg)] text-[var(--mkt-text)] transition-colors duration-300">
      <MarketingNav />

      <main>
        <section className="border-b border-[var(--mkt-line)]">
          <div className="mx-auto max-w-6xl px-6 pb-14 pt-16 md:pt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">Book a demo</p>
            <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
              See ReconIQ with your team.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--mkt-text-2)] md:text-lg">
              Pick the format that fits your evaluation stage. We’ll review your request and confirm
              availability by email — or open the live product now and explore it yourself.
            </p>
            <div className="mt-8">
              <Button asChild variant="outline" className="border-[var(--mkt-line-strong)] bg-transparent text-[var(--mkt-text)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]">
                <a href={appUrl("/auth")}>Open the live product</a>
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          {done ? (
            <div className="max-w-2xl rounded-3xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-8">
              <CheckCircle2 className="h-8 w-8 text-[var(--mkt-accent)]" />
              <h2 className="mt-4 font-display text-2xl font-semibold">Booking request received</h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--mkt-text-2)]">
                We received your request for {TYPES.find((t) => t.slug === done.type)?.title} on{" "}
                <span className="font-medium text-[var(--mkt-text)]">{done.when}</span>. We’ll confirm availability by email.
              </p>
              <p className="mt-4 text-xs leading-relaxed text-[var(--mkt-text-3)]">
                By confirming, you consent to ReconIQ contacting you about this booking. Read our{" "}
                <Link to="/privacy" className="text-[var(--mkt-accent)] underline underline-offset-2 hover:text-[var(--mkt-text)]">Privacy Notice</Link>.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild className="bg-[var(--mkt-btn-bg)] text-[var(--mkt-btn-text)] hover:opacity-85">
                  <Link to="/">Return home</Link>
                </Button>
                <Button asChild variant="outline" className="border-[var(--mkt-line-strong)] bg-transparent text-[var(--mkt-text)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]">
                  <Link to="/contact">Contact sales</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-8 md:grid-cols-[1fr_1.4fr]">
              <div className="space-y-3">
                <p className="text-sm font-medium text-[var(--mkt-text)]">1. Choose a session type</p>
                {TYPES.map((t) => {
                  const active = type === t.slug;
                  return (
                    <button
                      type="button"
                      key={t.slug}
                      onClick={() => setType(t.slug)}
                      aria-pressed={active}
                      className={
                        active
                          ? "w-full rounded-2xl border border-[var(--mkt-btn-bg)] bg-[var(--mkt-btn-bg)] p-4 text-left text-[var(--mkt-btn-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                          : "w-full rounded-2xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-4 text-left transition-colors hover:border-[var(--mkt-line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                      }
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className={active ? "font-medium text-[var(--mkt-btn-text)]" : "font-medium text-[var(--mkt-text)]"}>{t.title}</span>
                        <span className={active ? "flex items-center gap-1 text-xs text-[var(--mkt-btn-text)]/60" : "flex items-center gap-1 text-xs text-[var(--mkt-text-3)]"}>
                          <Clock className="h-3 w-3" /> {t.duration}
                        </span>
                      </span>
                      <span className={active ? "mt-1 block text-xs text-[var(--mkt-btn-text)]/60" : "mt-1 block text-xs text-[var(--mkt-text-3)]"}>{t.desc}</span>
                    </button>
                  );
                })}
                <p className="pt-2 text-xs leading-relaxed text-[var(--mkt-text-3)]">
                  Security controls are designed with reference to SOC 2 and ISO 27001 frameworks.
                  ReconIQ does not claim SOC 2 or ISO certification — see the Security page for status.
                </p>
              </div>

              <form onSubmit={submit} className="h-fit space-y-7 rounded-3xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-6 md:p-8">
                <div>
                  <Label className="mb-2 block text-sm font-medium text-[var(--mkt-text)]">
                    <CalendarIcon className="mr-1.5 inline h-4 w-4 text-[var(--mkt-text-2)]" /> 2. Choose a date
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
                          aria-pressed={active}
                          className={
                            active
                              ? "rounded-xl border border-[var(--mkt-btn-bg)] bg-[var(--mkt-btn-bg)] p-2 text-center text-xs font-medium text-[var(--mkt-btn-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                              : "rounded-xl border border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] p-2 text-center text-xs text-[var(--mkt-text)] transition-colors hover:border-[var(--mkt-line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                          }
                        >
                          {new Date(`${d.date}T12:00:00.000Z`).toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                            timeZone: "UTC",
                          })}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {date ? (
                  <div>
                    <Label className="mb-2 block text-sm font-medium text-[var(--mkt-text)]">3. Choose a time <span className="font-normal text-[var(--mkt-text-3)]">(your local time)</span></Label>
                    <div className="flex flex-wrap gap-2">
                      {(days.find((d) => d.date === date)?.slots ?? []).map((s) => {
                        const active = slot === s;
                        return (
                          <button
                            type="button"
                            key={s}
                            onClick={() => setSlot(s)}
                            aria-pressed={active}
                            className={
                              active
                                ? "rounded-full border border-[var(--mkt-btn-bg)] bg-[var(--mkt-btn-bg)] px-3.5 py-1.5 text-xs font-medium text-[var(--mkt-btn-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                                : "rounded-full border border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3.5 py-1.5 text-xs text-[var(--mkt-text)] transition-colors hover:border-[var(--mkt-line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                            }
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--mkt-text-3)]">Choose a date first — times will appear here.</p>
                )}

                <div>
                  <p className="mb-4 text-sm font-medium text-[var(--mkt-text)]">{date ? "4. Your details" : "3. Your details"}</p>
                  <div className="grid gap-5 md:grid-cols-2">
                    <OnyxField name="first_name" label="First name" required autoComplete="given-name" />
                    <OnyxField name="last_name" label="Last name" required autoComplete="family-name" />
                    <OnyxField name="email" type="email" label="Business email" required autoComplete="email" helper="We’ll confirm your booking at this address." />
                    <OnyxField name="mobile" label="Mobile" autoComplete="tel" />
                    <OnyxField name="company" label="Company" required autoComplete="organization" />
                    <OnyxField name="job_title" label="Job title" autoComplete="organization-title" />
                    <OnyxField name="country" label="Country" autoComplete="country-name" />
                  </div>
                </div>

                <div>
                  <Label htmlFor="message" className="mb-1.5 block text-sm font-medium text-[var(--mkt-text)]">
                    Anything we should prepare?
                  </Label>
                  <Textarea
                    id="message"
                    name="message"
                    rows={3}
                    placeholder="For example, the reconciliation types or systems you want to cover."
                    className="rounded-xl border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3.5 py-3 text-[var(--mkt-text)] placeholder:text-[var(--mkt-text-3)] focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
                  />
                </div>

                <div>
                  <Button type="submit" size="lg" disabled={submitting || !date || !slot} className="bg-[var(--mkt-btn-bg)] text-[var(--mkt-btn-text)] hover:opacity-85 disabled:opacity-40">
                    {submitting ? "Booking…" : "Confirm booking"}
                  </Button>
                  {!date || !slot ? (
                    <p className="mt-3 text-xs text-[var(--mkt-text-3)]">Choose a date and time above to continue.</p>
                  ) : null}
                </div>
              </form>
            </div>
          )}
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

function OnyxField({
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
      <Label htmlFor={name} className="mb-1.5 block text-sm font-medium text-[var(--mkt-text)]">
        {label}
        {required ? " *" : ""}
      </Label>
      <Input id={name} name={name} type={type} required={required} autoComplete={autoComplete} className={inputClass} aria-describedby={helper ? `${name}-helper` : undefined} />
      {helper ? <p id={`${name}-helper`} className="mt-1.5 text-xs text-[var(--mkt-text-3)]">{helper}</p> : null}
    </div>
  );
}
