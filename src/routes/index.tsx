import { createFileRoute, Link } from "@tanstack/react-router";
import {
  motion, useReducedMotion, useScroll, useTransform, animate, useInView,
  useMotionValue, useSpring, AnimatePresence,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  ShieldCheck, Workflow, BrainCircuit, Lock, Building2, Sparkles,
  ArrowRight, Layers, KeyRound, Wand2, FileText, LineChart, Bell,
  Users, Activity, History, ShieldAlert, Zap, GitBranch, Database,
  CheckCircle2, ArrowUpRight, Cpu, Radar, Eye, Feather,
  Download, Filter, Fingerprint, ScanSearch,
  Play, Pause, RotateCcw, CircleDot, AlertTriangle,
  X, Mail, BookOpen, Calculator, Video, BarChart3, ChevronRight,
  Menu, Clock, Target, Square,
} from "lucide-react";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { NeuralCanvas, AtmosOverlay, HeroOrbital, ArchitectureBands, CapabilityTrio } from "@/components/fvi-neural";
import { appUrl } from "@/lib/cross-domain";
import {
  TenXPromise, FAQ,
  RegulatoryAlignment, StructuredData,
} from "@/components/fvi-landing-additions";
import { AgenticShowcase, TalkToFalconSection } from "@/components/fvi-agentic-showcase";
import { TenantIsolationModel } from "@/components/fvi-tenant-isolation";
import { useHomepageContent, pickString, pickStringArray } from "@/hooks/use-homepage-content";
import { InlineAdminConsole } from "@/components/fvi-inline-admin";
import { SiteAdminFooterLink } from "@/components/site-admin-footer-link";
import { FviDemoPlayer } from "@/components/fvi-demo-player";
import { computeRoi, ROI_DEFAULTS } from "@/lib/roi-model";
import { trackCtaEvent } from "@/lib/cta-tracking";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "ReconIQ — AI Reconciliation" },
      { name: "description", content: "AI-native reconciliation designed for global banks and financial institutions. Agentic triage, hash-chained audit, BYO-LLM sovereignty. Enterprise-grade, zero vendor lock-in." },
      { property: "og:title", content: "ReconIQ — Reconciliation, verified by intelligence." },
      { property: "og:description", content: "Enterprise-grade AI reconciliation. Agentic, auditable, sovereign." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.reconiq.example/" },
    ],
    links: [
      { rel: "canonical", href: "https://www.reconiq.example/" },
    ],
  }),
});

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */

const CAPS = [
  { icon: Layers,      title: "Matching engine",      sub: "20+ matching rules — 1:1, 1:N, N:N, fuzzy, tolerance, composite keys.",                       badge: "V6.2" },
  { icon: BrainCircuit,title: "Agentic AI triage",    sub: "Root-cause analysis, NL rule builder, AIDP for PDFs — with confidence scoring.",              badge: "V6.2" },
  { icon: KeyRound,    title: "BYO-LLM sovereignty",  sub: "Muse, Anthropic, Azure — with cost and token caps. Your key, your vault.",                  badge: "Sovereign" },
  { icon: Workflow,    title: "Run Orchestrator",     sub: "Cron, retries, watermarking. 90d+ run history. Deterministic replay.",                        badge: "Engine v3" },
  { icon: Wand2,       title: "Data Prep pipelines",  sub: "42 transforms with watchers and quality rules. Schema drift detection included.",             badge: "Prep v4" },
  { icon: FileText,    title: "Break Manager",        sub: "Kanban board, side-by-side inspector, four-eyes approval — purpose-built.",                   badge: "V6.1" },
  { icon: LineChart,   title: "Reports & SLA",        sub: "MTTR, ageing, dashboards, exports — at the granularity finance demands.",                     badge: "V6.0" },
  { icon: Activity,    title: "Live collaboration",   sub: "Presence, threaded comments, attachments, full timeline audit on every break.",               badge: "Real-time" },
  { icon: Bell,        title: "Smart notifications",  sub: "Email, Slack, Teams, in-app — routed by tenant policy and reviewer SLA.",                     badge: "Multi-channel" },
  { icon: Users,       title: "Multi-tenant RBAC",    sub: "Groups, per-rekon permissions, attribute-based access — enterprise-ready.",                   badge: "RBAC" },
  { icon: History,     title: "Hash-chained audit",   sub: "Immutable, tenant-isolated, with tamper triggers and signed export.",                         badge: "SHA-256" },
  { icon: ShieldAlert, title: "Zero-trust security",  sub: "TOTP, SSO/SAML, IP allowlist, PII redaction — built in, not bolted on.",                      badge: "Zero-trust" },
];

const METRICS = [
  { v: 99,   suffix: "%", k: "Auto-match target¹" },
  { v: 92,   suffix: "%", k: "MTTR reduction target¹" },
  { v: 12,   suffix: "×", k: "Onboarding speed-up target¹" },
  { v: 0,    suffix: "",  k: "Vendor lock-in" },
];

const PILLARS = [
  { icon: Eye,    label: "Aperture",    body: "A bird's-eye view — total visibility across cash, securities, intercompany and GL flows." },
  { icon: Feather,label: "Precision",   body: "Deterministic rules, probabilistic matching, and tolerance-aware clustering, at millisecond latency." },
  { icon: Radar,  label: "Intelligence",body: "Agentic AI that reasons about breaks, drafts fixes, and writes back under human control." },
];

const LIFECYCLE = [
  { icon: Download,     k: "Ingest",    d: "SFTP · S3 · Kafka · SWIFT · ISO 20022 · webhooks — normalized at the edge." },
  { icon: Filter,       k: "Normalize", d: "42 transforms, watchers and quality rules stage every payload deterministically." },
  { icon: ScanSearch,   k: "Match",     d: "Exact, tolerance, fuzzy, composite and probabilistic — millisecond ledgering." },
  { icon: BrainCircuit, k: "Triage",    d: "Agents cluster breaks, infer root cause, draft resolutions under policy gates." },
  { icon: Fingerprint,  k: "Seal",      d: "Every action hash-chained into an immutable, cross-scope audit ledger." },
];

/** Horizontal pipeline shown in the "Reconciliation, in motion" section.
 *  Mirrors the reference visual: icon on a gold rail, stage counter,
 *  serif title, concise blurb, chip tags. Each stage exposes its own
 *  accent for the icon glow so cross-stage motion stays legible. */
type PipelineStage = {
  icon: typeof Menu;
  k: string;
  d: string;
  chips: string[];
  pip: string;
};
const PIPELINE: PipelineStage[] = [
  { icon: Menu,       k: "Ingest",         d: "Pull from any source — SFTP, S3, Kafka, SWIFT, ISO 20022, webhooks.", chips: ["SFTP", "S3", "Kafka"],       pip: "#6BE5FF" },
  { icon: Clock,      k: "Normalize",      d: "42 transforms, quality rules, and watchers — every row shaped to spec.", chips: ["MT940", "CSV", "AIDP"],   pip: "#D4B581" },
  { icon: ArrowRight, k: "Exact & Fuzzy",  d: "Ref-key match, deterministic rules, then fuzzy tolerance-aware clustering.", chips: ["1:1", "1:N", "N:N"], pip: "#66E5B0" },
  { icon: Target,     k: "AI Triage",      d: "Resolution agents reason about the rest, draft fixes, await four-eyes.", chips: ["BYO-LLM", "4-eyes"],    pip: "#8B7CFF" },
  { icon: Square,     k: "Seal & Audit",   d: "Every action is a hash-chained event. Tamper triggers. SHA-256 anchored.", chips: ["SHA-256", "RBAC"],   pip: "#D4B581" },
];

const TICKER = [
  "✓ Nostro USD/EUR · 12,438 matched · 0.02s",
  "✓ Custody trades · 8,910 confirmed · T+0",
  "◆ AI break cluster · FX cut-off · 2,108 resolved",
  "✓ Intercompany GL · 4,201 sealed · #a91f",
  "✓ AIDP PDF confirms · 612 extracted · 0.97 conf",
  "◆ 4-eyes approval · rule tol(±0.02) · promoted",
  "✓ SWIFT MT940 · 22,041 lines · normalized",
  "✓ Audit anchor · SHA-256 · block #48219",
];

/* ------------------------------------------------------------------ */
/* Atoms                                                              */
/* ------------------------------------------------------------------ */

