import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calculator, ArrowRight, Info, Sliders, Share2, Send, ChevronDown, ChevronUp,
  BarChart3, Clock, DollarSign, TrendingUp, Users, ShieldCheck,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import {
  computeRoi, fmtHrs, fmtMonths, fmtPct, fmtUsd, inputsFromQuery, inputsToQuery,
  ROI_DEFAULTS, type RoiInputs,
} from "@/lib/roi-model";
import { ROI_BENCHMARKS as B, ROI_SOURCES } from "@/lib/roi-benchmarks";
import { BackButton } from "@/components/back-button";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { parsePublicLeadResponse, publicLeadEndpoint } from "@/lib/public-lead-client";

export const Route = createFileRoute("/roi")({
  component: RoiPage,
  head: () => ({
    meta: [
      { title: "Reconciliation ROI Estimator — ReconIQ" },
      {
        name: "description",
        content:
          "Model the annual savings, freed FTE capacity, and payback period of moving your reconciliation workflow to ReconIQ. Indicative benchmarks — validated with your data during a working session.",
      },
      { property: "og:title", content: "ReconIQ Reconciliation ROI Estimator" },
      {
        property: "og:description",
        content:
          "Interactive, benchmark-anchored ROI model for reconciliation modernisation. Every constant editable, every source cited.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/roi" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/roi" }],
  }),
});

/* ------------------------------------------------------------------ */

const CARD_BG = "#161617";
const CARD_BORDER = "1px solid rgba(255,255,255,0.1)";
const TILE_BG = "#1c1c1f";
const TILE_BORDER = "1px solid rgba(255,255,255,0.1)";

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
      {children}
    </div>
  );
}

function LabelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
        {label}
      </span>
      <span className="font-display text-sm tabular-nums text-[#f5f5f7]">
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function RoiPage() {
  const [inp, setInp] = useState<RoiInputs>(ROI_DEFAULTS);
  const [tab, setTab] = useState<"simple" | "advanced">("simple");
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [copied, setCopied] = useState(false);

  // Hydrate from URL on mount (client only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.search) setInp(inputsFromQuery(window.location.search));
  }, []);

  const out = useMemo(() => computeRoi(inp), [inp]);

  const set = <K extends keyof RoiInputs>(k: K, v: RoiInputs[K]) =>
    setInp((s) => ({ ...s, [k]: v }));

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/roi?${inputsToQuery(inp)}`;
  }, [inp]);

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  // Sensitivity: sweep ReconIQ auto-match from currentAutoMatchPct → 0.99
  const sensitivity = useMemo(() => {
    const start = Math.max(inp.currentAutoMatchPct, 0.6);
    const points = 24;
    const rows: Array<{ match: number; savings: number }> = [];
    for (let i = 0; i <= points; i++) {
      const m = start + ((0.995 - start) * i) / points;
      const scenarioInp: RoiInputs = { ...inp, fviAutoMatchLow: m, fviAutoMatchHigh: m };
      const scen = computeRoi(scenarioInp).mid;
      rows.push({ match: Math.round(m * 1000) / 10, savings: Math.round(scen.totalSavingsYr) });
    }
    return rows;
  }, [inp]);

  return (
    <div className="relative min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />

      <div className="relative mx-auto max-w-[1200px] px-6 pt-16 pb-24 md:px-10">
        <div className="mb-6"><BackButton fallbackTo="/" label="Back to home" /></div>
        {/* Hero */}
        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-10"
        >
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5">
              <Calculator className="h-5 w-5 text-[#2997ff]" />
            </div>
            <Kicker>ROI Estimator · v1</Kicker>
          </div>

          <h1 className="font-display text-4xl font-medium leading-[1.05] tracking-tight text-[#f5f5f7] md:text-6xl">
            Model your reconciliation ROI.
          </h1>
          <p className="mt-4 max-w-[720px] text-[15px] leading-relaxed text-[#a1a1a6] md:text-base">
            A defensible, benchmark-anchored model of the labour, audit, and incident savings from
            moving reconciliation to ReconIQ. Every constant is editable, every
            source cited. Outputs are <strong>indicative</strong> — we validate them on your data
            during a working session.
          </p>
        </motion.header>

        {/* Tabs */}
        <div className="mb-6 flex items-center gap-2">
          {(["simple", "advanced"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] transition ${
                tab === t
                  ? "bg-white text-black"
                  : "border border-white/15 text-[#a1a1a6] hover:bg-white/10 hover:text-white"
              }`}
            >
              {t === "simple" ? "Simple · 4 inputs" : "Advanced · full model"}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setInp(ROI_DEFAULTS)}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#a1a1a6] transition hover:bg-white/10 hover:text-white"
            >
              Reset defaults
            </button>
            <button
              onClick={copyShare}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f5f5f7] transition hover:bg-white/10"
            >
              <Share2 className="h-3.5 w-3.5" />
              {copied ? "Link copied" : "Share model"}
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Inputs */}
          <div
            className="relative overflow-hidden rounded-3xl p-6 md:p-8 lg:col-span-2"
            style={{ background: CARD_BG, border: CARD_BORDER }}
          >
            <div className="mb-5 flex items-center gap-2">
              <Sliders className="h-4 w-4 text-[#2997ff]" />
              <Kicker>Inputs</Kicker>
            </div>

            <div className="grid gap-5">
              <Slider
                label="Reconciliation FTEs"
                value={inp.fteCount}
                min={1} max={100} step={1}
                display={String(inp.fteCount)}
                onChange={(v) => set("fteCount", v)}
              />
              <Slider
                label="Monthly transaction volume"
                value={inp.monthlyTxnVolume}
                min={5_000} max={20_000_000} step={5_000}
                display={inp.monthlyTxnVolume.toLocaleString()}
                onChange={(v) => set("monthlyTxnVolume", v)}
              />
              <Slider
                label="Current auto-match rate"
                value={inp.currentAutoMatchPct * 100}
                min={40} max={98} step={1}
                display={fmtPct(inp.currentAutoMatchPct, 0)}
                onChange={(v) => set("currentAutoMatchPct", v / 100)}
              />
              <Slider
                label="Transaction break rate"
                value={inp.breakRate * 100}
                min={0.1} max={8} step={0.1}
                display={`${(inp.breakRate * 100).toFixed(1)}%`}
                onChange={(v) => set("breakRate", v / 100)}
              />

              {tab === "advanced" && (
                <>
                  <div className="my-2 h-px bg-white/10" />
                  <Slider
                    label="Fully-loaded FTE cost / yr"
                    value={inp.fteFullyLoadedUsd}
                    min={60_000} max={300_000} step={5_000}
                    display={fmtUsd(inp.fteFullyLoadedUsd)}
                    onChange={(v) => set("fteFullyLoadedUsd", v)}
                  />
                  <Slider
                    label="Avg break resolution (min)"
                    value={inp.breakResolveMinutes}
                    min={2} max={60} step={1}
                    display={`${inp.breakResolveMinutes} min`}
                    onChange={(v) => set("breakResolveMinutes", v)}
                  />
                  <Slider
                    label="Audit prep hrs / yr"
                    value={inp.auditPrepHoursPerYear}
                    min={0} max={2_000} step={20}
                    display={`${inp.auditPrepHoursPerYear.toLocaleString()} hrs`}
                    onChange={(v) => set("auditPrepHoursPerYear", v)}
                  />
                  <Slider
                    label="Late-close incidents avoided / yr"
                    value={inp.lateCloseIncidentsAvoidedPerYear}
                    min={0} max={10} step={1}
                    display={String(inp.lateCloseIncidentsAvoidedPerYear)}
                    onChange={(v) => set("lateCloseIncidentsAvoidedPerYear", v)}
                  />
                  <Slider
                    label="Cost per late-close incident"
                    value={inp.lateCloseIncidentUsd}
                    min={0} max={500_000} step={5_000}
                    display={fmtUsd(inp.lateCloseIncidentUsd)}
                    onChange={(v) => set("lateCloseIncidentUsd", v)}
                  />
                  <Slider
                    label="Indicative platform cost / yr"
                    value={inp.annualPlatformCostUsd}
                    min={60_000} max={1_500_000} step={10_000}
                    display={fmtUsd(inp.annualPlatformCostUsd)}
                    onChange={(v) => set("annualPlatformCostUsd", v)}
                  />
                  <RangeSlider
                    label="ReconIQ target auto-match range"
                    low={inp.fviAutoMatchLow * 100}
                    high={inp.fviAutoMatchHigh * 100}
                    min={80} max={99} step={1}
                    onChange={(lo, hi) => setInp((s) => ({ ...s, fviAutoMatchLow: lo / 100, fviAutoMatchHigh: hi / 100 }))}
                  />
                </>
              )}
            </div>

            <p className="mt-6 text-[11px] text-[#86868b]">
              Defaults from public industry benchmarks — see the Assumptions panel below.
            </p>
          </div>

          {/* Outputs */}
          <div className="grid gap-6 lg:col-span-3">
            {/* Headline tiles */}
            <div
              className="relative overflow-hidden rounded-3xl p-6 md:p-8"
              style={{ background: CARD_BG, border: CARD_BORDER }}
            >
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#2997ff]" />
                <Kicker>Estimated annual impact · range</Kicker>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Tile
                  icon={<DollarSign className="h-4 w-4" />}
                  label="Total savings / yr"
                  primary={fmtUsd(out.mid.totalSavingsYr)}
                  range={`${fmtUsd(out.low.totalSavingsYr)} – ${fmtUsd(out.high.totalSavingsYr)}`}
                />
                <Tile
                  icon={<Clock className="h-4 w-4" />}
                  label="Analyst hours freed / yr"
                  primary={fmtHrs(out.mid.totalHoursSavedYr)}
                  range={`${fmtHrs(out.low.totalHoursSavedYr)} – ${fmtHrs(out.high.totalHoursSavedYr)} hrs`}
                />
                <Tile
                  icon={<Users className="h-4 w-4" />}
                  label="FTE equivalent freed"
                  primary={out.mid.fteEquivalentFreed.toFixed(1)}
                  range={`${out.low.fteEquivalentFreed.toFixed(1)} – ${out.high.fteEquivalentFreed.toFixed(1)} FTE`}
                />
                <Tile
                  icon={<Calculator className="h-4 w-4" />}
                  label="Payback period"
                  primary={fmtMonths(out.mid.paybackMonths)}
                  range={`${fmtMonths(out.high.paybackMonths)} – ${fmtMonths(out.low.paybackMonths)}`}
                />
                <Tile
                  icon={<BarChart3 className="h-4 w-4" />}
                  label="ROI multiple (yr 1)"
                  primary={`${out.mid.roiMultiple.toFixed(1)}×`}
                  range={`${out.low.roiMultiple.toFixed(1)}× – ${out.high.roiMultiple.toFixed(1)}×`}
                />
                <Tile
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Net savings yr 1"
                  primary={fmtUsd(out.mid.netSavingsYr)}
                  range={`${fmtUsd(out.low.netSavingsYr)} – ${fmtUsd(out.high.netSavingsYr)}`}
                />
              </div>

              <div className="mt-6 grid gap-2 md:grid-cols-2">
                <LabelRow label="Matching hours saved / yr" value={fmtHrs(out.mid.matchHoursSavedYr)} />
                <LabelRow label="Break-triage hours saved / yr" value={fmtHrs(out.mid.breakHoursSavedYr)} />
                <LabelRow label="Audit prep hours saved / yr" value={fmtHrs(out.mid.auditHoursSavedYr)} />
                <LabelRow label="Incident savings / yr" value={fmtUsd(out.mid.incidentSavingsYr)} />
              </div>

              <p className="mt-5 text-[11px] leading-relaxed text-[#86868b]">
                * Indicative. Ranges reflect ReconIQ target auto-match {(inp.fviAutoMatchLow * 100).toFixed(0)}%
                – {(inp.fviAutoMatchHigh * 100).toFixed(0)}%. Actual performance is validated on your data during a POC.
              </p>
            </div>

            {/* Sensitivity */}
            <div
              className="relative overflow-hidden rounded-3xl p-6 md:p-8"
              style={{ background: CARD_BG, border: CARD_BORDER }}
            >
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#2997ff]" />
                <Kicker>Sensitivity · savings vs ReconIQ auto-match %</Kicker>
              </div>
              <div className="h-[240px] w-full">
                <ResponsiveContainer>
                  <AreaChart data={sensitivity} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gAccent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2997ff" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#2997ff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis
                      dataKey="match"
                      tick={{ fill: "#86868b", fontSize: 11 }}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <YAxis
                      tick={{ fill: "#86868b", fontSize: 11 }}
                      tickFormatter={(v: number) => `$${(v / 1_000_000).toFixed(1)}M`}
                    />
                    <RTooltip
                      contentStyle={{
                        background: "#161617",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 12,
                        color: "#f5f5f7",
                      }}
                      formatter={(v: number) => [fmtUsd(v), "Total savings / yr"]}
                      labelFormatter={(v: number) => `ReconIQ match ${v}%`}
                    />
                    <Area
                      type="monotone"
                      dataKey="savings"
                      stroke="#2997ff"
                      strokeWidth={2}
                      fill="url(#gAccent)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-[11px] text-[#86868b]">
                Every 1% lift in auto-match rate compounds against your annual transaction volume.
              </p>
            </div>
          </div>
        </div>

        {/* Assumptions */}
        <div
          className="mt-8 overflow-hidden rounded-3xl"
          style={{ background: CARD_BG, border: CARD_BORDER }}
        >
          <button
            onClick={() => setShowAssumptions((s) => !s)}
            className="flex w-full items-center justify-between p-6 md:p-8"
          >
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-[#2997ff]" />
              <Kicker>Assumptions & sources</Kicker>
            </div>
            {showAssumptions ? (
              <ChevronUp className="h-4 w-4 text-[#f5f5f7]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#f5f5f7]" />
            )}
          </button>
          {showAssumptions && (
            <div className="border-t border-white/10 px-6 pb-8 md:px-8">
              <ul className="mt-5 grid gap-3 md:grid-cols-2">
                {ROI_SOURCES.map((s) => (
                  <li key={s.label} className="rounded-xl p-4" style={{ background: TILE_BG, border: TILE_BORDER }}>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
                      {s.label}
                    </div>
                    <div className="mt-1 text-[13px] leading-relaxed text-[#a1a1a6]">
                      {s.source}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[12px] leading-relaxed text-[#a1a1a6]">
                ReconIQ target auto-match ({(B.fviAutoMatchPct.low * 100).toFixed(0)}–{(B.fviAutoMatchPct.high * 100).toFixed(0)}%) is a design target validated during POC on your data.
                ReconIQ does not publish production customer metrics; all figures on this page are model outputs, not observed benchmarks.
              </p>
            </div>
          )}
        </div>

        {/* Lead capture */}
        <TailoredCta inputs={inp} outputsSummary={{
          mid: out.mid, low: out.low, high: out.high,
        }} />

        {/* Trust footer */}
        <p className="mt-10 text-center text-[11px] leading-relaxed text-[#86868b]">
          Indicative model only — figures are estimates from the inputs and benchmarks above,
          not observed customer results. ReconIQ does not hold SOC 2 or ISO 27001 certification;
          controls are designed with reference to those frameworks.
        </p>
      </div>
      <MarketingFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function Tile({
  icon, label, primary, range,
}: {
  icon: React.ReactNode; label: string; primary: string; range: string;
}) {
  return (
    <div className="rounded-2xl p-4" style={{ background: TILE_BG, border: TILE_BORDER }}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
        <span className="text-[#2997ff]">{icon}</span>
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-medium tabular-nums text-[#f5f5f7]">
        {primary}
      </div>
      <div className="text-[11px] tabular-nums text-[#86868b]">
        {range}
      </div>
    </div>
  );
}

function Slider({
  label, value, min, max, step, display, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
          {label}
        </span>
        <span className="font-display text-sm tabular-nums text-[#f5f5f7]">{display}</span>
      </label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#2997ff]"
      />
    </div>
  );
}

function RangeSlider({
  label, low, high, min, max, step, onChange,
}: {
  label: string; low: number; high: number; min: number; max: number; step: number;
  onChange: (low: number, high: number) => void;
}) {
  return (
    <div>
      <label className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
          {label}
        </span>
        <span className="font-display text-sm tabular-nums text-[#f5f5f7]">{low.toFixed(0)}% – {high.toFixed(0)}%</span>
      </label>
      <div className="grid gap-2">
        <input
          type="range" min={min} max={max} step={step} value={low}
          aria-label={`${label} lower bound`}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange(Math.min(v, high), high);
          }}
          className="w-full accent-[#2997ff]"
        />
        <input
          type="range" min={min} max={max} step={step} value={high}
          aria-label={`${label} upper bound`}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange(low, Math.max(v, low));
          }}
          className="w-full accent-[#2997ff]"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tailored CTA — lead capture                                         */
/* ------------------------------------------------------------------ */

interface RoiScenarioLite {
  totalSavingsYr: number;
  totalHoursSavedYr: number;
  fteEquivalentFreed: number;
  paybackMonths: number;
  roiMultiple: number;
}

function TailoredCta({
  inputs, outputsSummary,
}: {
  inputs: RoiInputs;
  outputsSummary: { mid: RoiScenarioLite; low: RoiScenarioLite; high: RoiScenarioLite };
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!consent) { setErr("Please confirm consent to continue."); return; }
    setBusy(true);
    try {
      const message = [
        "ROI Estimator submission",
        `Inputs: ${inputs.fteCount} FTE, ${inputs.monthlyTxnVolume.toLocaleString()} txns/mo, current match ${fmtPct(inputs.currentAutoMatchPct, 0)}, break rate ${fmtPct(inputs.breakRate)}`,
        `Outputs (mid): ${fmtUsd(outputsSummary.mid.totalSavingsYr)}/yr savings · ${fmtHrs(outputsSummary.mid.totalHoursSavedYr)} hrs freed · ${outputsSummary.mid.fteEquivalentFreed.toFixed(1)} FTE · payback ${fmtMonths(outputsSummary.mid.paybackMonths)} · ROI ${outputsSummary.mid.roiMultiple.toFixed(1)}×`,
        `Range: ${fmtUsd(outputsSummary.low.totalSavingsYr)} – ${fmtUsd(outputsSummary.high.totalSavingsYr)}/yr`,
      ].join("\n");

      const res = await fetch(publicLeadEndpoint(window.location.origin, import.meta.env.VITE_FVI_APP_API_ORIGIN), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: firstName, last_name: lastName, email,
          company, job_title: jobTitle,
          purpose: "ROI estimator: request a tailored reconciliation business case.",
          areas_of_interest: ["Reconciliation", "AI Automation"],
          message,
          consent: true,
          source: "other",
          utm: { utm_source: "roi_estimator", utm_medium: "website", utm_campaign: "roi_estimator" },
        }),
      });
      await parsePublicLeadResponse(res);
      setOk(true);
    } catch {
      setErr("Something Didn't Go As Planned — we couldn't send your model just now. Please check your connection and try again in a few moments.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-8 grid gap-6 overflow-hidden rounded-3xl p-6 md:p-10 lg:grid-cols-2"
      style={{ background: CARD_BG, border: CARD_BORDER }}
    >
      <div>
        <Kicker>Take it further</Kicker>
        <h2 className="mt-3 font-display text-2xl font-medium tracking-tight text-[#f5f5f7] md:text-3xl">
          Get a tailored business case with your data.
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[#a1a1a6]">
          Our solutions team will validate every constant against a representative slice of your
          reconciliation workload and return a model you can review with your finance and audit teams.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/book-demo"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
          >
            Book a working session <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-[#f5f5f7] transition hover:bg-white/10"
          >
            Talk to sales
          </Link>
        </div>
      </div>

      {ok ? (
        <div
          className="grid place-items-center rounded-2xl p-8 text-center"
          style={{ background: TILE_BG, border: TILE_BORDER }}
        >
          <div>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/5">
              <Send className="h-5 w-5 text-[#2997ff]" />
            </div>
            <div className="font-display text-lg font-medium text-[#f5f5f7]">Model sent.</div>
            <p className="mt-2 text-[13px] leading-relaxed text-[#a1a1a6]">
              Thanks — we&apos;ll be in touch by email.
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3 rounded-2xl p-5" style={{ background: TILE_BG, border: TILE_BORDER }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" value={firstName} onChange={setFirstName} required />
            <Field label="Last name" value={lastName} onChange={setLastName} required />
          </div>
          <Field label="Work email" type="email" value={email} onChange={setEmail} required />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company" value={company} onChange={setCompany} required />
            <Field label="Job title" value={jobTitle} onChange={setJobTitle} />
          </div>
          <label className="mt-1 flex items-start gap-2 text-[12px] leading-relaxed text-[#a1a1a6]">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[#2997ff]" />
            I agree ReconIQ may contact me about this ROI model.
          </label>
          {err && <p className="text-[12px] leading-relaxed text-red-400">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Email me this model"} <Send className="h-4 w-4" />
          </button>
        </form>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", required,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
        {label}{required && " *"}
      </span>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required}
        className="w-full rounded-lg border border-white/10 bg-[#0b0b0f] px-3 py-2 text-sm text-[#f5f5f7] outline-none transition placeholder:text-[#86868b] focus:border-white/25"
      />
    </label>
  );
}
