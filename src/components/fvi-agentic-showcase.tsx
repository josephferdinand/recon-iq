import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import {
  Sparkles,
  Settings,
  FileText,
  Network,
  CheckCircle2,
  ArrowUpRight,
  ShieldCheck,
  Star,
  Infinity as InfinityIcon,
} from "lucide-react";
import { toast } from "sonner";
import { parsePublicLeadResponse, publicLeadEndpoint } from "@/lib/public-lead-client";

/* ------------------------------------------------------------------ */
/*  Shared bits                                                        */
/* ------------------------------------------------------------------ */

const Kicker = ({ children }: { children: React.ReactNode }) => (
  <div
    className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.32em]"
    style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
  >
    <span
      className="inline-block h-px w-8"
      style={{ background: "color-mix(in oklab, var(--brand-gold) 60%, transparent)" }}
    />
    {children}
  </div>
);

const cardShell: React.CSSProperties = {
  background:
    "linear-gradient(180deg, color-mix(in oklab, var(--ink-void) 82%, transparent), color-mix(in oklab, var(--ink-void) 94%, transparent))",
  border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
  boxShadow:
    "0 40px 100px -50px rgba(0,0,0,0.75), inset 0 1px 0 color-mix(in oklab, var(--brand-gold) 12%, transparent)",
};

/* ------------------------------------------------------------------ */
/*  1)  AGENTIC SHOWCASE — image 2                                     */
/* ------------------------------------------------------------------ */

const AGENTS = [
  {
    icon: Sparkles,
    name: "Design Agent",
    d: "Author reconciliations from a sentence.",
    state: "ACTIVE",
  },
  {
    icon: Settings,
    name: "Resolution Agent",
    d: "Cluster and triage breaks with confidence scoring.",
    state: "ACTIVE",
  },
  {
    icon: FileText,
    name: "AIDP — PDF extraction",
    d: "Parse statements, finds, confirms into structured rows.",
    state: "ACTIVE",
  },
  {
    icon: Network,
    name: "Break Knowledge Graph",
    d: "Learns from every resolution — across tenants, never across silos.",
    state: "LEARNING",
  },
] as const;

export type AgenticShowcaseCopy = {
  kicker?: string;
  heading?: string;
  subhead?: string;
};

