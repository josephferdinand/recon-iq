import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Download, FileText, Loader2, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { trackCtaEvent } from "@/lib/cta-tracking";
import { parsePublicLeadResponse, publicLeadEndpoint } from "@/lib/public-lead-client";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/due-diligence")({
  head: () => ({
    meta: [
      { title: "Request the Due-Diligence Pack — ReconIQ" },
      {
        name: "description",
        content:
          "Request the ReconIQ Due-Diligence Pack — SIG Lite, CAIQ, security overview, DPA template, subprocessor list, and audit-log evidence. Gated download for enterprise buyers.",
      },
      { name: "robots", content: "noindex,follow" },
      { property: "og:title", content: "Request the Due-Diligence Pack — ReconIQ" },
      {
        property: "og:description",
        content:
          "Gated download of the ReconIQ enterprise Due-Diligence Pack for InfoSec, Risk, Legal and Procurement.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/due-diligence" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/due-diligence" }],
  }),
  component: DueDiligencePage,
});

const ROLES = [
  "InfoSec / CISO office",
  "Operational Risk",
  "Compliance",
  "Data Privacy / DPO",
  "Procurement / Vendor Management",
  "Legal",
  "Enterprise Architecture",
  "Line of Business Sponsor",
  "Other",
] as const;

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const schema = z.object({
  first_name: z.string().trim().min(1, "Required").max(80),
  last_name: z.string().trim().min(1, "Required").max(80),
  work_email: z.string().trim().max(200).regex(emailRe, "Enter a valid work email"),
  company: z.string().trim().min(1, "Required").max(200),
  job_title: z.string().trim().max(120).optional(),
  role: z.enum(ROLES),
  country: z.string().trim().max(80).optional(),
  purpose: z.string().trim().max(2000).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "Consent is required" }) }),
});

type FormState = {
  first_name: string;
  last_name: string;
  work_email: string;
  company: string;
  job_title: string;
  role: (typeof ROLES)[number];
  country: string;
  purpose: string;
  consent: boolean;
};

const initial: FormState = {
  first_name: "",
  last_name: "",
  work_email: "",
  company: "",
  job_title: "",
  role: "InfoSec / CISO office",
  country: "",
  purpose: "",
  consent: false,
};