function useHydrationSafeReducedMotion() {
  const preference = useReducedMotion();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? Boolean(preference) : false;
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em]"
      style={{
        color: "var(--brand-gold)",
        border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)",
        background: "color-mix(in oklab, var(--brand-gold) 8%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

function Counter({ value, suffix }: { value: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState("0");
  const reduce = useHydrationSafeReducedMotion();

  useEffect(() => {
    if (!inView) return;
    if (reduce || value === 0) {
      setDisplay(value === 0 ? "0" : String(value));
      return;
    }
    const controls = animate(0, value, {
      duration: 1.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        setDisplay(value % 1 === 0 ? String(Math.round(v)) : v.toFixed(1));
      },
    });
    return () => controls.stop();
  }, [inView, value, reduce]);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}

/* Cursor-following gold spotlight overlay */
function CursorSpotlight() {
  const reduce = useHydrationSafeReducedMotion();
  const mx = useMotionValue(-500);
  const my = useMotionValue(-500);
  const x = useSpring(mx, { stiffness: 60, damping: 20, mass: 0.4 });
  const y = useSpring(my, { stiffness: 60, damping: 20, mass: 0.4 });

  useEffect(() => {
    if (reduce) return;
    const onMove = (e: PointerEvent) => {
      mx.set(e.clientX);
      my.set(e.clientY);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [mx, my, reduce]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[5] hidden md:block"
      style={{
        background: "radial-gradient(360px 360px at var(--sx) var(--sy), color-mix(in oklab, var(--brand-gold) 10%, transparent), transparent 65%)",
        // @ts-expect-error CSS vars
        "--sx": x, "--sy": y,
        maskImage: "linear-gradient(180deg, black, black)",
      }}
    />
  );
}

/* Top scroll-progress gold beam */
function ScrollBeam() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  return (
    <motion.div
      aria-hidden
      className="fixed left-0 right-0 top-0 z-[60] h-[2px] origin-left"
      style={{
        scaleX,
        background: "linear-gradient(90deg, transparent, var(--brand-gold), transparent)",
        boxShadow: "0 0 12px color-mix(in oklab, var(--brand-gold) 60%, transparent)",
      }}
    />
  );
}

/* Magnetic tilt wrapper */
function Tilt({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const reduce = useHydrationSafeReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(0, { stiffness: 200, damping: 20 });
  const ry = useSpring(0, { stiffness: 200, damping: 20 });
  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ ...style, rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        if (reduce) return;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        ry.set(px * 8);
        rx.set(-py * 8);
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}
    >
      {children}
    </motion.div>
  );
}

/* Reveal words one by one */
function RevealWords({ text, className, style, delay = 0 }: { text: string; className?: string; style?: React.CSSProperties; delay?: number }) {
  const words = text.split(" ");
  return (
    <span className={className} style={style}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <motion.span
            className="inline-block"
            initial={{ y: "110%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.9, delay: delay + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            {w}{i < words.length - 1 ? "\u00A0" : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/* Cinematic section reveal — fades + slides in with the same easing as tile stagger. */
function SectionReveal({
  children,
  as: Tag = "section",
  className,
  id,
  style,
  delay = 0,
  y = 32,
}: {
  children: React.ReactNode;
  as?: "section" | "div";
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  delay?: number;
  y?: number;
}) {
  const MotionTag = Tag === "section" ? motion.section : motion.div;
  return (
    <MotionTag
      id={id}
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </MotionTag>
  );
}

/* Live ticker strip */
function Ticker() {
  const reduce = useHydrationSafeReducedMotion();
  const items = [...TICKER, ...TICKER];
  return (
    <div
      className="relative overflow-hidden rounded-full py-3"
      style={{
        border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
        background: "color-mix(in oklab, var(--ink-void) 70%, transparent)",
        maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
      }}
    >
      <motion.div
        className="flex gap-10 whitespace-nowrap font-mono text-[12px]"
        animate={reduce ? undefined : { x: ["0%", "-50%"] }}
        transition={{ duration: 45, repeat: Infinity, ease: "linear" }}
        style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}
      >
        {items.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-2">
            <span style={{ color: "var(--brand-gold)" }}>◂</span> {t}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero visualization — reconciliation flow with orbiting nodes       */
/* ------------------------------------------------------------------ */

function ReconciliationOrb() {
  const reduce = useHydrationSafeReducedMotion();
  return (
    <div className="relative mx-auto aspect-[16/10] w-full max-w-5xl">
      {/* concentric rings */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${28 + i * 18}%`,
              aspectRatio: "1 / 1",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 22%, transparent)",
              boxShadow: i === 0 ? "0 0 60px 4px color-mix(in oklab, var(--brand-gold) 22%, transparent)" : undefined,
            }}
            animate={reduce ? undefined : { scale: [1, 1.03, 1], opacity: [0.5, 0.9, 0.5] }}
            transition={{ duration: 4 + i * 0.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
          />
        ))}
      </div>

      {/* orbiting nodes */}
      {!reduce && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={`orbit-${i}`}
              className="absolute"
              style={{ width: `${46 + i * 18}%`, aspectRatio: "1 / 1" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 22 + i * 8, repeat: Infinity, ease: "linear" }}
            >
              <div
                className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full"
                style={{
                  background: "var(--brand-gold)",
                  boxShadow: "0 0 14px 2px color-mix(in oklab, var(--brand-gold) 80%, transparent)",
                }}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* svg flow lines */}
      <svg viewBox="0 0 800 500" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="stream" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--brand-gold)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--brand-gold)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--brand-gold)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--brand-gold)" stopOpacity="0.6" />
            <stop offset="60%" stopColor="var(--brand-gold)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--brand-gold)" stopOpacity="0" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* left sources */}
        {[110, 190, 270, 350].map((y, i) => (
          <g key={`L${i}`}>
            <circle cx="40" cy={y} r="4" fill="var(--brand-gold)" opacity="0.85" />
            <path
              d={`M 44 ${y} C 200 ${y}, 300 250, 396 250`}
              stroke="color-mix(in oklab, var(--brand-cream) 22%, transparent)"
              strokeWidth="1"
              fill="none"
            />
            {!reduce && (
              <circle r="3" fill="var(--brand-gold)" filter="url(#glow)">
                <animateMotion
                  dur={`${3 + i * 0.7}s`}
                  repeatCount="indefinite"
                  path={`M 44 ${y} C 200 ${y}, 300 250, 396 250`}
                  begin={`${i * 0.4}s`}
                />
              </circle>
            )}
          </g>
        ))}

        {/* right sources */}
        {[130, 210, 290, 370].map((y, i) => (
          <g key={`R${i}`}>
            <circle cx="760" cy={y} r="4" fill="var(--brand-gold)" opacity="0.85" />
            <path
              d={`M 756 ${y} C 600 ${y}, 500 250, 404 250`}
              stroke="color-mix(in oklab, var(--brand-cream) 22%, transparent)"
              strokeWidth="1"
              fill="none"
            />
            {!reduce && (
              <circle r="3" fill="var(--brand-gold)" filter="url(#glow)">
                <animateMotion
                  dur={`${3.4 + i * 0.6}s`}
                  repeatCount="indefinite"
                  path={`M 756 ${y} C 600 ${y}, 500 250, 404 250`}
                  begin={`${0.2 + i * 0.4}s`}
                />
              </circle>
            )}
          </g>
        ))}

        {/* core glow + pulse */}
        <circle cx="400" cy="250" r="140" fill="url(#core)" />
        {!reduce && (
          <circle cx="400" cy="250" r="46" fill="none" stroke="var(--brand-gold)" strokeOpacity="0.55">
            <animate attributeName="r" values="46;80;46" dur="3.6s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.55;0.05;0.55" dur="3.6s" repeatCount="indefinite" />
          </circle>
        )}
        <circle cx="400" cy="250" r="46" fill="none" stroke="var(--brand-gold)" strokeOpacity="0.55" />
      </svg>

      {/* labels */}
      <div className="absolute left-0 top-6 flex flex-col gap-2 text-[10px] font-mono uppercase tracking-widest opacity-70" style={{ color: "var(--brand-cream)" }}>
        <span>▸ Nostro</span>
        <span>▸ Trades</span>
        <span>▸ Confirms</span>
        <span>▸ GL</span>
      </div>
      <div className="absolute right-0 top-6 flex flex-col items-end gap-2 text-[10px] font-mono uppercase tracking-widest opacity-70" style={{ color: "var(--brand-cream)" }}>
        <span>SWIFT ◂</span>
        <span>Custody ◂</span>
        <span>ERP ◂</span>
        <span>PDF/AIDP ◂</span>
      </div>

      {/* center chip */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center gap-2 rounded-2xl px-6 py-4 backdrop-blur-md"
          style={{
            background: "color-mix(in oklab, var(--brand-coffee-deep) 60%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 45%, transparent)",
            boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6), inset 0 1px 0 color-mix(in oklab, var(--brand-gold) 25%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em]" style={{ color: "var(--brand-gold)" }}>
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "var(--brand-gold)" }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "var(--brand-gold)" }} />
            </span>
            ReconIQ Engine · live
          </div>
          <div className="font-display text-2xl font-semibold tabular-nums" style={{ color: "var(--brand-cream)" }}>
            <Counter value={128432} suffix="" /> <span className="text-xs opacity-60">matched · today</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive Reconciliation Demo                                    */
/* ------------------------------------------------------------------ */

type DemoRow = {
  id: string;
  ref: string;
  ccy: string;
  amount: number;
  date: string;
  counterparty: string;
};

type DemoStatus = "pending" | "matched" | "tolerance" | "ai" | "break";

const DEMO_SIDE_A: DemoRow[] = [
  { id: "a1", ref: "FAL-TR-1001", ccy: "USD", amount: 1_250_000.00, date: "2026-07-01", counterparty: "CITI NY" },
  { id: "a2", ref: "FAL-TR-1002", ccy: "EUR", amount: 480_500.25,   date: "2026-07-01", counterparty: "DB FFT" },
  { id: "a3", ref: "FAL-TR-1003", ccy: "GBP", amount: 92_100.00,    date: "2026-07-01", counterparty: "HSBC LN" },
  { id: "a4", ref: "FAL-TR-1004", ccy: "USD", amount: 15_780.40,    date: "2026-07-01", counterparty: "JPM NY" },
  { id: "a5", ref: "FAL-TR-1005", ccy: "JPY", amount: 3_200_000,    date: "2026-07-01", counterparty: "MUFG TK" },
  { id: "a6", ref: "FAL-TR-1006", ccy: "USD", amount: 78_921.50,    date: "2026-07-01", counterparty: "WELLS SF" },
  { id: "a7", ref: "FAL-TR-1007", ccy: "CHF", amount: 220_000.00,   date: "2026-07-01", counterparty: "UBS ZH" },
];

const DEMO_SIDE_B: DemoRow[] = [
  { id: "b1", ref: "CIT-1001",    ccy: "USD", amount: 1_250_000.00, date: "2026-07-01", counterparty: "Demo Cap" },
  { id: "b2", ref: "DB-8842",     ccy: "EUR", amount: 480_500.23,   date: "2026-07-01", counterparty: "Demo Cap" },
  { id: "b3", ref: "HSBC-77120",  ccy: "GBP", amount: 92_100.00,    date: "2026-07-02", counterparty: "Demo Cap" },
  { id: "b4", ref: "JPM-CONF-40", ccy: "USD", amount: 15_780.40,    date: "2026-07-01", counterparty: "Demo Capital LLC" },
  { id: "b5", ref: "MUFG-TK-991", ccy: "JPY", amount: 3_200_000,    date: "2026-07-01", counterparty: "Demo Cap" },
  { id: "b6", ref: "UBS-ZH-5501", ccy: "CHF", amount: 220_000.00,   date: "2026-07-01", counterparty: "Demo Cap" },
  { id: "b7", ref: "STRAY-90210", ccy: "USD", amount: 4_212.00,     date: "2026-07-01", counterparty: "Unknown" },
];

/**
 * Steps mirror the deterministic recon engine:
 *  0 — raw ingest (nothing matched)
 *  1 — normalize (still pending, but flagged as ready)
 *  2 — exact key match (amount + ccy + date)
 *  3 — tolerance match (±0.02 amount / ±1 day date)
 *  4 — AI/fuzzy match (counterparty alias resolution)
 *  5 — residual breaks surfaced
 */
const DEMO_STEPS = [
  { k: "Ingest",    d: "Raw feeds landed from SWIFT MT940 and internal ledger." },
  { k: "Normalize", d: "Amounts, dates and counterparties standardized by 42 transforms." },
  { k: "Exact",     d: "Deterministic 1:1 key match on amount + currency + date." },
  { k: "Tolerance", d: "±0.02 amount and ±1 day tolerance close near-matches." },
  { k: "AI triage", d: "Agent resolves counterparty aliases with 0.94 confidence." },
  { k: "Breaks",    d: "Residuals surfaced as breaks for 4-eyes triage." },
] as const;

/** Deterministic status map for each side at each step. */
function computeDemoStatus(step: number): {
  a: Record<string, DemoStatus>;
  b: Record<string, DemoStatus>;
} {
  const a: Record<string, DemoStatus> = {};
  const b: Record<string, DemoStatus> = {};
  for (const r of DEMO_SIDE_A) a[r.id] = "pending";
  for (const r of DEMO_SIDE_B) b[r.id] = "pending";
  if (step < 2) return { a, b };

  // Exact matches: a1↔b1, a5↔b5, a7↔b6 (a7 CHF 220000 <-> b6 CHF 220000)
  const exact: Array<[string, string]> = [["a1", "b1"], ["a5", "b5"], ["a7", "b6"]];
  for (const [x, y] of exact) { a[x] = "matched"; b[y] = "matched"; }
  if (step < 3) return { a, b };

  // Tolerance: a2↔b2 (EUR 0.02 diff), a3↔b3 (GBP date +1)
  const tol: Array<[string, string]> = [["a2", "b2"], ["a3", "b3"]];
  for (const [x, y] of tol) { a[x] = "tolerance"; b[y] = "tolerance"; }
  if (step < 4) return { a, b };

  // AI/fuzzy: a4↔b4 (counterparty alias)
  a["a4"] = "ai"; b["b4"] = "ai";
  if (step < 5) return { a, b };

  // Breaks: a6 (USD 78921.50, no counterpart), b7 (STRAY-90210)
  a["a6"] = "break"; b["b7"] = "break";
  return { a, b };
}

const STATUS_STYLE: Record<DemoStatus, { label: string; fg: string; bg: string; border: string }> = {
  pending:   { label: "Pending",    fg: "color-mix(in oklab, var(--brand-cream) 65%, transparent)", bg: "color-mix(in oklab, var(--brand-cream) 6%, transparent)",  border: "color-mix(in oklab, var(--brand-cream) 14%, transparent)" },
  matched:   { label: "Matched",    fg: "#7ee2a8", bg: "color-mix(in oklab, #7ee2a8 12%, transparent)", border: "color-mix(in oklab, #7ee2a8 35%, transparent)" },
  tolerance: { label: "±Tolerance", fg: "var(--brand-gold)", bg: "color-mix(in oklab, var(--brand-gold) 12%, transparent)", border: "color-mix(in oklab, var(--brand-gold) 40%, transparent)" },
  ai:        { label: "AI resolved",fg: "#c8a2ff", bg: "color-mix(in oklab, #c8a2ff 12%, transparent)", border: "color-mix(in oklab, #c8a2ff 35%, transparent)" },
  break:     { label: "Break",      fg: "#ff9a8a", bg: "color-mix(in oklab, #ff9a8a 12%, transparent)", border: "color-mix(in oklab, #ff9a8a 40%, transparent)" },
};

function formatAmount(n: number, ccy: string) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: ccy === "JPY" ? 0 : 2, maximumFractionDigits: ccy === "JPY" ? 0 : 2 }).format(n);
}

function DemoRowCard({ row, status }: { row: DemoRow; status: DemoStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <motion.div
      layout
      animate={{
        borderColor: s.border,
        backgroundColor: status === "pending"
          ? "color-mix(in oklab, var(--ink-void) 92%, transparent)"
          : "color-mix(in oklab, var(--ink-void) 82%, transparent)",
      }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl p-3"
      style={{ border: "1px solid" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px]" style={{ color: "var(--brand-cream)" }}>
            {row.ref}
          </div>
          <div className="mt-0.5 truncate text-[11px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
            {row.counterparty} · {row.date}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display tabular-nums text-[13px]" style={{ color: "var(--brand-cream)" }}>
            {formatAmount(row.amount, row.ccy)}
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "color-mix(in oklab, var(--brand-gold) 75%, var(--brand-cream))" }}>
            {row.ccy}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: s.fg, background: s.bg, border: `1px solid ${s.border}` }}
        >
          <CircleDot className="h-2.5 w-2.5" />
          {s.label}
        </span>
      </div>
    </motion.div>
  );
}

function InteractiveReconDemo() {
  const reduce = useHydrationSafeReducedMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const maxStep = DEMO_STEPS.length - 1;

  useEffect(() => {
    if (!playing || reduce) return;
    const t = setInterval(() => {
      setStep((s) => {
        if (s >= maxStep) { setPlaying(false); return s; }
        return s + 1;
      });
    }, 1500);
    return () => clearInterval(t);
  }, [playing, reduce, maxStep]);

  const status = computeDemoStatus(step);
  const counts = { matched: 0, tolerance: 0, ai: 0, break: 0, pending: 0 } as Record<DemoStatus, number>;
  for (const r of DEMO_SIDE_A) counts[status.a[r.id]]++;
  for (const r of DEMO_SIDE_B) counts[status.b[r.id]]++;
  const total = DEMO_SIDE_A.length + DEMO_SIDE_B.length;
  const resolved = counts.matched + counts.tolerance + counts.ai;
  const pct = Math.round((resolved / total) * 100);

  return (
    <section
      className="relative py-28"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
        background:
          "radial-gradient(1000px 500px at 50% 0%, color-mix(in oklab, var(--brand-gold) 5%, transparent), transparent 60%)",
      }}
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 flex flex-col items-center text-center">
          <Kicker>Try the engine — live</Kicker>
          <h2 className="mt-5 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl" style={{ color: "var(--brand-cream)" }}>
            Scrub the pipeline.{" "}
            <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
              Watch reconciliation resolve in real time.
            </span>
          </h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}>
            A live sample of 7 bank statement rows against 7 ledger entries. Move the slider through
            each stage — exact keys, tolerance, AI alias resolution — and see matched and unmatched
            outputs update instantly.
          </p>
        </div>

        <div
          className="relative overflow-hidden rounded-3xl p-6 md:p-10"
          style={{
            background: "color-mix(in oklab, var(--brand-coffee-deep) 55%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 22%, transparent)",
            boxShadow: "0 40px 100px -40px rgba(0,0,0,0.7)",
          }}
        >
          {/* Controls */}
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "Pause demo" : "Play demo"}
                className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12px] font-semibold uppercase tracking-[0.18em] transition hover:brightness-110"
                style={{
                  color: "var(--ink-void)",
                  background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 75%, black))",
                  boxShadow: "0 12px 30px -12px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
                }}
              >
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {playing ? "Pause" : step >= maxStep ? "Replay" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => { setStep(0); setPlaying(false); }}
                aria-label="Reset demo"
                className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12px] font-semibold uppercase tracking-[0.18em] transition hover:bg-[color:color-mix(in_oklab,var(--brand-cream)_8%,transparent)]"
                style={{
                  color: "var(--brand-cream)",
                  border: "1px solid color-mix(in oklab, var(--brand-cream) 18%, transparent)",
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </div>

            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em]" style={{ color: "var(--brand-gold)" }}>
                Stage {step + 1} / {DEMO_STEPS.length} · {DEMO_STEPS[step].k}
              </div>
              <div className="mt-1 text-[13px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 75%, transparent)" }}>
                {DEMO_STEPS[step].d}
              </div>
            </div>
          </div>

          {/* Scrubber */}
          <div className="mb-2">
            <input
              type="range"
              min={0}
              max={maxStep}
              step={1}
              value={step}
              onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }}
              aria-label="Reconciliation stage scrubber"
              className="fvi-scrub w-full"
            />
            <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
              {DEMO_STEPS.map((s, i) => (
                <button
                  key={s.k}
                  type="button"
                  onClick={() => { setPlaying(false); setStep(i); }}
                  className="cursor-pointer transition"
                  style={{ color: i <= step ? "var(--brand-gold)" : undefined }}
                >
                  {s.k}
                </button>
              ))}
            </div>
          </div>

          {/* Live counters */}
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
            {([
              { k: "Matched",    v: counts.matched,   status: "matched" as DemoStatus },
              { k: "Tolerance",  v: counts.tolerance, status: "tolerance" as DemoStatus },
              { k: "AI resolved",v: counts.ai,        status: "ai" as DemoStatus },
              { k: "Breaks",     v: counts.break,     status: "break" as DemoStatus },
              { k: "% Resolved", v: pct,              status: "matched" as DemoStatus, suffix: "%" },
            ]).map((c) => {
              const s = STATUS_STYLE[c.status];
              return (
                <div
                  key={c.k}
                  className="rounded-xl p-3"
                  style={{
                    background: "color-mix(in oklab, var(--ink-void) 88%, transparent)",
                    border: `1px solid ${s.border}`,
                  }}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: s.fg }}>
                    {c.k}
                  </div>
                  <motion.div
                    key={`${c.k}-${c.v}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="mt-1 font-display text-2xl tabular-nums"
                    style={{ color: "var(--brand-cream)" }}
                  >
                    {c.v}{("suffix" in c) ? c.suffix : ""}
                  </motion.div>
                </div>
              );
            })}
          </div>

          {/* Two sides */}
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: "var(--brand-gold)" }}>
                  Side A · Bank statement (MT940)
                </div>
                <div className="text-[11px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 60%, transparent)" }}>
                  {DEMO_SIDE_A.length} rows
                </div>
              </div>
              <div className="space-y-2">
                {DEMO_SIDE_A.map((r) => (
                  <DemoRowCard key={r.id} row={r} status={status.a[r.id]} />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: "var(--brand-gold)" }}>
                  Side B · Internal ledger
                </div>
                <div className="text-[11px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 60%, transparent)" }}>
                  {DEMO_SIDE_B.length} rows
                </div>
              </div>
              <div className="space-y-2">
                {DEMO_SIDE_B.map((r) => (
                  <DemoRowCard key={r.id} row={r} status={status.b[r.id]} />
                ))}
              </div>
            </div>
          </div>

          {/* Break banner */}
          {step >= maxStep && counts.break > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 flex items-start gap-3 rounded-xl p-4"
              style={{
                background: "color-mix(in oklab, #ff9a8a 8%, transparent)",
                border: "1px solid color-mix(in oklab, #ff9a8a 35%, transparent)",
              }}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#ff9a8a" }} />
              <div>
                <div className="text-[12px] font-semibold" style={{ color: "#ff9a8a" }}>
                  {counts.break} residual {counts.break === 1 ? "break" : "breaks"} routed to the Break Manager
                </div>
                <div className="mt-0.5 text-[12px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}>
                  4-eyes triage with agent-drafted root cause and evidence pack — sealed on close.
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Range styling */}
      <style>{`
        .fvi-scrub {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 999px;
          background: linear-gradient(90deg,
            var(--brand-gold) 0%,
            var(--brand-gold) ${(step / maxStep) * 100}%,
            color-mix(in oklab, var(--brand-cream) 12%, transparent) ${(step / maxStep) * 100}%,
            color-mix(in oklab, var(--brand-cream) 12%, transparent) 100%);
          outline: none;
        }
        .fvi-scrub::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px; height: 20px;
          border-radius: 999px;
          background: var(--brand-gold);
          border: 3px solid var(--ink-void);
          box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand-gold) 60%, transparent), 0 6px 20px -4px color-mix(in oklab, var(--brand-gold) 70%, transparent);
          cursor: grab;
        }
        .fvi-scrub::-moz-range-thumb {
          width: 20px; height: 20px;
          border-radius: 999px;
          background: var(--brand-gold);
          border: 3px solid var(--ink-void);
          box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand-gold) 60%, transparent);
          cursor: grab;
        }
      `}</style>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Cinematic scroll-scrubbed lifecycle                                */
/* ------------------------------------------------------------------ */



/* ------------------------------------------------------------------ */
/* Relationship Intelligence — animated network graph                 */
/* ------------------------------------------------------------------ */

type RINode = {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  kind: "source" | "signal" | "core" | "action" | "governance";
};

const RI_NODES: RINode[] = [
  // Sources — left column
  { id: "bank",      label: "Bank feed",       sub: "SWIFT MT/ISO",  x: 90,  y: 120, kind: "source" },
  { id: "ledger",    label: "GL ledger",       sub: "Oracle · SAP",  x: 90,  y: 260, kind: "source" },
  { id: "custodian", label: "Custodian",       sub: "State Street",  x: 90,  y: 400, kind: "source" },
  { id: "broker",    label: "Broker",          sub: "FIX · FpML",    x: 90,  y: 540, kind: "source" },
  // Signals — top
  { id: "sla",       label: "SLA watch",       sub: "cutoff timers", x: 360, y: 70,  kind: "signal" },
  { id: "anomaly",   label: "Anomaly scan",    sub: "z-score · IQR", x: 620, y: 70,  kind: "signal" },
  // Core
  { id: "core",      label: "ReconIQ Core",    sub: "match · reason",x: 500, y: 320, kind: "core" },
  // Actions — right
  { id: "agent",     label: "Resolution agent",sub: "auto-triage",   x: 860, y: 180, kind: "action" },
  { id: "reviewer",  label: "Human 4-eyes",    sub: "approve · sign",x: 900, y: 320, kind: "action" },
  { id: "writeback", label: "Write-back",      sub: "ERP · GL",      x: 860, y: 460, kind: "action" },
  // Governance — bottom
  { id: "audit",     label: "Hash-chain audit",sub: "SHA-256 anchor",x: 360, y: 570, kind: "governance" },
  { id: "policy",    label: "Policy & RBAC",   sub: "kill switch",   x: 640, y: 570, kind: "governance" },
];

const RI_EDGES: Array<{ from: string; to: string; strong?: boolean }> = [
  { from: "bank", to: "core", strong: true },
  { from: "ledger", to: "core", strong: true },
  { from: "custodian", to: "core" },
  { from: "broker", to: "core" },
  { from: "sla", to: "core" },
  { from: "anomaly", to: "core" },
  { from: "core", to: "agent", strong: true },
  { from: "core", to: "reviewer" },
  { from: "agent", to: "reviewer" },
  { from: "reviewer", to: "writeback", strong: true },
  { from: "agent", to: "writeback" },
  { from: "core", to: "audit", strong: true },
  { from: "reviewer", to: "audit" },
  { from: "writeback", to: "audit" },
  { from: "policy", to: "core" },
  { from: "policy", to: "agent" },
];

function nodeById(id: string) {
  return RI_NODES.find((n) => n.id === id)!;
}

const KIND_STYLE: Record<RINode["kind"], { fill: string; ring: string; label: string }> = {
  source:     { fill: "color-mix(in oklab, var(--brand-cream) 8%, transparent)",  ring: "color-mix(in oklab, var(--brand-cream) 35%, transparent)", label: "Source" },
  signal:     { fill: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",  ring: "color-mix(in oklab, var(--brand-gold) 55%, transparent)",  label: "Signal" },
  core:       { fill: "color-mix(in oklab, var(--brand-gold) 28%, transparent)",  ring: "var(--brand-gold)",                                        label: "ReconIQ Core" },
  action:     { fill: "color-mix(in oklab, var(--brand-cream) 12%, transparent)", ring: "color-mix(in oklab, var(--brand-cream) 55%, transparent)", label: "Action" },
  governance: { fill: "color-mix(in oklab, var(--brand-coffee-deep) 60%, transparent)", ring: "color-mix(in oklab, var(--brand-gold) 40%, transparent)", label: "Governance" },
};

function RelationshipIntelligence() {
  const reduce = useHydrationSafeReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const isActive = (id: string) =>
    hover === id || (hover != null && RI_EDGES.some((e) => (e.from === hover && e.to === id) || (e.to === hover && e.from === id)));
  const edgeActive = (from: string, to: string) => hover === from || hover === to;

  return (
    <section
      className="relative py-32"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
        background:
          "radial-gradient(900px 500px at 50% 20%, color-mix(in oklab, var(--brand-gold) 5%, transparent), transparent 60%)",
      }}
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 flex flex-col items-center text-center">
          <Kicker>Relationship Intelligence</Kicker>
          <h2 className="mt-5 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl" style={{ color: "var(--brand-cream)" }}>
            Every signal, every source,{" "}
            <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
              one intelligent graph.
            </span>
          </h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}>
            Hover any node to trace how data, signals, and decisions travel through the ReconIQ Core —
            from ingest to write-back, under hash-chained governance.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          className="relative overflow-hidden rounded-3xl p-4 md:p-8"
          style={{
            background: "color-mix(in oklab, var(--brand-coffee-deep) 45%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 20%, transparent)",
            boxShadow: "0 40px 100px -50px rgba(0,0,0,0.75)",
          }}
        >
          <svg
            viewBox="0 0 1000 640"
            className="block w-full h-auto"
            role="img"
            aria-label="ReconIQ relationship graph"
          >
            <defs>
              <radialGradient id="ri-core-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="var(--brand-gold)" stopOpacity="0.55" />
                <stop offset="60%"  stopColor="var(--brand-gold)" stopOpacity="0.12" />
                <stop offset="100%" stopColor="var(--brand-gold)" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="ri-edge" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor="var(--brand-gold)" stopOpacity="0.15" />
                <stop offset="50%"  stopColor="var(--brand-gold)" stopOpacity="0.65" />
                <stop offset="100%" stopColor="var(--brand-gold)" stopOpacity="0.15" />
              </linearGradient>
              <filter id="ri-soft" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>

            {/* Subtle grid */}
            <g opacity="0.08" stroke="var(--brand-cream)" strokeWidth="0.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <line key={`h${i}`} x1="0" x2="1000" y1={i * 64} y2={i * 64} />
              ))}
              {Array.from({ length: 16 }).map((_, i) => (
                <line key={`v${i}`} x1={i * 64} x2={i * 64} y1="0" y2="640" />
              ))}
            </g>

            {/* Core glow */}
            <circle cx={nodeById("core").x} cy={nodeById("core").y} r="140" fill="url(#ri-core-glow)" />

            {/* Edges */}
            <g fill="none">
              {RI_EDGES.map((e, i) => {
                const a = nodeById(e.from);
                const b = nodeById(e.to);
                const active = edgeActive(e.from, e.to);
                const dimmed = hover != null && !active;
                const strokeW = e.strong ? 1.6 : 1.1;
                return (
                  <g key={`${e.from}-${e.to}`} style={{ transition: "opacity 240ms" }} opacity={dimmed ? 0.18 : 1}>
                    <line
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke="url(#ri-edge)"
                      strokeWidth={active ? strokeW + 0.8 : strokeW}
                      strokeLinecap="round"
                    />
                    {!reduce && (
                      <line
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke="var(--brand-gold)"
                        strokeOpacity={active ? 0.9 : 0.55}
                        strokeWidth={active ? strokeW + 0.4 : strokeW}
                        strokeDasharray="3 10"
                        strokeLinecap="round"
                      >
                        <animate
                          attributeName="stroke-dashoffset"
                          from="0"
                          to="-26"
                          dur={`${2.4 + (i % 5) * 0.4}s`}
                          repeatCount="indefinite"
                        />
                      </line>
                    )}
                    {!reduce && e.strong && (
                      <circle r="2.6" fill="var(--brand-gold)">
                        <animate attributeName="cx" from={a.x} to={b.x} dur={`${3.2 + (i % 4) * 0.5}s`} repeatCount="indefinite" />
                        <animate attributeName="cy" from={a.y} to={b.y} dur={`${3.2 + (i % 4) * 0.5}s`} repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0;1;1;0" dur={`${3.2 + (i % 4) * 0.5}s`} repeatCount="indefinite" />
                      </circle>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Nodes */}
            <g>
              {RI_NODES.map((n, i) => {
                const s = KIND_STYLE[n.kind];
                const r = n.kind === "core" ? 42 : 26;
                const active = isActive(n.id);
                const dimmed = hover != null && !active;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x}, ${n.y})`}
                    style={{ cursor: "pointer", transition: "opacity 240ms" }}
                    opacity={dimmed ? 0.35 : 1}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(n.id)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${s.label}: ${n.label}`}
                  >
                    {/* pulse ring */}
                    {!reduce && (
                      <circle r={r} fill="none" stroke={s.ring} strokeOpacity="0.4">
                        <animate attributeName="r" values={`${r};${r + 10};${r}`} dur={`${3 + (i % 3) * 0.6}s`} repeatCount="indefinite" />
                        <animate attributeName="stroke-opacity" values="0.5;0;0.5" dur={`${3 + (i % 3) * 0.6}s`} repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle r={r} fill={s.fill} stroke={s.ring} strokeWidth={active ? 2 : 1.25} />
                    {n.kind === "core" && (
                      <circle r={r - 10} fill="none" stroke="var(--brand-gold)" strokeOpacity="0.55" strokeDasharray="2 4" />
                    )}
                    <text
                      y={n.kind === "core" ? 4 : -r - 12}
                      textAnchor="middle"
                      fontSize={n.kind === "core" ? 13 : 12}
                      fontWeight={600}
                      fill="var(--brand-cream)"
                      style={{ fontFamily: "inherit" }}
                    >
                      {n.label}
                    </text>
                    {n.sub && n.kind !== "core" && (
                      <text
                        y={-r - 26}
                        textAnchor="middle"
                        fontSize="9.5"
                        fill="color-mix(in oklab, var(--brand-cream) 60%, transparent)"
                        style={{ fontFamily: "inherit", letterSpacing: "0.08em", textTransform: "uppercase" }}
                      >
                        {n.sub}
                      </text>
                    )}
                    {n.kind === "core" && (
                      <text
                        y={20}
                        textAnchor="middle"
                        fontSize="9.5"
                        fill="color-mix(in oklab, var(--brand-cream) 70%, transparent)"
                        style={{ fontFamily: "inherit", letterSpacing: "0.14em", textTransform: "uppercase" }}
                      >
                        {n.sub}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Legend */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {(Object.keys(KIND_STYLE) as RINode["kind"][]).map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
                style={{
                  border: `1px solid ${KIND_STYLE[k].ring}`,
                  background: KIND_STYLE[k].fill,
                  color: "var(--brand-cream)",
                }}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: KIND_STYLE[k].ring }}
                />
                {KIND_STYLE[k].label}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function LifecycleFilm() {
  const reduce = useHydrationSafeReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const inView = useInView(wrap, { once: false, amount: 0.35 });

  // scroll-driven progress so the gold rail draws in as the section
  // enters and the stage counter advances stepwise.
  const { scrollYProgress } = useScroll({
    target: wrap,
    offset: ["start 85%", "end 40%"],
  });
  const railProgress = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const railWidth = useTransform(railProgress, (v) => `${Math.min(100, v * 100)}%`);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    return railProgress.on("change", (v) => {
      // -1 before any stage; then 0..PIPELINE.length-1
      const idx = v <= 0 ? -1 : Math.min(PIPELINE.length - 1, Math.floor(v * PIPELINE.length));
      setActive(idx);
    });
  }, [railProgress]);

  return (
    <section
      id="pipeline"
      ref={wrap}
      className="relative overflow-hidden py-28"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
        background:
          "radial-gradient(1100px 480px at 50% 0%, color-mix(in oklab, var(--brand-gold) 7%, transparent), transparent 65%)",
      }}
    >
      {/* ambient starfield — drifting sparks */}
      {!reduce && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: 22 }).map((_, i) => {
            const top = (i * 37) % 100;
            const left = (i * 53) % 100;
            const delay = (i % 7) * 0.6;
            const dur = 6 + (i % 5);
            return (
              <motion.span
                key={i}
                className="absolute h-[2px] w-[2px] rounded-full"
                style={{
                  top: `${top}%`,
                  left: `${left}%`,
                  background: i % 3 === 0 ? "var(--brand-gold)" : "color-mix(in oklab, var(--brand-cream) 60%, transparent)",
                  boxShadow: "0 0 8px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
                }}
                animate={{ opacity: [0.15, 0.9, 0.15], scale: [0.6, 1.4, 0.6] }}
                transition={{ duration: dur, repeat: Infinity, ease: "easeInOut", delay }}
              />
            );
          })}
        </div>
      )}

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mb-14 flex flex-col items-center text-center">
          <Kicker>Reconciliation, in motion</Kicker>
          <h2 className="mt-5 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl" style={{ color: "var(--brand-cream)" }}>
            Five stages.{" "}
            <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
              One continuous intelligence.
            </span>
          </h2>
        </div>

        {/* the rail — drawn in on scroll, then a traveller pulse loops ambient */}
        <div className="relative mx-auto max-w-6xl">
          {/* base line (dim) — sits at the icon center for the current breakpoint */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-[42px] hidden h-px md:block lg:top-[52px]"
            style={{ background: "color-mix(in oklab, var(--brand-cream) 10%, transparent)" }}
          />
          {/* animated gold line — width tied to scroll */}
          <motion.div
            aria-hidden
            className="absolute left-0 top-[42px] hidden h-px md:block lg:top-[52px]"
            style={{
              width: reduce ? "100%" : railWidth,
              background:
                "linear-gradient(90deg, transparent, color-mix(in oklab, var(--brand-gold) 85%, transparent) 12%, var(--brand-gold) 50%, color-mix(in oklab, var(--brand-gold) 85%, transparent) 88%, transparent)",
              boxShadow: "0 0 18px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
            }}
          />

          {/* ambient traveller — a comet that runs the rail on loop once active */}
          {!reduce && active >= 0 && (
            <motion.div
              aria-hidden
              className="absolute top-[36px] hidden h-[13px] w-[13px] rounded-full md:block lg:top-[46px]"
              style={{
                background: "var(--brand-gold)",
                boxShadow: "0 0 22px 6px color-mix(in oklab, var(--brand-gold) 75%, transparent)",
              }}
              initial={{ left: "-2%" }}
              animate={{ left: ["-2%", "102%"] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
            />
          )}

          {/* mobile vertical rail — visible only below md, runs behind the
              stacked stage icons so the pipeline reads as a continuous flow */}
          <div
            aria-hidden
            className="absolute left-1/2 top-0 bottom-0 block w-px -translate-x-1/2 md:hidden"
            style={{
              background:
                "linear-gradient(180deg, transparent, color-mix(in oklab, var(--brand-gold) 55%, transparent) 8%, color-mix(in oklab, var(--brand-gold) 25%, transparent) 92%, transparent)",
            }}
          />

          {/* stage grid — tighter gaps at md so 5 icons + rail fit without collision */}
          <div className="relative grid grid-cols-1 gap-10 md:grid-cols-5 md:gap-3 lg:gap-6">

            {PIPELINE.map((s, i) => {
              const on = i <= active;
              return (
                <motion.div
                  key={s.k}
                  initial={{ opacity: 0, y: 30 }}
                  animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                  transition={{ duration: 0.7, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-center text-center"
                >
                  {/* icon well on the rail */}
                  <div className="relative">
                    {/* pulsing halo when active */}
                    {on && !reduce && (
                      <motion.span
                        aria-hidden
                        className="absolute inset-0 rounded-full"
                        style={{ background: `radial-gradient(circle, ${s.pip}55, transparent 70%)` }}
                        animate={{ scale: [1, 1.9, 1], opacity: [0.55, 0, 0.55] }}
                        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
                      />
                    )}
                    <motion.div
                      className="relative grid h-[84px] w-[84px] place-items-center rounded-full lg:h-[104px] lg:w-[104px]"
                      animate={{
                        borderColor: on
                          ? "color-mix(in oklab, var(--brand-gold) 65%, transparent)"
                          : "color-mix(in oklab, var(--brand-cream) 14%, transparent)",
                        boxShadow: on
                          ? `0 0 40px -6px ${s.pip}, inset 0 0 24px color-mix(in oklab, var(--brand-gold) 22%, transparent)`
                          : "0 10px 30px -14px rgba(0,0,0,0.6)",
                      }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        background:
                          "radial-gradient(circle at 30% 25%, color-mix(in oklab, var(--brand-coffee-deep) 90%, transparent), var(--ink-void) 75%)",
                        border: "1px solid",
                      }}
                    >
                      <motion.div
                        animate={on && !reduce ? { rotate: [0, 360] } : { rotate: 0 }}
                        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-1 rounded-full"
                        style={{
                          borderTop: `1px dashed color-mix(in oklab, ${s.pip} 60%, transparent)`,
                          borderRight: "1px dashed transparent",
                          borderBottom: "1px dashed transparent",
                          borderLeft: `1px dashed color-mix(in oklab, ${s.pip} 25%, transparent)`,
                        }}
                      />
                      <motion.div
                        animate={on ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <s.icon
                          className="h-6 w-6 lg:h-7 lg:w-7"
                          style={{ color: on ? "var(--brand-gold)" : "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
                        />
                      </motion.div>
                    </motion.div>
                    {/* connector pip that sits on the rail — offset matches icon-well radius per breakpoint */}
                    <motion.span
                      aria-hidden
                      className="absolute left-1/2 top-[42px] hidden h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full md:block lg:top-[52px]"
                      animate={{
                        background: on ? "var(--brand-gold)" : "color-mix(in oklab, var(--brand-cream) 25%, transparent)",
                        boxShadow: on ? "0 0 14px var(--brand-gold)" : "none",
                      }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>


                  {/* stage counter */}
                  <motion.div
                    className="mt-6 font-mono text-[11px] uppercase tracking-[0.32em]"
                    animate={{ color: on ? "var(--brand-gold)" : "color-mix(in oklab, var(--brand-cream) 42%, transparent)" }}
                    transition={{ duration: 0.5 }}
                  >
                    {String(i + 1).padStart(2, "0")} / {String(PIPELINE.length).padStart(2, "0")}
                  </motion.div>

                  {/* title */}
                  <div
                    className="mt-2 font-display text-[22px] font-medium tracking-tight md:text-[26px]"
                    style={{ color: "var(--brand-cream)" }}
                  >
                    {s.k}
                  </div>

                  {/* blurb */}
                  <p
                    className="mt-3 max-w-[220px] text-[13px] leading-relaxed"
                    style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}
                  >
                    {s.d}
                  </p>

                  {/* chips */}
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                    {s.chips.map((c, ci) => (
                      <motion.span
                        key={c}
                        initial={{ opacity: 0, y: 6 }}
                        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                        transition={{ duration: 0.5, delay: 0.4 + i * 0.12 + ci * 0.06 }}
                        className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
                        style={{
                          color: on ? "var(--brand-gold)" : "color-mix(in oklab, var(--brand-cream) 55%, transparent)",
                          background: on
                            ? "color-mix(in oklab, var(--brand-gold) 10%, transparent)"
                            : "color-mix(in oklab, var(--brand-cream) 5%, transparent)",
                          border: `1px solid ${
                            on
                              ? "color-mix(in oklab, var(--brand-gold) 40%, transparent)"
                              : "color-mix(in oklab, var(--brand-cream) 12%, transparent)"
                          }`,
                        }}
                      >
                        {c}
                      </motion.span>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* Conversion Components                                               */
/* ------------------------------------------------------------------ */

/** Sticky bottom bar — shown after user scrolls past hero (~500px) */
function StickyDemoBar() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 520);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (dismissed) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="sticky-bar"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-5 py-3 backdrop-blur-xl md:px-10"
          style={{
            background: "color-mix(in oklab, var(--ink-void) 88%, transparent)",
            borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 28%, transparent)",
            boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.7)",
          }}
        >
          <p className="hidden text-[13px] font-medium md:block" style={{ color: "color-mix(in oklab, var(--brand-cream) 80%, transparent)" }}>
            See ReconIQ close breaks in a live tenant — 30 minutes.
          </p>
          <div className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
            <div className="flex items-center gap-2">
              <Link
                to="/book-demo"
                className="inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-[13px] font-semibold transition hover:brightness-110"
                style={{
                  background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 76%, black))",
                  color: "var(--ink-void)",
                  boxShadow: "0 8px 24px -8px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
                }}
              >
                Book a demo <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-[13px] font-semibold transition"
                style={{
                  border: "1px solid color-mix(in oklab, var(--brand-cream) 20%, transparent)",
                  color: "var(--brand-cream)",
                }}
              >
                Talk to sales
              </Link>
            </div>
            <button
              type="button"
              aria-label="Dismiss bar"
              onClick={() => setDismissed(true)}
              className="ml-2 rounded-full p-1.5 opacity-60 transition hover:opacity-100"
              style={{ color: "var(--brand-cream)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Exit-intent modal — fires once on mouse leaving the top of viewport */
function ExitIntentModal() {
  const [open, setOpen] = useState(false);
  const fired = useRef(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const onMouseLeave = (e: MouseEvent) => {
      if (fired.current || e.clientY > 30) return;
      fired.current = true;
      setOpen(true);
    };
    document.addEventListener("mouseleave", onMouseLeave);
    return () => document.removeEventListener("mouseleave", onMouseLeave);
  }, []);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="exit-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-lg overflow-hidden rounded-3xl p-8"
          style={{
            background: "linear-gradient(145deg, color-mix(in oklab, var(--ink-void) 95%, transparent), color-mix(in oklab, var(--brand-coffee-deep) 98%, transparent))",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)",
            boxShadow: "0 40px 100px -20px rgba(0,0,0,0.9), 0 0 80px -20px color-mix(in oklab, var(--brand-gold) 18%, transparent)",
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-full p-1.5 opacity-60 transition hover:opacity-100"
            style={{ color: "var(--brand-cream)" }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4" style={{ color: "var(--brand-gold)" }} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.28em]" style={{ color: "var(--brand-gold)" }}>
              Before you go
            </span>
          </div>

          {submitted ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: "var(--brand-gold)" }} />
              <h3 className="mt-4 font-display text-2xl font-semibold" style={{ color: "var(--brand-cream)" }}>You're on the list.</h3>
              <p className="mt-2 text-sm" style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}>
                Expect the ReconIQ Buyer's Guide + comparison sheet in your inbox within minutes.
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-6 inline-flex items-center gap-1.5 rounded-full px-6 py-2.5 text-sm font-semibold transition hover:brightness-110"
                style={{
                  background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 76%, black))",
                  color: "var(--ink-void)",
                }}
              >
                Got it <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <h2 className="mt-3 font-display text-2xl font-semibold leading-snug" style={{ color: "var(--brand-cream)" }}>
                Get the ReconIQ Buyer's Guide — free.
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}>
                A 12-page breakdown: reconciliation architecture decisions, ReconIQ vs incumbent vendors vs legacy platforms, ROI model, and implementation timeline. Used by 40+ enterprise procurement teams.
              </p>

              <form
                className="mt-5 flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!email.trim()) return;
                  trackCtaEvent("form_submit", {
                    cta_id: "buyers_guide_form",
                    source: "home_popup",
                    meta: { has_email: true },
                  });
                  setSubmitted(true);
                }}
              >
                <input
                  type="email"
                  required
                  placeholder="your@bank.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border px-4 py-3 text-[14px] outline-none transition focus:ring-2"
                  style={{
                    background: "color-mix(in oklab, var(--brand-cream) 4%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)",
                    color: "var(--brand-cream)",
                    // @ts-expect-error focus ring
                    "--tw-ring-color": "color-mix(in oklab, var(--brand-gold) 50%, transparent)",
                  }}
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition hover:brightness-110"
                  style={{
                    background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 76%, black))",
                    color: "var(--ink-void)",
                    boxShadow: "0 8px 24px -8px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
                  }}
                >
                  <Download className="h-4 w-4" /> Send me the guide
                </button>
              </form>

              <div className="mt-5 border-t pt-5" style={{ borderColor: "color-mix(in oklab, var(--brand-gold) 15%, transparent)" }}>
                <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
                  Or skip straight to a demo:
                </p>
                <Link
                  to="/book-demo"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold transition hover:underline"
                  style={{ color: "var(--brand-gold)" }}
                >
                  Book a 30-min demo <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/** 90-second demo video modal — inline micro-conversion */
function DemoVideoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="demo-video"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.86)", backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-5xl overflow-hidden rounded-2xl"
            style={{ border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)" }}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 z-20 rounded-full p-2"
              style={{ background: "rgba(0,0,0,0.6)", color: "var(--brand-cream)" }}
              aria-label="Close video"
            >
              <X className="h-4 w-4" />
            </button>
            <FviDemoPlayer onClose={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


/** ROI Calculator teaser card — links to the full `/roi` model */
function ROITeaserCard() {
  const [fte, setFte] = useState(8);
  const [vol, setVol] = useState(500_000);
  const [currentMatch, setCurrentMatch] = useState(75); // percent

  // Lightweight preview using the same shape as the full model
  const teaser = computeRoi({
    ...ROI_DEFAULTS,
    fteCount: fte,
    monthlyTxnVolume: vol,
    currentAutoMatchPct: currentMatch / 100,
  });

  const shareHref = `/roi?fteCount=${fte}&monthlyTxnVolume=${vol}&currentAutoMatchPct=${currentMatch / 100}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7 }}
      className="relative overflow-hidden rounded-3xl p-8 md:p-10"
      style={{
        background: "color-mix(in oklab, var(--brand-coffee-deep) 50%, transparent)",
        border: "1px solid color-mix(in oklab, var(--brand-gold) 25%, transparent)",
        boxShadow: "0 40px 100px -40px rgba(0,0,0,0.6)",
      }}
    >
      <div aria-hidden className="absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--brand-gold) 12%, transparent)" }} />
      <div className="relative">
        <div className="flex items-center gap-3 mb-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)", border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)" }}>
            <Calculator className="h-5 w-5" style={{ color: "var(--brand-gold)" }} />
          </div>
          <Kicker>ROI Estimator · preview</Kicker>
        </div>
        <h3 className="mt-3 font-display text-2xl font-semibold md:text-3xl" style={{ color: "var(--brand-cream)" }}>
          Estimate your annual reconciliation savings
        </h3>
        <p className="mt-2 text-[14px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}>
          Anchored to public benchmarks. Every constant is editable and cited in the full model.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "color-mix(in oklab, var(--brand-gold) 85%, var(--brand-cream))" }}>
              Reconciliation FTEs: <span style={{ color: "var(--brand-cream)" }}>{fte}</span>
            </label>
            <input aria-label="Reconciliation FTEs" type="range" min={1} max={50} value={fte} onChange={(e) => setFte(Number(e.target.value))} className="fvi-scrub w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "color-mix(in oklab, var(--brand-gold) 85%, var(--brand-cream))" }}>
              Monthly txn volume: <span style={{ color: "var(--brand-cream)" }}>{vol.toLocaleString("en-US")}</span>
            </label>
            <input aria-label="Monthly transaction volume" type="range" min={5_000} max={10_000_000} step={5_000} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="fvi-scrub w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "color-mix(in oklab, var(--brand-gold) 85%, var(--brand-cream))" }}>
              Current auto-match: <span style={{ color: "var(--brand-cream)" }}>{currentMatch}%</span>
            </label>
            <input aria-label="Current auto-match percentage" type="range" min={40} max={98} value={currentMatch} onChange={(e) => setCurrentMatch(Number(e.target.value))} className="fvi-scrub w-full" />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Est. savings / yr", value: `$${(teaser.mid.totalSavingsYr / 1_000_000).toFixed(2)}M`, sub: `$${(teaser.low.totalSavingsYr / 1_000_000).toFixed(2)}M – $${(teaser.high.totalSavingsYr / 1_000_000).toFixed(2)}M` },
            { label: "Hours freed / yr", value: `${(teaser.mid.totalHoursSavedYr / 1_000).toFixed(1)}k`, sub: `${(teaser.low.totalHoursSavedYr / 1_000).toFixed(1)}k – ${(teaser.high.totalHoursSavedYr / 1_000).toFixed(1)}k` },
            { label: "FTE freed", value: teaser.mid.fteEquivalentFreed.toFixed(1), sub: `${teaser.low.fteEquivalentFreed.toFixed(1)} – ${teaser.high.fteEquivalentFreed.toFixed(1)}` },
            { label: "Payback", value: teaser.mid.paybackMonths < 60 ? `${teaser.mid.paybackMonths.toFixed(1)} mo` : "—", sub: `ROI ${teaser.mid.roiMultiple.toFixed(1)}×` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-4" style={{ background: "color-mix(in oklab, var(--ink-void) 80%, transparent)", border: "1px solid color-mix(in oklab, var(--brand-gold) 22%, transparent)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: "color-mix(in oklab, var(--brand-gold) 80%, var(--brand-cream))" }}>{s.label}</div>
              <div className="mt-1 font-display text-2xl font-semibold tabular-nums" style={{ color: "var(--brand-cream)" }}>{s.value}</div>
              <div className="text-[10px] tabular-nums" style={{ color: "color-mix(in oklab, var(--brand-cream) 50%, transparent)" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 40%, transparent)" }}>
          * Indicative range. Defaults: fully-loaded FTE cost, break rate, resolution time, and audit-prep effort come from public reconciliation benchmarks — see the Assumptions panel in the full model.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={shareHref}
            className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition hover:brightness-110"
            style={{
              background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 76%, black))",
              color: "var(--ink-void)",
              boxShadow: "0 8px 24px -8px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
            }}
          >
            Open full ROI model <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/book-demo"
            className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition"
            style={{ border: "1px solid color-mix(in oklab, var(--brand-cream) 20%, transparent)", color: "var(--brand-cream)" }}
          >
            Get a tailored business case
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

/** Buyer's Guide gated teaser */
function BuyersGuideTeaser() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, delay: 0.1 }}
      className="relative overflow-hidden rounded-3xl p-8 md:p-10"
      style={{
        background: "color-mix(in oklab, var(--brand-coffee-deep) 50%, transparent)",
        border: "1px solid color-mix(in oklab, var(--brand-gold) 25%, transparent)",
        boxShadow: "0 40px 100px -40px rgba(0,0,0,0.6)",
      }}
    >
      <div aria-hidden className="absolute -left-20 -bottom-20 h-64 w-64 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--brand-gold) 10%, transparent)" }} />
      <div className="relative">
        <div className="flex items-center gap-3 mb-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)", border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)" }}>
            <BookOpen className="h-5 w-5" style={{ color: "var(--brand-gold)" }} />
          </div>
          <Kicker>Free download</Kicker>
        </div>
        <h3 className="mt-3 font-display text-2xl font-semibold md:text-3xl" style={{ color: "var(--brand-cream)" }}>
          The Enterprise Reconciliation Buyer's Guide
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}>
          12 pages covering: architecture trade-offs, ReconIQ vs incumbent vendors vs legacy platforms, implementation timeline, and a self-scoring RFP checklist. Built for enterprise procurement workflows.
        </p>
        <ul className="mt-4 space-y-2">
          {[
            "ReconIQ vs incumbent vendors — feature-by-feature matrix",
            "Total cost of ownership model",
            "Implementation and migration playbook",
            "Regulatory checklist: SOC 2, DORA, ISO 27001",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 text-[13px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 80%, transparent)" }}>
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--brand-gold)" }} />
              {item}
            </li>
          ))}
        </ul>

        {/* Regulatory evidence map — links straight to the artefacts */}
        <div
          className="mt-6 rounded-2xl p-4"
          style={{
            background: "color-mix(in oklab, var(--brand-cream) 3%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 20%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: "var(--brand-gold)" }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}>
              Regulatory evidence — jump to the control map
            </span>
          </div>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {[
              {
                code: "DORA",
                label: "EU Digital Operational Resilience Act",
                summary: "Art. 30 clauses, ICT third-party register fields, incident reporting timelines and TLPT support.",
                href: "/security",
              },
              {
                code: "BCBS 239",
                label: "Risk data aggregation & reporting",
                summary: "Lineage, completeness and accuracy evidenced via hash-chained audit and 7-year retention.",
                href: "/security",
              },
              {
                code: "SR 11-7",
                label: "US Fed / OCC Model Risk Management",
                summary: "Per-model documentation, validation evidence, champion/challenger and human-in-the-loop controls.",
                href: "/due-diligence",
              },
              {
                code: "MAS TRM",
                label: "Singapore Technology Risk Management",
                summary: "Third-party risk, cryptography, access control and incident notification aligned to MAS TRM 2021.",
                href: "/security",
              },
              {
                code: "APRA CPS 234",
                label: "AU Information Security Prudential Standard",
                summary: "Information asset classification, control testing cadence and material-incident notification workflow.",
                href: "/security",
              },
              {
                code: "ISO 22301",
                label: "Business Continuity Management",
                summary: "BCP/DR programme, RTO ≤ 1h / RPO ≤ 5m targets, quarterly drills and documented exit plan.",
                href: "/security",
              },
            ].map((r) => (
              <li key={r.code}>
                <Link
                  to={r.href}
                  onClick={() => trackCtaEvent("click", { cta_id: `evidence_${r.code.toLowerCase().replace(/\s+/g, "_")}`, source: "buyers_guide_teaser" })}
                  className="group block rounded-xl p-3 transition hover:brightness-110"
                  style={{
                    background: "color-mix(in oklab, var(--brand-coffee-deep) 55%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--brand-gold)" }}>
                      {r.code}
                    </span>
                    <ArrowRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" style={{ color: "var(--brand-gold)" }} />
                  </div>
                  <div className="mt-0.5 text-[11.5px] font-medium" style={{ color: "var(--brand-cream)" }}>
                    {r.label}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug" style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}>
                    {r.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {sent ? (
          <div className="mt-6 flex items-center gap-2 text-sm" style={{ color: "var(--brand-gold)" }}>
            <CheckCircle2 className="h-4 w-4" /> Guide sent — check your inbox.
          </div>
        ) : (
          <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (email.trim()) { trackCtaEvent("form_submit", { cta_id: "buyers_guide_form", source: "home_inline" }); setSent(true); } }}>
            <input
              type="email"
              required
              placeholder="your@bank.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 rounded-xl border px-4 py-3 text-[14px] outline-none"
              style={{
                background: "color-mix(in oklab, var(--brand-cream) 4%, transparent)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 28%, transparent)",
                color: "var(--brand-cream)",
              }}
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition hover:brightness-110 whitespace-nowrap"
              style={{
                background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 76%, black))",
                color: "var(--ink-void)",
                boxShadow: "0 8px 24px -8px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
              }}
            >
              <Download className="h-4 w-4" /> Get the guide
            </button>
          </form>
        )}
      </div>
    </motion.div>
  );
}

/** ReconIQ vs incumbent comparison teaser */
function ComparisonTeaser() {
  const rows = [
    { feature: "Agentic AI triage",         fvi: true,  incumbent: false, legacy: false },
    { feature: "BYO-LLM / data sovereignty", fvi: true,  incumbent: false, legacy: false },
    { feature: "Hash-chained audit",          fvi: true,  incumbent: false, legacy: false },
    { feature: "Multi-tenant RBAC",           fvi: true,  incumbent: true,  legacy: false },
    { feature: "20+ matching rule types",     fvi: true,  incumbent: true,  legacy: false },
    { feature: "AIDP PDF extraction",         fvi: true,  incumbent: false, legacy: false },
    { feature: "Streaming / near-real-time",  fvi: true,  incumbent: false, legacy: false },
    { feature: "Zero-trust + SSO/SAML",       fvi: true,  incumbent: true,  legacy: false },
  ];

  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="mb-10 flex flex-col items-center text-center">
        <Kicker><BarChart3 className="h-3 w-3" /> ReconIQ vs the market</Kicker>
        <h2 className="mt-5 max-w-3xl font-display text-3xl font-medium tracking-tight md:text-5xl" style={{ color: "var(--brand-cream)" }}>
          How ReconIQ stacks up against{" "}
          <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
            incumbent vendors and legacy reconciliation
          </span>
        </h2>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.7 }}
        className="overflow-hidden rounded-2xl"
        style={{ border: "1px solid color-mix(in oklab, var(--brand-gold) 20%, transparent)" }}
      >
        <table className="w-full">
          <thead>
            <tr style={{ background: "color-mix(in oklab, var(--brand-gold) 8%, transparent)", borderBottom: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)" }}>
              <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "color-mix(in oklab, var(--brand-cream) 60%, transparent)" }}>Capability</th>
              {["ReconIQ", "Incumbent", "Legacy"].map((h) => (
                <th key={h} className="px-5 py-4 text-center text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: h === "ReconIQ" ? "var(--brand-gold)" : "color-mix(in oklab, var(--brand-cream) 50%, transparent)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.feature} style={{ background: i % 2 === 0 ? "color-mix(in oklab, var(--ink-void) 96%, transparent)" : "color-mix(in oklab, var(--ink-void) 90%, transparent)", borderBottom: "1px solid color-mix(in oklab, var(--brand-gold) 8%, transparent)" }}>
                <td className="px-5 py-3.5 text-[13px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 82%, transparent)" }}>{r.feature}</td>
                {[r.fvi, r.incumbent, r.legacy].map((v, j) => (
                  <td key={j} className="px-5 py-3.5 text-center">
                    {v
                      ? <CheckCircle2 className="mx-auto h-4 w-4" style={{ color: j === 0 ? "var(--brand-gold)" : "#7ee2a8" }} />
                      : <span className="block text-center text-[18px] leading-none opacity-25" style={{ color: "var(--brand-cream)" }}>—</span>
                    }
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col items-center gap-4 px-5 py-6 sm:flex-row" style={{ background: "color-mix(in oklab, var(--brand-gold) 6%, transparent)", borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)" }}>
          <p className="text-[13px] flex-1" style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}>
            Get the full 20-capability comparison sheet including TCO model and migration assessment.
          </p>
          <Link
            to="/book-demo"
            className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold whitespace-nowrap transition hover:brightness-110"
            style={{
              background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 76%, black))",
              color: "var(--ink-void)",
              boxShadow: "0 8px 24px -8px color-mix(in oklab, var(--brand-gold) 55%, transparent)",
            }}
          >
            Download full comparison <Download className="h-3.5 w-3.5" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}


/** Footer newsletter + ReconIQ Copilot call-to-action strip */
function FooterNewsletterStrip() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div
      className="py-10"
      style={{ background: "color-mix(in oklab, var(--brand-gold) 5%, transparent)" }}
    >
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-6 md:grid-cols-[1fr_auto_1fr]">
        {/* Newsletter */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] mb-2" style={{ color: "var(--brand-gold)" }}>
            <Mail className="mr-1 inline h-3 w-3" /> Reconciliation Insights
          </div>
          <p className="text-[13px] mb-3" style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}>
            Monthly briefing: reconciliation ops trends, regulatory updates, ReconIQ release notes.
          </p>
          {sent ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--brand-gold)" }}>
              <CheckCircle2 className="h-4 w-4" /> You're subscribed.
            </div>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) setSent(true); }}>
              <input
                type="email"
                required
                placeholder="your@bank.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1 rounded-full border px-4 py-2 text-[13px] outline-none"
                style={{
                  background: "color-mix(in oklab, var(--brand-cream) 4%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 25%, transparent)",
                  color: "var(--brand-cream)",
                }}
              />
              <button
                type="submit"
                className="rounded-full px-5 py-2 text-[13px] font-semibold transition hover:brightness-110 whitespace-nowrap"
                style={{
                  background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 76%, black))",
                  color: "var(--ink-void)",
                }}
              >
                Subscribe
              </button>
            </form>
          )}
        </div>

        {/* Divider */}
        <div className="hidden h-20 w-px md:block" style={{ background: "color-mix(in oklab, var(--brand-gold) 18%, transparent)" }} />

        {/* ReconIQ Copilot */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] mb-2" style={{ color: "var(--brand-gold)" }}>
            <Sparkles className="mr-1 inline h-3 w-3" /> Talk to ReconIQ Copilot
          </div>
          <p className="text-[13px] mb-3" style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}>
            Our AI product advisor answers product questions, compares features, and books demos — 24/7.
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("dr-falcon:open"))}
            className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:brightness-110"
            style={{
              background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 76%, black))",
              color: "var(--ink-void)",
              boxShadow: "0 8px 24px -8px color-mix(in oklab, var(--brand-gold) 50%, transparent)",
            }}
          >
            <Sparkles className="h-4 w-4" /> Start a conversation
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Enterprise Procurement Fit                                         */
/* ------------------------------------------------------------------ */

const PROCUREMENT_LANES: Array<{
  icon: typeof ShieldCheck;
  title: string;
  summary: string;
  items: string[];
}> = [
  {
    icon: ShieldCheck,
    title: "Second-line assurance pack",
    summary: "Evidence curated for Operational Risk, InfoSec, Compliance, and Internal Audit reviews.",
    items: [
      "Control mapping to SOC 2 Type II, ISO 27001, NIST CSF & COBIT",
      "Pre-completed SIG Core, CAIQ v4, and bespoke RFI responses",
      "Independent penetration test summary, SBOM, and DPIA templates",
    ],
  },
  {
    icon: Building2,
    title: "Deployment topology & data residency",
    summary: "Deployment patterns aligned to Tier-1 sovereignty and concentration-risk requirements.",
    items: [
      "Pooled SaaS, dedicated silo, or in-VPC single-tenant control plane",
      "Regional residency across EU, UK, US, APAC, Middle East & Canada",
      "Customer-managed keys (BYO-KMS/HSM) with cryptographic segregation",
    ],
  },
  {
    icon: FileText,
    title: "Legal, commercial & supplier onboarding",
    summary: "Contracting artefacts prepared for Legal, Sourcing, and Vendor Management.",
    items: [
      "MSA, DPA, SCCs, sub-processor register, and DORA Art. 30 schedules",
      "Enterprise, multi-year, and consumption pricing with PO-based billing",
      "KYC / UBO disclosures, financial statements, and insurance certificates",
    ],
  },
  {
    icon: Lock,
    title: "Governance, records & auditability",
    summary: "Controls mapped to BCBS 239, SR 11-7, and three-lines-of-defence operating models.",
    items: [
      "Immutable, hash-chained audit trail with maker–checker (four-eyes)",
      "Field-level data classification, lineage, and configurable retention",
      "Time-boxed break-glass access with full session recording & attestation",
    ],
  },
  {
    icon: Workflow,
    title: "Integration & change governance",
    summary: "Slots into existing enterprise SDLC, ITSM, and release-management standards.",
    items: [
      "SFTP, S3, Kafka, MQ, REST, ServiceNow, Jira & CMDB integrations",
      "SSO via SAML / OIDC, SCIM provisioning, PAM & network allow-listing",
      "Segregated Dev / UAT / Prod environments with signed release evidence",
    ],
  },
  {
    icon: KeyRound,
    title: "Operational resilience & TPRM",
    summary: "Answers Third-Party Risk, BCM, and regulator-driven resilience questionnaires.",
    items: [
      "99.95% target availability with regional active-active option",
      "DR objectives: RPO ≤ 5 min, RTO ≤ 30 min; annual ISO 22301 BCP test",
      "DORA-aligned exit plan, source-code escrow, and data-portability rights",
    ],
  },
];

const PROCUREMENT_TIMELINE: Array<{ phase: string; window: string; detail: string }> = [
  { phase: "Executive discovery", window: "Week 1", detail: "Business-case alignment, target operating model, and success KPIs signed off with sponsor." },
  { phase: "Second-line due diligence", window: "Week 2–3", detail: "InfoSec, Operational Risk, Compliance, and Data Privacy review with full evidence pack." },
  { phase: "Proof of value", window: "Week 3–5", detail: "Isolated tenant on production-grade infrastructure with representative data and measurable KPIs." },
  { phase: "Legal & commercial close", window: "Week 5–7", detail: "MSA, DPA, security schedule, DORA & sub-processor annexes executed with Sourcing and Legal." },
  { phase: "Controlled go-live", window: "Week 7–9", detail: "Change-Advisory-Board cutover, hypercare, and post-implementation review with the sponsor." },
];

function ProcurementFit() {
  return (
    <section
      id="procurement"
      className="relative mx-auto max-w-7xl px-6 py-28"
      aria-labelledby="procurement-heading"
    >
      <div className="mb-14 max-w-3xl">
        <div
          className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]"
          style={{
            background: "color-mix(in oklab, var(--brand-gold) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 28%, transparent)",
            color: "var(--brand-gold)",
          }}
        >
          <ShieldCheck className="h-3 w-3" /> Buyer's guide · Architected to Tier-1 banking standards
        </div>
        <h2
          id="procurement-heading"
          className="text-3xl font-semibold tracking-tight md:text-5xl"
          style={{ color: "var(--brand-cream)" }}
        >
          Engineered to satisfy Operational Risk, InfoSec, and Sourcing — not to work around them.
        </h2>
        <p
          className="mt-4 text-base md:text-lg"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}
        >
          ReconIQ is architected to the control expectations of Tier-1 global banks —
          DORA, BCBS 239, SR 11-7, MAS TRM, APRA CPS 234 and equivalents. Every artefact your three-lines-of-defence
          review requires is prepared up front, so evaluations move from proof of value to signed order form in weeks,
          not quarters.
        </p>
      </div>


      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {PROCUREMENT_LANES.map(({ icon: Icon, title, summary, items }) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="relative flex flex-col gap-4 rounded-2xl p-6"
            style={{
              background: "color-mix(in oklab, var(--brand-cream) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="grid h-9 w-9 place-items-center rounded-lg"
                style={{
                  background: "color-mix(in oklab, var(--brand-gold) 12%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 32%, transparent)",
                  color: "var(--brand-gold)",
                }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <h3
                className="text-[15px] font-semibold tracking-tight"
                style={{ color: "var(--brand-cream)" }}
              >
                {title}
              </h3>
            </div>
            <p
              className="text-[13px] leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}
            >
              {summary}
            </p>
            <ul className="mt-1 space-y-2">
              {items.map((it) => (
                <li
                  key={it}
                  className="flex items-start gap-2 text-[12.5px] leading-relaxed"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)" }}
                >
                  <span
                    className="mt-1.5 h-1 w-1 flex-none rounded-full"
                    style={{ background: "var(--brand-gold)" }}
                  />
                  {it}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>

      {/* Onboarding timeline */}
      <div
        className="mt-14 rounded-2xl p-6 md:p-8"
        style={{
          background: "color-mix(in oklab, var(--brand-cream) 2.5%, transparent)",
          border: "1px solid color-mix(in oklab, var(--brand-gold) 14%, transparent)",
        }}
      >
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.22em]"
              style={{ color: "var(--brand-gold)" }}
            >
              Institutional onboarding pathway
            </div>
            <h3
              className="mt-1 text-xl font-semibold tracking-tight md:text-2xl"
              style={{ color: "var(--brand-cream)" }}
            >
              From sponsor alignment to controlled production in 6–9 weeks.
            </h3>
          </div>
          <Link
            to="/due-diligence"
            onClick={() =>
              trackCtaEvent("click", {
                cta_id: "due_diligence_cta",
                source: "home_procurement_pathway",
              })
            }
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition hover:brightness-110"
            style={{
              background: "color-mix(in oklab, var(--brand-gold) 16%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 38%, transparent)",
              color: "var(--brand-gold)",
            }}
          >
            Request the due-diligence pack <ArrowRight className="h-3.5 w-3.5" />
          </Link>

        </div>

        <ol className="grid gap-4 md:grid-cols-5">
          {PROCUREMENT_TIMELINE.map((step, idx) => (
            <li
              key={step.phase}
              className="relative rounded-xl p-4"
              style={{
                background: "color-mix(in oklab, var(--brand-cream) 3%, transparent)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 10%, transparent)",
              }}
            >
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.2em]"
                style={{ color: "var(--brand-gold)" }}
              >
                {String(idx + 1).padStart(2, "0")} · {step.window}
              </div>
              <div
                className="mt-2 text-[13px] font-semibold"
                style={{ color: "var(--brand-cream)" }}
              >
                {step.phase}
              </div>
              <div
                className="mt-1.5 text-[12px] leading-relaxed"
                style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}
              >
                {step.detail}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* Landing                                                            */
/* ------------------------------------------------------------------ */

function Landing() {
  const reduce = useHydrationSafeReducedMotion();
  const { scrollY } = useScroll();
  const [showVideo, setShowVideo] = useState(false);
  const heroY = useTransform(scrollY, [0, 500], [0, -60]);
  const heroOp = useTransform(scrollY, [0, 500], [1, 0.4]);
  const homepage = useHomepageContent();
  const hero = homepage.hero;
  const strip = homepage.trusted_strip;
  const agentic = homepage.agentic_showcase;
  const talk = homepage.talk_to_falcon;
  const stripTags = pickStringArray(strip, "tags", ["Multi-tenant", "Hash-chained audit", "BYO-LLM", "Zero-trust", "SSO / SAML"]);
  const talkPrompts = pickStringArray(talk, "prompts", []);

  return (
    <div
      className="min-h-screen font-sans antialiased"
      style={{
        background:
          "radial-gradient(1200px 700px at 20% -10%, rgba(20,29,51,0.55), transparent 60%)," +
          "radial-gradient(900px 600px at 90% 10%, rgba(212,181,129,0.08), transparent 55%)," +
          "linear-gradient(180deg, #030508 0%, #05080f 40%, #030508 100%)",
        color: "var(--brand-cream)",
      }}
    >
      <NeuralCanvas />
      <AtmosOverlay />
      <ScrollBeam />
      <CursorSpotlight />
      <StickyDemoBar />
      {/* ExitIntentModal removed per user request */}
      <DemoVideoModal open={showVideo} onClose={() => setShowVideo(false)} />

      {/* subtle grain */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 0.85 0 0 0 0 0.5 0 0 0 0.35 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />

      {/* HEADER */}
      <header
        className="sticky top-0 z-40 backdrop-blur-xl"
        style={{
          background: "color-mix(in oklab, var(--ink-void) 78%, transparent)",
          borderBottom: "1px solid color-mix(in oklab, var(--brand-gold) 14%, transparent)",
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <FviApprovedLogo className="h-9 w-9 rounded-md" />
            <span className="font-display text-[15px] font-semibold tracking-tight">
              ReconIQ{" "}
              <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>Intelligence</span>
            </span>
          </Link>
          <nav
            className="hidden items-center gap-7 text-[13px] md:flex"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)" }}
          >
            <a href="#capabilities" className="relative transition hover:text-[color:var(--brand-gold)]">Product</a>
            <Link to="/solutions" className="relative transition hover:text-[color:var(--brand-gold)]">Solutions</Link>
            <Link to="/pricing" className="relative transition hover:text-[color:var(--brand-gold)]">Pricing</Link>
            <Link to="/security" className="relative transition hover:text-[color:var(--brand-gold)]">Security</Link>
            <Link to="/roi" className="relative transition hover:text-[color:var(--brand-gold)]">ROI</Link>
            <Link to="/about" className="relative transition hover:text-[color:var(--brand-gold)]">Company</Link>
            <Link to="/contact" className="relative transition hover:text-[color:var(--brand-gold)]">Contact</Link>
          </nav>
          <div className="flex items-center gap-3">
            <a href={appUrl("/auth")} className="text-[13px] font-medium transition hover:text-[color:var(--brand-gold)]" style={{ color: "var(--brand-cream)" }}>
              Sign in
            </a>
            <Link
              to="/book-demo"
              className="group inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition hover:brightness-110"
              style={{
                background: "linear-gradient(180deg, color-mix(in oklab, var(--brand-gold) 100%, transparent), color-mix(in oklab, var(--brand-gold) 78%, black))",
                color: "#1a1108",
                boxShadow: "0 10px 30px -12px color-mix(in oklab, var(--brand-gold) 60%, transparent), inset 0 1px 0 rgba(255,255,255,0.35)",
              }}
            >
              Request a demo <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      <StructuredData />

      <main id="main-content" className="relative z-10">
        {/* ============================= HERO ============================= */}
        <section className="relative overflow-hidden">
          {/* readability scrim — keeps hero text legible over AtmosOverlay + NeuralCanvas */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[900px] z-0"
            style={{
              background:
                "radial-gradient(1100px 520px at 50% 22%, rgba(3,5,8,0.72), rgba(3,5,8,0.35) 55%, transparent 78%)",
            }}
          />
          <motion.div
            style={{ y: reduce ? 0 : heroY, opacity: reduce ? 1 : heroOp }}
            className="relative z-10 mx-auto max-w-7xl px-6 pt-24 pb-10 text-center"
          >
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
              <Kicker>
                <Sparkles className="h-3 w-3" /> AI-native reconciliation · Est. for the enterprise
              </Kicker>
            </motion.div>

            <h1 className="mx-auto mt-8 max-w-5xl font-display text-[52px] font-medium leading-[1.02] tracking-[-0.02em] md:text-[86px]">
              <RevealWords text="Clear reconciliation breaks" />{" "}
              <span className="relative inline-block">
                <motion.span
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="relative inline-block bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(120deg, var(--brand-gold) 0%, #f3d78a 40%, var(--brand-gold) 80%)",
                    backgroundSize: "200% 100%",
                  }}
                >
                  10× faster
                </motion.span>
                {!reduce && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%)",
                      mixBlendMode: "overlay",
                    }}
                    animate={{ x: ["-120%", "120%"] }}
                    transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
                  />
                )}
              </span>
              <br />
              <span style={{ color: "color-mix(in oklab, var(--brand-cream) 92%, transparent)" }}>
                <RevealWords text="with agentic AI." delay={0.4} />
              </span>
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.8 }}
              className="mx-auto mt-7 max-w-2xl text-[15px] leading-relaxed md:text-[17px]"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 88%, transparent)" }}
            >
              {pickString(hero, "subhead", "ReconIQ is the AI-native reconciliation platform for banks and financial institutions. Ingest cash, securities, intercompany and GL flows — auto-match with 20+ rules, let agentic AI triage the breaks, and seal every action with hash-chained audit. BYO-LLM, BYO-KMS, zero vendor lock-in.")}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.95 }}
              className="mt-10 flex flex-wrap items-center justify-center gap-3"
            >
              <Link
                to="/book-demo"
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full px-7 py-3.5 text-sm font-semibold transition hover:brightness-110"
                style={{
                  background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 75%, black))",
                  color: "var(--ink-void)",
                  boxShadow: "0 24px 60px -20px color-mix(in oklab, var(--brand-gold) 55%, transparent), inset 0 1px 0 rgba(255,255,255,0.35)",
                }}
              >
                {!reduce && (
                  <motion.span
                    aria-hidden
                    className="absolute inset-0"
                    style={{ background: "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%)" }}
                    animate={{ x: ["-120%", "120%"] }}
                    transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 2.5, ease: "easeInOut" }}
                  />
                )}
                <span className="relative">Book a 30-min demo</span>
                <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/roi"
                className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold transition hover:bg-[color:color-mix(in_oklab,var(--brand-cream)_8%,transparent)]"
                style={{
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 45%, transparent)",
                  color: "var(--brand-cream)",
                }}
              >
                <Calculator className="h-4 w-4" style={{ color: "var(--brand-gold)" }} /> Estimate your ROI
              </Link>
              <button
                type="button"
                onClick={() => setShowVideo(true)}
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-[13px] font-medium transition hover:text-[color:var(--brand-gold)]"
                style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}
              >
                <Play className="h-3.5 w-3.5" /> Watch 90s demo
              </button>
            </motion.div>

            {/* positioning whisper — intended use, not customer proof */}
            <div className="mt-14 flex flex-col items-center gap-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em]" style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}>
                Platform positioning · intended use
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] font-display font-medium tracking-[0.18em]" style={{ color: "color-mix(in oklab, var(--brand-cream) 82%, transparent)" }}>
                <span>ARCHITECTED TO TIER-1 BANKING CONTROL REQUIREMENTS</span>
                <span className="opacity-40">·</span>
                <span>BUILT FOR ENTERPRISE PROCUREMENT WORKFLOWS</span>
                <span className="opacity-40">·</span>
                <span>INTENDED FOR REGULATED FINANCIAL-SERVICES DEPLOYMENTS</span>
              </div>
              <div className="text-[10px] tracking-[0.2em]" style={{ color: "color-mix(in oklab, var(--brand-cream) 45%, transparent)" }}>
                Statements reflect platform design intent. Named customer references published with consent as launch partners go live.
              </div>
            </div>
          </motion.div>

          {/* Hero visualization */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto max-w-7xl px-6 pb-12"
          >
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{
                background: "color-mix(in oklab, var(--ink-void) 85%, transparent)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
                boxShadow: "0 40px 100px -40px rgba(0,0,0,0.7)",
              }}
            >
              {/* Product chrome */}
              <div
                className="flex items-center justify-between border-b px-4 py-2.5 text-[11px]"
                style={{
                  borderColor: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                  color: "color-mix(in oklab, var(--brand-cream) 60%, transparent)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff5f57" }} />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#febc2e" }} />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#28c840" }} />
                  </div>
                  <span className="ml-3 font-mono tracking-tight">app.reconiq.example / workspace / break-manager</span>
                </div>
                <div className="hidden items-center gap-3 md:flex">
                  <span className="inline-flex items-center gap-1"><CircleDot className="h-3 w-3" style={{ color: "var(--brand-gold)" }} /> Live</span>
                  <span>Tenant: acme-emea</span>
                </div>
              </div>
              <HeroOrbital />
            </div>
            <div
              className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.24em]"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
            >
              Product preview · Reconciliation control plane
            </div>
          </motion.div>

          {/* live ticker */}
          <div className="mx-auto max-w-7xl px-6 pb-24">
            <Ticker />
          </div>
        </section>

        {/* Non-customer positioning strip (real references TBD) */}
        <section className="mx-auto max-w-7xl px-6 pb-16">
          <div
            className="relative overflow-hidden rounded-2xl px-6 py-8 md:px-10 md:py-10"
            style={{
              background: "color-mix(in oklab, var(--brand-coffee-deep) 55%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 22%, transparent)",
              boxShadow: "0 30px 80px -40px rgba(0,0,0,0.6)",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full blur-3xl"
              style={{ background: "color-mix(in oklab, var(--brand-gold) 12%, transparent)" }}
            />
            <div className="relative flex flex-col items-center gap-4 text-center md:flex-row md:justify-between md:text-left">
              <div>
                <div
                  className="text-[11px] font-semibold uppercase tracking-[0.28em]"
                  style={{ color: "color-mix(in oklab, var(--brand-gold) 85%, var(--brand-cream))" }}
                >
                  {pickString(strip, "eyebrow", "Enterprise-grade reconciliation")}
                </div>
                <div
                  className="mt-2 font-display text-lg font-semibold md:text-xl"
                  style={{ color: "var(--brand-cream)" }}
                >
                  {pickString(strip, "headline", "Architected to Tier-1 banking control requirements · Built for enterprise procurement · Intended for regulated financial-services deployments")}
                </div>
                <p
                  className="mt-1 text-[13px]"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}
                >
                  {pickString(strip, "footnote", "Launch partners onboarding. Named customer references published with consent as they go live.")}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {stripTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
                    style={{
                      background: "color-mix(in oklab, var(--ink-void) 70%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)",
                      color: "color-mix(in oklab, var(--brand-cream) 82%, transparent)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============================= METRICS ============================= */}
        <section className="mx-auto max-w-7xl px-6 pb-24">
          <div
            className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl md:grid-cols-4"
            style={{
              background: "color-mix(in oklab, var(--brand-gold) 18%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 20%, transparent)",
              boxShadow: "0 40px 100px -40px rgba(0,0,0,0.6)",
            }}
          >
            {METRICS.map((m, i) => (
              <motion.div
                key={m.k}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
                className="group relative overflow-hidden px-7 py-8"
                style={{ background: "color-mix(in oklab, var(--ink-void) 96%, transparent)" }}
              >
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                  style={{ background: "radial-gradient(300px 160px at 50% 100%, color-mix(in oklab, var(--brand-gold) 15%, transparent), transparent 70%)" }}
                />
                <div className="relative font-display text-4xl font-semibold tracking-tight tabular-nums md:text-5xl" style={{ color: "var(--brand-cream)" }}>
                  <Counter value={m.v} suffix={m.suffix} />
                </div>
                <div className="relative mt-2 text-[11px] font-medium uppercase tracking-[0.22em]" style={{ color: "color-mix(in oklab, var(--brand-gold) 80%, var(--brand-cream))" }}>
                  {m.k}
                </div>
              </motion.div>
            ))}
          </div>
          <p
            className="mx-auto mt-5 max-w-3xl text-center text-[11px] leading-relaxed"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 45%, transparent)" }}
          >
            ¹ Engineered design targets — validated per customer during POC on representative
            data. Not observed production metrics; audited benchmarks will be published as
            launch partners go live.
          </p>
        </section>

        {/* ============================= ROI + BUYER'S GUIDE ============================= */}
        <SectionReveal className="mx-auto max-w-7xl px-6 pb-20">
          <div className="grid gap-6 lg:grid-cols-2">
            <ROITeaserCard />
            <BuyersGuideTeaser />
          </div>
        </SectionReveal>


        {/* ============================= INTERACTIVE DEMO ============================= */}
        <SectionReveal as="div" id="demo">
          <InteractiveReconDemo />
        </SectionReveal>

        {/* ============================= LIFECYCLE FILM ============================= */}
        <SectionReveal as="div" id="lifecycle">
          <LifecycleFilm />
        </SectionReveal>



        {/* ============================= CAPABILITIES ============================= */}
        <section id="capabilities" className="relative mx-auto max-w-7xl px-6 py-28">
          <div className="mb-14 flex flex-col items-center text-center">
            <Kicker>Platform v6 — Agentic Operations</Kicker>
            <h2 className="mt-5 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl" style={{ color: "var(--brand-cream)" }}>
              One platform. <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>Every reconciliation.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}>
              Cash &amp; nostro, securities &amp; trades, intercompany &amp; GL — matched, triaged and
              explained by AI agents under enterprise-grade governance.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CAPS.map(({ icon: Icon, title, sub, badge }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, delay: (i % 4) * 0.08 + Math.floor(i / 4) * 0.04, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -4 }}
                className="group relative overflow-hidden rounded-2xl p-6"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(8,12,22,0.78) 0%, rgba(3,5,8,0.86) 100%)",
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                  boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--brand-gold) 8%, transparent)",
                }}
              >
                {/* corner glow */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-40 blur-3xl transition-opacity duration-700 group-hover:opacity-80"
                  style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--brand-gold) 45%, transparent), transparent)" }}
                />
                {/* scan-line sheen on hover */}
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100"
                  style={{
                    background:
                      "linear-gradient(115deg, transparent 42%, color-mix(in oklab, var(--brand-gold) 22%, transparent) 50%, transparent 58%)",
                  }}
                  initial={false}
                  whileHover={{ x: ["-60%", "60%"] }}
                  transition={{ duration: 1.4, ease: "easeInOut" }}
                />
                {/* gilded top hairline */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-4 top-0 h-px"
                  style={{ background: "linear-gradient(90deg, transparent, color-mix(in oklab, var(--brand-gold) 55%, transparent), transparent)" }}
                />

                {/* badge */}
                {badge && (
                  <div
                    className="absolute right-4 top-4 rounded-full px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.14em]"
                    style={{
                      color: "color-mix(in oklab, var(--brand-gold) 85%, transparent)",
                      background: "color-mix(in oklab, var(--brand-gold) 8%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--brand-gold) 22%, transparent)",
                    }}
                  >
                    {badge}
                  </div>
                )}

                {/* icon well */}
                <div
                  className="relative grid h-11 w-11 place-items-center rounded-xl transition-transform duration-500 group-hover:scale-[1.06]"
                  style={{
                    background:
                      "linear-gradient(140deg, color-mix(in oklab, var(--brand-gold) 18%, transparent), color-mix(in oklab, var(--brand-gold) 6%, transparent))",
                    border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)",
                    boxShadow:
                      "inset 0 1px 0 color-mix(in oklab, var(--brand-gold) 35%, transparent), 0 8px 24px -12px color-mix(in oklab, var(--brand-gold) 40%, transparent)",
                  }}
                >
                  <Icon className="h-[18px] w-[18px]" style={{ color: "var(--brand-gold)" }} />
                </div>

                <h3
                  className="relative mt-5 font-display text-[17px] font-semibold tracking-tight"
                  style={{ color: "var(--brand-cream)" }}
                >
                  {title}
                </h3>
                <p
                  className="relative mt-2 text-[13px] leading-relaxed"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}
                >
                  {sub}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ============================= AGENTIC ============================= */}
        <AgenticShowcase copy={{ kicker: pickString(agentic, "kicker", "Agentic AI · Built for finance"), heading: (agentic?.heading as string | undefined) || undefined, subhead: (agentic?.subhead as string | undefined) || undefined }} />

        {/* ============================= TRUST ============================= */}
        <SectionReveal id="trust" className="mx-auto max-w-7xl px-6 py-32">
          <div className="grid gap-14 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <Kicker>Trust &amp; governance</Kicker>
              <h2 className="mt-5 font-display text-4xl font-medium tracking-tight md:text-6xl" style={{ color: "var(--brand-cream)" }}>
                Enterprise-grade{" "}
                <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>by default.</span>
              </h2>
              <p className="mt-5 max-w-lg text-[15px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}>
                Multi-tenant isolation, hash-chained audit, configurable data residency,
                tamper-proof triggers, and zero-trust auth — on day one.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {["SOC 2", "ISO 27001", "GDPR", "DORA-ready", "Data residency"].map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
                    style={{
                      border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)",
                      background: "color-mix(in oklab, var(--brand-gold) 10%, transparent)",
                      color: "var(--brand-gold)",
                    }}
                  >
                    <ShieldCheck className="h-3 w-3" /> {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Lock,        t: "Zero-trust auth",  d: "TOTP MFA · SSO/SAML · IP allowlist · session policy" },
                { icon: History,     t: "Immutable audit",  d: "SHA-256 hash chain · tamper triggers · cross-scope" },
                { icon: Building2,   t: "Multi-tenant",     d: "Pooled or silo · custom URLs · verified domains" },
                { icon: ShieldAlert, t: "PII redaction",    d: "Pre-LLM masking · BYO-LLM · per-tenant key vault" },
              ].map(({ icon: Icon, t, d }, i) => (
                <motion.div
                  key={t}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                >
                  <Tilt
                    className="rounded-2xl p-6 transition hover:-translate-y-0.5"
                    style={{
                      background: "color-mix(in oklab, var(--brand-coffee-deep) 40%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--brand-gold) 15%, transparent)",
                    }}
                  >
                    <Icon className="h-5 w-5" style={{ color: "var(--brand-gold)" }} />
                    <div className="mt-4 font-display text-lg font-semibold tracking-tight" style={{ color: "var(--brand-cream)" }}>
                      {t}
                    </div>
                    <div className="mt-1.5 text-[13px]" style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}>
                      {d}
                    </div>
                  </Tilt>
                </motion.div>
              ))}
            </div>
          </div>
        </SectionReveal>

        {/* ============================= COMPARISON ============================= */}
        {/* ============================= CAPABILITY TRIO ============================= */}
        <SectionReveal
          className="py-28"
          style={{
            borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 10%, transparent)",
            background:
              "radial-gradient(900px 500px at 80% 20%, color-mix(in oklab, var(--brand-gold) 5%, transparent), transparent 60%)",
          }}
        >
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-14 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <Kicker>The ReconIQ doctrine</Kicker>
                <h2 className="mt-5 max-w-2xl font-display text-4xl font-medium tracking-tight md:text-6xl" style={{ color: "var(--brand-cream)" }}>
                  Three disciplines.{" "}
                  <span className="italic" style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
                    One source of truth.
                  </span>
                </h2>
              </div>
              <p className="max-w-md text-[15px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}>
                Every reconciliation on ReconIQ is shaped by three doctrines — each a precision instrument, together a complete intelligence system.
              </p>
            </div>
            <CapabilityTrio />
          </div>
        </SectionReveal>

        


        {/* ============================= ARCHITECTURE ============================= */}

        <SectionReveal
          id="architecture"
          className="py-32"
          style={{
            borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
            background:
              "radial-gradient(700px 400px at 20% 30%, color-mix(in oklab, var(--brand-gold) 6%, transparent), transparent 60%)",
          }}
        >
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-14 flex flex-col items-center text-center">
              <Kicker>Architecture</Kicker>
              <h2 className="mt-5 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl" style={{ color: "var(--brand-cream)" }}>
                Built for scale.{" "}
                <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
                  Designed for clarity.
                </span>
              </h2>
            </div>
            <div className="mb-10">
              <ArchitectureBands />
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {[
                { icon: Database,  t: "Ingestion Hub",         d: "12 connectors — SFTP, S3, Azure, Snowflake, BigQuery, Kafka, API, webhooks." },
                { icon: Zap,       t: "Near-real-time matching", d: "Streaming engine with watermarking and exactly-once semantics." },
                { icon: GitBranch, t: "Dev → UAT → Prod",      d: "Sign and promote reconciliation packages with four-eyes and one-click rollback." },
              ].map(({ icon: Icon, t, d }, i) => (
                <motion.div
                  key={t}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.6, delay: i * 0.1 }}
                >
                  <Tilt
                    className="rounded-2xl p-7"
                    style={{
                      background: "linear-gradient(180deg, rgba(8,12,22,0.92), rgba(3,5,8,0.96))",
                      border: "1px solid color-mix(in oklab, var(--fvi-gold, #c9a24b) 18%, transparent)",
                      boxShadow: "0 30px 80px -40px rgba(0,0,0,0.75)",
                    }}
                  >
                    <Icon className="h-6 w-6" style={{ color: "var(--brand-gold)" }} />
                    <h3 className="mt-5 font-display text-xl font-semibold tracking-tight" style={{ color: "var(--brand-cream)" }}>
                      {t}
                    </h3>
                    <p className="mt-2.5 text-[14px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}>
                      {d}
                    </p>
                  </Tilt>
                </motion.div>
              ))}
            </div>
          </div>
        </SectionReveal>

        <TenXPromise />
        <RegulatoryAlignment />
        <TenantIsolationModel />
        <ProcurementFit />
        <FAQ />


        <TalkToFalconSection copy={{ heading: (talk?.heading as string | undefined) || undefined, subhead: (talk?.subhead as string | undefined) || undefined, prompts: talkPrompts.length > 0 ? talkPrompts : undefined }} />

        {/* ============================= CTA ============================= */}
        <section className="mx-auto max-w-5xl px-6 py-32 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9 }}
            className="relative overflow-hidden rounded-[2rem] p-16"
            style={{
              background:
                "radial-gradient(ellipse 70% 90% at 50% 0%, color-mix(in oklab, var(--brand-gold) 22%, transparent), transparent 60%)," +
                "color-mix(in oklab, var(--brand-coffee-deep) 60%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)",
              boxShadow: "0 60px 160px -60px color-mix(in oklab, var(--brand-gold) 40%, transparent)",
            }}
          >
            {!reduce && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "conic-gradient(from 0deg at 50% 50%, transparent 0deg, color-mix(in oklab, var(--brand-gold) 22%, transparent) 40deg, transparent 100deg, transparent 360deg)",
                  filter: "blur(40px)",
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
              />
            )}
            <FviApprovedLogo className="relative mx-auto h-16 w-16" />
            <h2 className="relative mt-8 font-display text-4xl font-medium tracking-tight md:text-6xl" style={{ color: "var(--brand-cream)" }}>
              Stop reconciling. Start{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: "linear-gradient(120deg, var(--brand-gold), #f3d78a, var(--brand-gold))",
                }}
              >
                verifying.
              </span>
            </h2>
            <p className="relative mx-auto mt-5 max-w-xl text-[15px] leading-relaxed md:text-base" style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}>
              Launch your tenant in minutes. Bring your data, your LLM, your rules —
              keep your sovereignty and your certainty.
            </p>
            <div className="relative mt-10 flex flex-wrap justify-center gap-3">
              <Link
                to="/book-demo"
                className="group inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold transition hover:brightness-110"
                style={{
                  background: "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 75%, black))",
                  color: "var(--ink-void)",
                  boxShadow: "0 24px 60px -20px color-mix(in oklab, var(--brand-gold) 55%, transparent), inset 0 1px 0 rgba(255,255,255,0.35)",
                }}
              >
                Book a 30-min demo <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold transition hover:bg-[color:color-mix(in_oklab,var(--brand-cream)_8%,transparent)]"
                style={{
                  border: "1px solid color-mix(in oklab, var(--brand-cream) 22%, transparent)",
                  color: "var(--brand-cream)",
                }}
              >
                Talk to sales
              </Link>
              <a
                href={appUrl("/auth")}
                className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold transition hover:bg-[color:color-mix(in_oklab,var(--brand-gold)_8%,transparent)]"
                style={{ color: "var(--brand-gold)", border: "1px solid color-mix(in oklab, var(--brand-gold) 25%, transparent)" }}
              >
                <Cpu className="h-4 w-4" /> Launch sandbox
              </a>
            </div>
          </motion.div>
        </section>
      </main>

      {/* Global disclaimer & footnote index */}
      <section
        id="disclosures"
        aria-labelledby="disclosures-heading"
        className="relative z-10 mx-auto max-w-5xl px-6 py-16"
      >
        <div
          className="rounded-2xl p-6 md:p-8"
          style={{
            background: "color-mix(in oklab, var(--brand-coffee-deep) 45%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 16%, transparent)",
          }}
        >
          <p
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em]"
            style={{ color: "var(--brand-gold)" }}
          >
            Disclosures &amp; footnotes
          </p>
          <h2
            id="disclosures-heading"
            className="mt-3 font-display text-2xl font-medium tracking-tight md:text-3xl"
            style={{ color: "var(--brand-cream)" }}
          >
            How to read the numbers on this page
          </h2>
          <p
            className="mt-3 text-sm leading-relaxed"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}
          >
            ReconIQ is preparing to onboard its first design partners.
            Performance figures, match rates, throughput numbers, latency targets and ROI
            outcomes shown on this site are <strong style={{ color: "var(--brand-cream)" }}>engineering
            targets and reference benchmarks</strong> derived from internal testing,
            representative synthetic datasets and public industry sources — not audited
            production results from a live Tier-1 customer. Actual outcomes will vary by
            data quality, feed volume, reconciliation complexity, configuration and operating
            model. Nothing on this page constitutes a service-level commitment; commercial
            SLAs are defined in the order form and MSA. ReconIQ does not currently hold SOC 2 Type
            II, ISO 27001 or PCI DSS certifications; claims of alignment describe controls
            architected to those standards and testable in-product today. See the{" "}
            <Link
              to="/security"
              className="underline underline-offset-2"
              style={{ color: "var(--brand-gold)" }}
            >
              Security &amp; Compliance
            </Link>{" "}
            page for the full scope of what is enabled versus formally certified.
          </p>

          <ol
            className="mt-6 space-y-3 text-xs leading-relaxed"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}
          >
            {[
              {
                n: 1,
                label: "Match-rate range (95–99%)",
                body:
                  "Composite target range across cash, custodian and GL-to-subledger reconciliations on cleansed, representative datasets. Real-world results depend on feed quality and mapping maturity. Source: internal testing · TBD customer benchmark.",
              },
              {
                n: 2,
                label: "Throughput & latency figures",
                body:
                  "Engineering targets measured on reference hardware in a single home region with representative volumes. Not a contractual SLA. Source: internal load tests · TBD third-party benchmark.",
              },
              {
                n: 3,
                label: "ROI estimator outputs",
                body:
                  "Illustrative projections based on user-supplied inputs and industry cost-of-break benchmarks. Not a guarantee of savings. Sources: user inputs · public industry reports (to be cited on the ROI page).",
              },
              {
                n: 4,
                label: "Onboarding pathway (30–60 days)",
                body:
                  "Represents a single in-scope reconciliation with a responsive client working group. Additional entities, products or regions extend the pathway proportionally.",
              },
              {
                n: 5,
                label: "RPO ≤ 15 min · RTO ≤ 2 h",
                body:
                  "Target disaster-recovery objectives for SaaS multi-tenant deployments; VPC / Private Cloud objectives are configurable to the customer's DR standard.",
              },
              {
                n: 6,
                label: "Regulatory alignment (DORA, BCBS 239, SR 11-7, MAS TRM, APRA CPS 234, SOX, SEC 17a-4)",
                body:
                  "Product architected with reference to these frameworks. Alignment is not certification and does not constitute a legal opinion on the customer's own compliance posture.",
              },
              {
                n: 7,
                label: "Tier-1 language",
                body:
                  "\"Tier-1\" describes the standards ReconIQ is architected to meet and the buyer profile ReconIQ is designed for. It does not imply a current Tier-1 production reference. Named references will be listed here when contractually permitted.",
              },
            ].map(({ n, label, body }) => (
              <li key={n} className="flex gap-3">
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold"
                  style={{
                    background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--brand-gold) 32%, transparent)",
                    color: "var(--brand-gold)",
                  }}
                  aria-hidden
                >
                  {n}
                </span>
                <span>
                  <span className="font-semibold" style={{ color: "var(--brand-cream)" }}>
                    {label}.
                  </span>{" "}
                  {body}
                </span>
              </li>
            ))}
          </ol>

          <p
            className="mt-6 text-[11px]"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 52%, transparent)" }}
          >
            Placeholder for sources — third-party benchmark citations, customer case studies
            and audit attestations will be inserted here as they are published and cleared
            for public disclosure. Corrections: <span style={{ color: "var(--brand-cream)" }}>disclosures@reconiq.example</span>.
          </p>
        </div>
      </section>

      <footer
        className="relative z-10"
        style={{ borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)" }}
      >
        {/* Newsletter + ReconIQ Copilot strip */}
        <FooterNewsletterStrip />
        <div
          className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 text-[12px] md:flex-row"
          style={{
            color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)",
            borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 8%, transparent)",
          }}
        >
          <div className="flex items-center gap-3">
            <FviApprovedLogo className="h-7 w-7" />
            <span>© ReconIQ</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/security"
              className="tracking-[0.12em] underline-offset-4 hover:underline"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}
              title="Security & Compliance overview"
            >
              SOC 2 · ISO 27001 · GDPR · DORA-ready · Configurable data residency
            </Link>

            <SiteAdminFooterLink />

            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("dr-falcon:open"))}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition hover:brightness-110"
              style={{
                background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)",
                color: "var(--brand-gold)",
              }}
            >
              <Sparkles className="h-3 w-3" /> Ask ReconIQ Copilot
            </button>
          </div>

        </div>
        <div
          className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-6 pb-6 text-[11px] tracking-[0.14em] uppercase"
          style={{ color: "color-mix(in oklab, var(--brand-gold) 78%, transparent)" }}
        >
          <Feather className="h-3 w-3" aria-hidden />
          <span>Designed and Architected by</span>
          <span style={{ color: "var(--brand-gold)", fontWeight: 600 }}>
            ReconIQ Team
          </span>

        </div>
      </footer>

      {/* Optional inline admin console — only renders for authenticated sessions */}
      <InlineAdminConsole />
    </div>
  );
}