export function AgenticShowcase({ copy }: { copy?: AgenticShowcaseCopy } = {}) {
  const [active, setActive] = useState(1);

  return (
    <section
      id="agentic"
      className="relative py-32"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
        borderBottom: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
        background:
          "radial-gradient(900px 500px at 78% 18%, color-mix(in oklab, var(--brand-gold) 7%, transparent), transparent 60%)",
      }}
    >
      <div className="mx-auto grid max-w-7xl items-start gap-14 px-6 lg:grid-cols-[1fr_1.15fr]">
        {/* Left — narrative + agent list */}
        <div>
          <Kicker>{copy?.kicker ?? "Agentic AI · Built for finance"}</Kicker>
          {copy?.heading ? (
            <h2
              className="mt-6 font-display text-4xl font-medium leading-[1.02] tracking-tight md:text-6xl"
              style={{ color: "var(--brand-cream)" }}
            >
              {copy.heading}
            </h2>
          ) : (
            <h2
              className="mt-6 font-display text-4xl font-medium leading-[1.02] tracking-tight md:text-6xl"
              style={{ color: "var(--brand-cream)" }}
            >
              Agents that{" "}
              <span
                className="italic"
                style={{
                  background: "linear-gradient(120deg, var(--brand-gold), #f3d78a, var(--brand-gold))",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                ingest, match, resolve
              </span>{" "}
              and audit —{" "}
              <span style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}>
                autonomously.
              </span>
            </h2>
          )}
          <p
            className="mt-6 max-w-lg text-[15px] leading-relaxed"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}
          >
            {copy?.subhead ??
              "Four purpose-built agents, one shared intelligence. Each runs under the policies you set, asks for human review when confidence requires it, and learns from every decision your team makes."}
          </p>



          <div className="mt-10 space-y-3">
            {AGENTS.map((a, i) => {
              const Icon = a.icon;
              const isActive = i === active;
              return (
                <motion.button
                  key={a.name}
                  type="button"
                  onClick={() => setActive(i)}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.45, delay: i * 0.06 }}
                  className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl p-5 text-left transition"
                  style={{
                    ...cardShell,
                    borderColor: isActive
                      ? "color-mix(in oklab, var(--brand-gold) 45%, transparent)"
                      : "color-mix(in oklab, var(--brand-gold) 16%, transparent)",
                    boxShadow: isActive
                      ? "0 30px 80px -40px color-mix(in oklab, var(--brand-gold) 40%, transparent), inset 0 1px 0 color-mix(in oklab, var(--brand-gold) 20%, transparent)"
                      : cardShell.boxShadow,
                  }}
                >
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                    style={{
                      background:
                        "linear-gradient(180deg, color-mix(in oklab, var(--brand-gold) 18%, transparent), color-mix(in oklab, var(--brand-gold) 4%, transparent))",
                      border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)",
                    }}
                  >
                    <Icon className="h-4.5 w-4.5" style={{ color: "var(--brand-gold)" }} />
                  </span>
                  <span className="min-w-0">
                    <span
                      className="block font-display text-[15px] font-semibold tracking-tight"
                      style={{ color: "var(--brand-cream)" }}
                    >
                      {a.name}
                    </span>
                    <span
                      className="mt-0.5 block text-[12.5px] leading-snug"
                      style={{ color: "color-mix(in oklab, var(--brand-cream) 60%, transparent)" }}
                    >
                      {a.d}
                    </span>
                  </span>
                  <span
                    className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em]"
                    style={{
                      color: a.state === "LEARNING" ? "#7CF0BE" : "#66E5B0",
                    }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{
                        background: a.state === "LEARNING" ? "#7CF0BE" : "#66E5B0",
                        boxShadow: `0 0 8px ${a.state === "LEARNING" ? "#7CF0BE" : "#66E5B0"}`,
                      }}
                    />
                    {a.state}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Right — Resolution Agent chat panel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8 }}
          className="relative"
        >
          <div
            aria-hidden
            className="absolute -inset-8 rounded-[2rem] blur-3xl"
            style={{
              background:
                "radial-gradient(closest-side, color-mix(in oklab, var(--brand-gold) 20%, transparent), transparent)",
            }}
          />
          <div className="relative overflow-hidden rounded-2xl p-6 backdrop-blur-xl" style={cardShell}>
            {/* header */}
            <div
              className="flex items-center gap-3 border-b pb-4"
              style={{ borderColor: "color-mix(in oklab, var(--brand-gold) 16%, transparent)" }}
            >
              <span
                className="grid h-10 w-10 place-items-center rounded-xl"
                style={{
                  background:
                    "linear-gradient(180deg, color-mix(in oklab, var(--brand-gold) 22%, transparent), color-mix(in oklab, var(--brand-gold) 4%, transparent))",
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 32%, transparent)",
                }}
              >
                <Settings className="h-4 w-4" style={{ color: "var(--brand-gold)" }} />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="font-display text-[15px] font-semibold tracking-tight"
                  style={{ color: "var(--brand-cream)" }}
                >
                  Resolution Agent
                </div>
                <div
                  className="mt-0.5 font-mono text-[10.5px] tracking-[0.2em]"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 50%, transparent)" }}
                >
                  session · a91f · block 48219
                </div>
              </div>
              <span
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.22em]"
                style={{
                  background: "color-mix(in oklab, #66E5B0 12%, transparent)",
                  border: "1px solid color-mix(in oklab, #66E5B0 40%, transparent)",
                  color: "#7CF0BE",
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "#66E5B0", boxShadow: "0 0 8px #66E5B0" }}
                />
                4-eyes pending
              </span>
            </div>

            {/* chat turns */}
            <div className="mt-5 space-y-3.5 text-[13px] leading-relaxed">
              {/* Controller */}
              <ChatBubble role="controller">
                We have 1,247 unmatched EUR pairs from the past 7 days. Most cluster on FX cut-off
                and ±€0.02 drift.
              </ChatBubble>

              {/* Resolution Agent */}
              <ChatBubble role="agent">
                I&rsquo;ve identified <strong style={{ color: "var(--brand-cream)" }}>3 recurring patterns</strong>. Proposing a
                composite rule that captures <strong style={{ color: "var(--brand-cream)" }}>96%</strong> of clusters. The
                remaining <strong style={{ color: "var(--brand-cream)" }}>4%</strong> require your review.
                <span className="ml-2 inline-flex gap-0.5 align-middle">
                  <Dot delay={0} />
                  <Dot delay={0.2} />
                  <Dot delay={0.4} />
                </span>
              </ChatBubble>

              {/* Controller */}
              <ChatBubble role="controller">Show me the proposed rule.</ChatBubble>

              {/* Rule card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="rounded-xl p-4 font-mono text-[12px]"
                style={{
                  background: "color-mix(in oklab, var(--ink-void) 78%, transparent)",
                  border: "1px dashed color-mix(in oklab, var(--brand-gold) 32%, transparent)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span style={{ color: "var(--brand-cream)" }}>
                    <strong>Composite rule</strong> · FX-cut-off tolerance
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span style={{ color: "#66E5B0" }}>confidence</span>
                  <span
                    className="relative h-1.5 flex-1 overflow-hidden rounded-full"
                    style={{ background: "color-mix(in oklab, var(--brand-cream) 8%, transparent)" }}
                  >
                    <motion.span
                      initial={{ width: 0 }}
                      whileInView={{ width: "97%" }}
                      viewport={{ once: true }}
                      transition={{ duration: 1.4, delay: 0.3 }}
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        background: "linear-gradient(90deg, #66E5B0, #7CF0BE)",
                        boxShadow: "0 0 10px #66E5B0",
                      }}
                    />
                  </span>
                  <span style={{ color: "#7CF0BE" }}>0.97</span>
                </div>
                <div
                  className="mt-4 space-y-1.5"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 74%, transparent)" }}
                >
                  <Row k="rule" v="tol(±0.02, T+1) AND ref_like(^EUR-FX-)" />
                  <Row k="scope" v="cash.nostro · intercompany · FX" />
                  <Row k="projected coverage" v="1,198 / 1,247" />
                  <Row k="human review required" v="49 unmatched outliers" />
                </div>
              </motion.div>

              {/* action row */}
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => toast.success("Rule approved · sealed to audit #a91f")}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition hover:brightness-110"
                  style={{
                    background: "linear-gradient(180deg, #66E5B0, #3fbf85)",
                    color: "var(--ink-void)",
                    boxShadow: "0 8px 22px -8px color-mix(in oklab, #66E5B0 55%, transparent)",
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approve &amp; apply · 4-eyes
                </button>
                <button
                  type="button"
                  onClick={() => toast("Sent back for revision")}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition"
                  style={{
                    border: "1px solid color-mix(in oklab, var(--brand-cream) 20%, transparent)",
                    color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)",
                  }}
                >
                  Reject
                </button>
                <span
                  className="ml-auto font-mono text-[10.5px] tracking-[0.2em]"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 48%, transparent)" }}
                >
                  audit #a91f
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function ChatBubble({ role, children }: { role: "controller" | "agent"; children: React.ReactNode }) {
  const isAgent = role === "agent";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className={`max-w-[92%] rounded-xl px-3.5 py-2.5 ${isAgent ? "ml-0" : "ml-auto"}`}
      style={{
        background: isAgent
          ? "color-mix(in oklab, #8B7CFF 10%, transparent)"
          : "color-mix(in oklab, var(--brand-cream) 5%, transparent)",
        border: `1px solid color-mix(in oklab, ${isAgent ? "#8B7CFF" : "var(--brand-cream)"} 22%, transparent)`,
      }}
    >
      <div
        className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.24em]"
        style={{ color: isAgent ? "#c8b8ff" : "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
      >
        {isAgent ? "Resolution Agent" : "Controller"}
      </div>
      <div style={{ color: "color-mix(in oklab, var(--brand-cream) 88%, transparent)" }}>{children}</div>
    </motion.div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <motion.span
      className="inline-block h-1 w-1 rounded-full"
      style={{ background: "#8B7CFF" }}
      animate={{ opacity: [0.2, 1, 0.2] }}
      transition={{ duration: 1.2, repeat: Infinity, delay }}
    />
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3">
      <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>{k}:</span>
      <span>{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  2)  TALK TO RECONIQ COPILOT — image 1                                   */
/* ------------------------------------------------------------------ */

const PROMPTS = [
  "Show me reconciliation coverage for our nostro accounts.",
  "Walk me through your agentic AI and four-eyes controls.",
  "What does a deployment look like in our environment?",
];

export type TalkToFalconCopy = {
  heading?: string;
  subhead?: string;
  prompts?: string[];
};

export function TalkToFalconSection({ copy }: { copy?: TalkToFalconCopy } = {}) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState("--:--:--");

  // subtle live clock
  useEffect(() => {
    const updateClock = () =>
      setNow(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    updateClock();
    const t = setInterval(
      updateClock,
      1000,
    );
    return () => clearInterval(t);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const full = String(fd.get("full_name") ?? "").trim();
    const [first_name, ...rest] = full.split(/\s+/);
    const last_name = rest.join(" ") || "—";
    setSubmitting(true);
    try {
      const res = await fetch(publicLeadEndpoint(window.location.origin, import.meta.env.VITE_FVI_APP_API_ORIGIN), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: first_name || full || "Guest",
          last_name,
          email: fd.get("email"),
          company: fd.get("company"),
          purpose: "Talk to ReconIQ Copilot about reconciliation requirements.",
          job_title: fd.get("role") || null,
          areas_of_interest: [],
          message: `[TALK TO RECONIQ COPILOT]\n${fd.get("problem") ?? ""}`,
          consent: !!fd.get("consent"),
          source: "other",
        }),
      });
      await parsePublicLeadResponse(res);
      setDone(true);
      toast.success("ReconIQ Copilot will reply within 90 seconds.");
      (e.currentTarget as HTMLFormElement).reset();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function pickPrompt(p: string) {
    window.dispatchEvent(new CustomEvent("dr-falcon:open"));
    // best-effort: also drop the prompt into the widget input via clipboard-free hint
    window.dispatchEvent(new CustomEvent("dr-falcon:prompt", { detail: p }));
  }

  return (
    <section
      id="talk-to-falcon"
      className="relative py-32"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
        background:
          "radial-gradient(900px 500px at 18% 20%, color-mix(in oklab, var(--brand-gold) 6%, transparent), transparent 60%)",
      }}
    >
      <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-2">
        {/* Left — ReconIQ Copilot greeting */}
        <div className="relative overflow-hidden rounded-3xl p-8 md:p-10" style={cardShell}>
          <div className="flex items-start gap-4">
            <span
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, #F2DDB4, #D4B581 55%, #8C7651)",
                boxShadow:
                  "0 10px 30px -12px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
              }}
            >
              <Star className="h-5 w-5" style={{ color: "var(--ink-void)" }} strokeWidth={2.4} />
            </span>
            <div className="min-w-0">
              <div className="font-display text-lg font-semibold tracking-tight" style={{ color: "var(--brand-cream)" }}>
                ReconIQ <span className="italic" style={{ color: "var(--brand-gold)" }}>Copilot</span>
              </div>
              <div
                className="mt-1 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.24em]"
                style={{ color: "#7CF0BE" }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "#66E5B0", boxShadow: "0 0 8px #66E5B0" }}
                />
                AI Advisor · Online
              </div>
            </div>
          </div>

          <h3
            className="mt-8 font-display text-3xl font-medium leading-[1.05] tracking-tight md:text-5xl"
            style={{ color: "var(--brand-cream)" }}
          >
            {copy?.heading ?? "Talk to ReconIQ."}
            <br />
            <span
              className="italic"
              style={{
                background: "linear-gradient(120deg, var(--brand-gold), #f3d78a, var(--brand-gold))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {copy?.subhead ?? "In your language. On your terms."}
            </span>
          </h3>

          <div className="mt-8 space-y-2.5">
            {(copy?.prompts && copy.prompts.length > 0 ? copy.prompts : PROMPTS).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => pickPrompt(p)}
                className="group flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left text-[13.5px] transition hover:brightness-125"
                style={{
                  background: "color-mix(in oklab, var(--brand-cream) 4%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
                  color: "color-mix(in oklab, var(--brand-cream) 84%, transparent)",
                }}
              >
                <span className="min-w-0 truncate">{p}</span>
                <ArrowUpRight
                  className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  style={{ color: "var(--brand-gold)" }}
                />
              </button>
            ))}
          </div>

          <div
            className="mt-10 grid grid-cols-3 gap-6 border-t pt-6"
            style={{ borderColor: "color-mix(in oklab, var(--brand-gold) 14%, transparent)" }}
          >
            <Stat value="< 90s" label="First-response target¹" />
            <Stat value="24 / 7" label="Designed availability¹" />
            <Stat icon={<InfinityIcon className="h-5 w-5" style={{ color: "var(--brand-gold)" }} />} label="Concurrent sessions" />
          </div>
          <p
            className="mt-4 text-[10.5px] leading-relaxed"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 45%, transparent)" }}
          >
            ¹ Engineered design targets — not observed production metrics. Audited SLOs
            will be published as launch partners go live.
          </p>
        </div>

        {/* Right — Lead capture */}
        <form
          onSubmit={submit}
          className="relative overflow-hidden rounded-3xl p-8 md:p-10"
          style={cardShell}
        >
          <Kicker>Lead capture</Kicker>
          <h3
            className="mt-4 font-display text-3xl font-medium tracking-tight md:text-4xl"
            style={{ color: "var(--brand-cream)" }}
          >
            Tell us where you are.
          </h3>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <Field name="full_name" label="Full name" required />
            <Field name="company" label="Company" required />
            <Field name="email" type="email" label="Work email" required className="md:col-span-2" />
            <Field name="role" label="Your role" className="md:col-span-2" />
            <Field
              as="textarea"
              name="problem"
              label="What are you trying to solve?"
              className="md:col-span-2"
            />
          </div>

          <label
            className="mt-6 flex items-start gap-2.5 text-[12.5px]"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}
          >
            <input
              type="checkbox"
              name="consent"
              defaultChecked
              className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--brand-gold)]"
            />
            <span>I&rsquo;d like ReconIQ Copilot to email me a tailored response within 90 seconds.</span>
          </label>

          <button
            type="submit"
            disabled={submitting || done}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold transition hover:brightness-110 disabled:opacity-70"
            style={{
              background: "linear-gradient(180deg, #F2DDB4, #D4B581 55%, #8C7651)",
              color: "var(--ink-void)",
              boxShadow: "0 12px 30px -10px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
            }}
          >
            {done ? (
              <>
                <CheckCircle2 className="h-4 w-4" /> Sent — ReconIQ Copilot is drafting your reply
              </>
            ) : submitting ? (
              "Sending…"
            ) : (
              <>Talk to ReconIQ Copilot &rarr;</>
            )}
          </button>

          <div
            className="mt-5 flex items-center justify-center gap-3 font-mono text-[10.5px] tracking-[0.22em]"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 50%, transparent)" }}
          >
            <ShieldCheck className="h-3 w-3" style={{ color: "var(--brand-gold)" }} />
            <span>ENCRYPTED</span>
            <Dotsep />
            <span>SHA-256</span>
            <Dotsep />
            <span>{now}</span>
          </div>
        </form>
      </div>

      {/* If they'd rather book */}
      <div className="mx-auto mt-10 max-w-7xl px-6 text-center">
        <span
          className="text-[13px]"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
        >
          Prefer a scheduled walkthrough?{" "}
          <Link
            to="/book-demo"
            className="underline decoration-dotted underline-offset-4 hover:brightness-125"
            style={{ color: "var(--brand-gold)" }}
          >
            Book a demo instead
          </Link>
        </span>
      </div>
    </section>
  );
}