function DueDiligencePage() {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [leadRef, setLeadRef] = useState<string | null>(null);

  useEffect(() => {
    trackCtaEvent("view", { cta_id: "due_diligence_page", source: "due_diligence_page" });
  }, []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setErrorMsg(null);

    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const flat: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (!flat[path]) flat[path] = issue.message;
      }
      setErrors(flat);
      trackCtaEvent("form_submit", {
        cta_id: "due_diligence_form",
        source: "due_diligence_page",
        meta: { outcome: "validation_failed", role: form.role },
      });
      return;
    }

    setStatus("submitting");
    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.work_email.trim().toLowerCase(),
        company: form.company.trim(),
        job_title: form.job_title.trim() || form.role,
        country: form.country.trim() || null,
        areas_of_interest: ["Due Diligence Pack", form.role],
        purpose: `Due diligence pack: ${(form.purpose.trim() || "document request").slice(0, 215)}`,
        message: `[Due-Diligence Pack request]\nRole: ${form.role}`,
        consent: true as const,
        source: "other" as const,
      };
      const res = await fetch(publicLeadEndpoint(window.location.origin, import.meta.env.VITE_FVI_APP_API_ORIGIN), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parsePublicLeadResponse(res);
      setLeadRef(data.lead_id);
      trackCtaEvent("form_submit", {
        cta_id: "due_diligence_form",
        source: "due_diligence_page",
        lead_id: data.lead_id ?? undefined,
        meta: { outcome: "success", role: form.role, country: form.country || null },
      });

      // Generate PDF client-side (gated by successful lead capture)
      const { generateDueDiligencePdf } = await import("@/lib/due-diligence-pdf");
      await generateDueDiligencePdf({
        recipient: `${payload.first_name} ${payload.last_name}`,
        company: payload.company,
        email: payload.email,
        role: form.role,
        reference: data.lead_id ?? "—",
      });
      trackCtaEvent("pack_download", {
        cta_id: "due_diligence_pack",
        source: "due_diligence_page",
        lead_id: data.lead_id ?? undefined,
        meta: { role: form.role, company: payload.company },
      });
      setStatus("done");
    } catch {
      setStatus("error");
      setErrorMsg(
        "Something Didn't Go As Planned — we couldn't submit your request just now. Please try again in a few moments, or contact us via the contact form at /contact.",
      );
      trackCtaEvent("form_submit", {
        cta_id: "due_diligence_form",
        source: "due_diligence_page",
        meta: { outcome: "error", role: form.role },
      });
    }
  }

  return (
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />
      <main className="mx-auto max-w-4xl px-6 py-16 md:py-24">
        <header>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a1a1a6]">
            <ShieldCheck className="h-3.5 w-3.5" /> Gated — enterprise buyers only
          </div>
          <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Request the ReconIQ Due-Diligence Pack
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#a1a1a6]">
            A single PDF containing the security overview, SIG Lite &amp; CAIQ responses, DPA
            template, subprocessor list, audit-log evidence schema, incident response summary,
            and the shared responsibility matrix. The pack downloads to your device once you
            submit; items that require an NDA are arranged separately.
          </p>
        </header>

        <div className="mt-12 grid gap-8 md:grid-cols-[1.4fr_1fr]">
          <form
            onSubmit={onSubmit}
            noValidate
            className="rounded-2xl border border-white/10 bg-[#161617] p-6 md:p-8"
          >
            {status === "done" ? (
              <SuccessPanel reference={leadRef} email={form.work_email} />
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="First name" error={errors.first_name}>
                    <input
                      value={form.first_name}
                      onChange={(e) => set("first_name", e.target.value)}
                      className={inputCls}
                      autoComplete="given-name"
                      required
                    />
                  </Field>
                  <Field label="Last name" error={errors.last_name}>
                    <input
                      value={form.last_name}
                      onChange={(e) => set("last_name", e.target.value)}
                      className={inputCls}
                      autoComplete="family-name"
                      required
                    />
                  </Field>
                  <Field label="Work email" error={errors.work_email}>
                    <input
                      type="email"
                      value={form.work_email}
                      onChange={(e) => set("work_email", e.target.value)}
                      className={inputCls}
                      autoComplete="email"
                      required
                    />
                  </Field>
                  <Field label="Company / Institution" error={errors.company}>
                    <input
                      value={form.company}
                      onChange={(e) => set("company", e.target.value)}
                      className={inputCls}
                      autoComplete="organization"
                      required
                    />
                  </Field>
                  <Field label="Job title" error={errors.job_title}>
                    <input
                      value={form.job_title}
                      onChange={(e) => set("job_title", e.target.value)}
                      className={inputCls}
                      autoComplete="organization-title"
                    />
                  </Field>
                  <Field label="Country" error={errors.country}>
                    <input
                      value={form.country}
                      onChange={(e) => set("country", e.target.value)}
                      className={inputCls}
                      autoComplete="country-name"
                    />
                  </Field>
                  <Field label="Your role in the evaluation" error={errors.role} full>
                    <select
                      value={form.role}
                      onChange={(e) => set("role", e.target.value as FormState["role"])}
                      className={inputCls}
                      required
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r} style={{ background: "#161617" }}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Purpose / scope of review (optional)" error={errors.purpose} full>
                    <textarea
                      value={form.purpose}
                      onChange={(e) => set("purpose", e.target.value)}
                      className={`${inputCls} min-h-[96px]`}
                      maxLength={2000}
                      placeholder="e.g. Vendor onboarding review for cash reconciliation, target go-live Q3."
                    />
                  </Field>
                </div>

                <label className="mt-5 flex items-start gap-3 text-[13px] leading-snug text-[#a1a1a6]">
                  <input
                    type="checkbox"
                    checked={form.consent}
                    onChange={(e) => set("consent", e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#2997ff]"
                    required
                  />
                  <span>
                    I agree that ReconIQ may contact me about my request and
                    process my details per its{" "}
                    <Link to="/privacy" className="text-[#2997ff] underline underline-offset-2">
                      privacy notice
                    </Link>
                    . The pack is shared under mutual NDA on request.
                  </span>
                </label>
                {errors.consent && (
                  <p className="mt-1 text-[12px] text-red-400">{errors.consent}</p>
                )}

                {errorMsg && (
                  <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-[#ffb4b4]">
                    {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[13px] font-semibold text-black transition hover:bg-white/85 disabled:opacity-60"
                >
                  {status === "submitting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Preparing your pack…
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" /> Submit &amp; download the pack (PDF)
                    </>
                  )}
                </button>
              </>
            )}
          </form>

          <aside className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-[#161617] p-5">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#86868b]">
                <FileText className="h-3.5 w-3.5" /> What's inside
              </div>
              <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-[#a1a1a6]">
                {PACK_CONTENTS.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#2997ff]"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#161617] p-5 text-[12px] leading-relaxed text-[#a1a1a6]">
              <div className="font-semibold text-[#f5f5f7]">
                Note on scope
              </div>
              <p className="mt-2">
                Artifacts describe controls that are built and testable in-product today. Formal
                third-party attestations (SOC 2 Type II, ISO 27001) are on the roadmap and will
                be published as they complete. ReconIQ does not claim certifications it has not yet
                earned.
              </p>
            </div>
          </aside>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}

const PACK_CONTENTS = [
  "Security & Architecture Overview (tenant isolation, identity, encryption, KMS/BYOK, audit)",
  "SIG Lite and CAIQ responses",
  "Sample Audit Log & Evidence Bundle (event schema + hash-chain verification)",
  "Data Retention & Deletion schedule (7-year default, per-tenant overrides)",
  "DPA template with SCCs, subprocessor list, and residency commitments",
  "Incident Response & Breach Notification summary",
  "Shared Responsibility Matrix (ReconIQ · Customer · Cloud provider)",
];

const inputCls =
  "w-full rounded-lg bg-[#1c1c1f] px-3 py-2.5 text-[13px] text-[#f5f5f7] outline-none transition placeholder:text-[#86868b] focus:ring-2 focus:ring-[#2997ff]/50";

function Field({
  label,
  error,
  full,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`block text-[#f5f5f7] ${full ? "md:col-span-2" : ""}`}
    >
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
        {label}
      </span>
      <div
        className="rounded-lg"
        style={{
          border: `1px solid ${
            error
              ? "rgba(255,107,107,0.6)"
              : "rgba(255,255,255,0.10)"
          }`,
        }}
      >
        {children}
      </div>
      {error && <p className="mt-1 text-[12px] text-red-400">{error}</p>}
    </label>
  );
}

function SuccessPanel({ reference, email }: { reference: string | null; email: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-[#2997ff]">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-[#f5f5f7]">
        Your download has started
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-[#a1a1a6]">
        A copy of the Due-Diligence Pack is downloading to your device. We've also logged your
        request under reference{" "}
        <span className="font-mono text-[#2997ff]">
          {reference ? reference.slice(0, 8).toUpperCase() : "—"}
        </span>
        . Our team will follow up at{" "}
        <span className="font-mono text-[#f5f5f7]">{email}</span> with any items
        that require NDA.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          to="/security"
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[12px] font-semibold text-black transition hover:bg-white/85"
        >
          View security posture
        </Link>
        <Link
          to="/book-demo"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-[12px] font-semibold text-[#f5f5f7] transition hover:bg-white/10"
        >
          Book a briefing
        </Link>
      </div>
    </div>
  );
}