function Stat({
  value,
  label,
  icon,
}: {
  value?: string;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="font-display text-2xl font-semibold tracking-tight"
        style={{ color: "var(--brand-gold)" }}
      >
        {value ?? icon}
      </div>
      <div
        className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.24em]"
        style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
      >
        {label}
      </div>
    </div>
  );
}

function Dotsep() {
  return (
    <span
      className="inline-block h-1 w-1 rounded-full"
      style={{ background: "color-mix(in oklab, var(--brand-cream) 40%, transparent)" }}
    />
  );
}

type FieldProps = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  className?: string;
  as?: "input" | "textarea";
};
function Field({ name, label, type = "text", required, className = "", as = "input" }: FieldProps) {
  const common = {
    id: name,
    name,
    required,
    placeholder: " ",
    className:
      "peer w-full bg-transparent pb-2 pt-5 text-[14px] outline-none transition placeholder:text-transparent",
    style: {
      color: "var(--brand-cream)",
      borderBottom: "1px solid color-mix(in oklab, var(--brand-cream) 22%, transparent)",
    } as React.CSSProperties,
  };
  return (
    <div className={`relative ${className}`}>
      {as === "textarea" ? (
        <textarea rows={3} {...common} />
      ) : (
        <input type={type} {...common} />
      )}
      <label
        htmlFor={name}
        className="pointer-events-none absolute left-0 top-1 text-[11.5px] uppercase tracking-[0.18em] transition-all peer-placeholder-shown:top-5 peer-placeholder-shown:text-[13.5px] peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-1 peer-focus:text-[11.5px] peer-focus:uppercase peer-focus:tracking-[0.18em]"
        style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
      >
        {label}
      </label>
    </div>
  );
}
