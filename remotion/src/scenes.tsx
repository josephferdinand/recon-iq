import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, interpolate, spring } from "remotion";
import { C, FVMonogram, Wordmark, Tagline, playfair, inter } from "./brand";

type Variant = "cinematic" | "kinetic";

const FPS = 30;
const DUR = 2760;

/**
 * Voice-locked storyboard v4 — high-density motion.
 * Audio is untouched. Beat boundaries preserved from v3.
 * Every scene now runs additional micro-motion (sub-events, sweep lines,
 * counters, cursor pings) evenly spread across its full duration so the
 * viewer perceives continuous movement tracking Adam's cadence.
 */
const STORYBOARD = [
  { id: "brand", from: 0, dur: 78, label: "ReconIQ" },
  { id: "recon", from: 78, dur: 41, label: "Reconciliation" },
  { id: "native", from: 119, dur: 202, label: "AI-native reconciliation" },
  { id: "breaks", from: 321, dur: 84, label: "Break pressure" },
  { id: "agents", from: 405, dur: 169, label: "Agentic operating model" },
  { id: "coverage", from: 574, dur: 235, label: "One-sided · Two-sided · Tri-party" },
  { id: "copilot", from: 809, dur: 245, label: "Copilot investigation" },
  { id: "answer", from: 1054, dur: 150, label: "Grounded answers" },
  { id: "fourEyes", from: 1204, dur: 229, label: "Four-eyes review" },
  { id: "ingest", from: 1433, dur: 230, label: "Ingestion" },
  { id: "matching", from: 1663, dur: 203, label: "Matching engine" },
  { id: "resolution", from: 1866, dur: 149, label: "Auto-resolution" },
  { id: "trust", from: 2015, dur: 323, label: "Trust & governance" },
  { id: "env", from: 2338, dur: 181, label: "Deployment controls" },
  { id: "close", from: 2519, dur: 241, label: "ReconIQ" },
] as const;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const q = (f: number, start: number, length = 8) => interpolate(f, [start, start + length], [0, 1], clamp);
const rise = (f: number, start: number, distance = 24, length = 8) => interpolate(f, [start, start + length], [distance, 0], clamp);
const fadeLast = (f: number, dur: number) => interpolate(f, [Math.max(0, dur - 12), dur], [1, 0], clamp);

/** Evenly distribute stagger start across a scene's live area. Compressed head lets visuals land on the clause. */
const spread = (i: number, count: number, dur: number, head = 1, tail = 14) => {
  const usable = Math.max(1, dur - head - tail);
  return head + (i * usable) / Math.max(1, count);
};

/** Continuously-moving cursor tick — creates motion even when static text is on-screen. */
const SweepLine: React.FC<{ f: number; dur: number; y?: number; color?: string }> = ({ f, dur, y = 78, color = C.gold }) => {
  const x = interpolate(f, [0, dur], [-6, 106], clamp);
  return <div style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: 2, height: 40, background: color, boxShadow: `0 0 18px ${color}`, opacity: 0.55 }} />;
};

/** Small pulsing frame counter chip in the corner — moves every frame. */
const LiveTicker: React.FC<{ f: number; dur: number; label: string }> = ({ f, dur, label }) => {
  const pct = Math.min(100, Math.max(0, (f / dur) * 100));
  return (
    <div style={{ position: "absolute", bottom: 42, right: 62, display: "flex", alignItems: "center", gap: 12, fontFamily: inter.fontFamily, color: C.mute, fontSize: 12, letterSpacing: 3, textTransform: "uppercase" }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: C.gold, opacity: (f % 30) < 15 ? 1 : 0.35 }} />
      <span>{label}</span>
      <span style={{ width: 90, height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${pct}%`, height: "100%", background: C.gold }} />
      </span>
    </div>
  );
};

const BgBase: React.FC<{ variant: Variant }> = ({ variant }) => {
  const f = useCurrentFrame();
  const speed = variant === "kinetic" ? 1.75 : 1.25;
  const drift = Math.sin(f / (110 / speed)) * (variant === "kinetic" ? 22 : 14);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 800px at ${50 + drift}% ${32 + drift / 3}%, ${C.navy2} 0%, ${C.navy} 42%, ${C.ink} 100%)` }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 118%, rgba(201,164,76,0.16) 0%, transparent 56%)" }} />
      <AbsoluteFill style={{ opacity: variant === "kinetic" ? 0.58 : 0.34 }}>
        {Array.from({ length: variant === "kinetic" ? 18 : 12 }).map((_, i) => (
          <div key={i} style={{
            position: "absolute", top: 0, bottom: 0, left: `${(i * 100) / (variant === "kinetic" ? 18 : 12)}%`, width: 1,
            background: "linear-gradient(180deg, transparent, rgba(201,164,76,0.08) 38%, rgba(201,164,76,0.05) 62%, transparent)",
            transform: `translateX(${Math.sin((f + i * 19) / (variant === "kinetic" ? 24 : 46)) * (variant === "kinetic" ? 34 : 18)}px)`,
          }} />
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2'/><feColorMatrix values='0 0 0 0 0.85 0 0 0 0 0.75 0 0 0 0 0.5 0 0 0 0.06 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")", opacity: 0.42, mixBlendMode: "overlay" }} />
    </AbsoluteFill>
  );
};

const SceneShell: React.FC<{ label: string; children: React.ReactNode; ticker?: string; f?: number; dur?: number }> = ({ label, children, ticker, f, dur }) => (
  <AbsoluteFill>
    {children}
    <div style={{ position: "absolute", top: 44, left: 60, display: "flex", alignItems: "center", gap: 14, opacity: 0.78 }}>
      <div style={{ width: 28, height: 1, background: C.gold }} />
      <div style={{ fontFamily: inter.fontFamily, fontSize: 12, letterSpacing: 5, textTransform: "uppercase", color: C.goldSoft }}>{label}</div>
    </div>
    {ticker && f !== undefined && dur !== undefined && <LiveTicker f={f} dur={dur} label={ticker} />}
  </AbsoluteFill>
);

const DashboardFrame: React.FC<{ children: React.ReactNode; title?: string; style?: React.CSSProperties }> = ({ children, title, style }) => (
  <div style={{ width: 1240, border: `1px solid ${C.line}`, borderRadius: 18, background: "rgba(8,17,31,0.88)", boxShadow: "0 28px 90px rgba(0,0,0,0.48)", overflow: "hidden", ...style }}>
    <div style={{ height: 54, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", fontFamily: inter.fontFamily }}>
      <div style={{ display: "flex", gap: 8 }}><i style={{ width: 8, height: 8, borderRadius: 99, background: C.gold }} /><i style={{ width: 8, height: 8, borderRadius: 99, background: "rgba(244,237,224,0.28)" }} /><i style={{ width: 8, height: 8, borderRadius: 99, background: "rgba(244,237,224,0.16)" }} /></div>
      <div style={{ color: C.goldSoft, fontSize: 12, letterSpacing: 3, textTransform: "uppercase" }}>{title ?? "ReconIQ workspace"}</div>
      <div style={{ color: C.mute, fontSize: 12 }}>Bank tenant</div>
    </div>
    {children}
  </div>
);

const BrandScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  // Pre-roll: monogram + wordmark are already ~70% in at frame 0 so voice never leads visuals.
  const sealSpring = spring({ frame: f + 6, fps: FPS, config: { damping: variant === "kinetic" ? 14 : 20, stiffness: 200 } });
  return (
    <SceneShell label="Brand" ticker="Signal live" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto", alignItems: "center", gap: 56 }}>
          <div style={{ transform: `scale(${interpolate(sealSpring, [0, 1], [0.82, 1], clamp)})`, opacity: sealSpring }}>
            <FVMonogram size={260} glow={44} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, transform: `translateX(${rise(f, 0, 24, 6)}px)`, opacity: q(f, 0, 6) }}>
            <div style={{ fontFamily: playfair.fontFamily, fontWeight: 700, fontSize: 108, color: C.cream, letterSpacing: -2, lineHeight: 0.95 }}>
              RECONIQ
            </div>
            <div style={{ fontFamily: playfair.fontFamily, fontWeight: 500, fontSize: 46, color: C.gold, letterSpacing: 14, textTransform: "uppercase" }}>
              Intelligence
            </div>
            <div style={{ height: 1, background: `linear-gradient(90deg, ${C.gold}, transparent)`, opacity: q(f, 4, 6) }} />
            <div style={{ fontFamily: playfair.fontFamily, fontStyle: "italic", fontWeight: 400, fontSize: 24, color: C.cream, opacity: 0.85, marginTop: 6 }}>
              “Built for speed. Tuned for truth.”
            </div>
          </div>
        </div>
        <div style={{ marginTop: 46, textAlign: "center", opacity: q(f, 6, 8), transform: `translateY(${rise(f, 6, 14, 8)}px)` }}>
          <div style={{ fontFamily: inter.fontFamily, fontWeight: 600, fontSize: 40, color: C.cream, letterSpacing: -0.4 }}>
            The Future of <span style={{ color: C.gold }}>AI-Powered</span> Reconciliation
          </div>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};


const MissionScene: React.FC<{ variant: Variant; dur: number }> = ({ dur }) => {
  const f = useCurrentFrame();
  return (
    <SceneShell label="Reconciliation" ticker="Mission critical" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20 }}>
        <div style={{ fontFamily: playfair.fontFamily, fontSize: 72, color: C.cream, lineHeight: 1.04, textAlign: "center", transform: `translateY(${rise(f, 0, 16, 5)}px)`, opacity: q(f, 0, 5) }}>
          Mission-critical reconciliation,<br /><span style={{ color: C.gold, fontStyle: "italic", opacity: q(f, 6, 6) }}>without the fire drill.</span>
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 12, opacity: q(f, 10, 6) }}>
          {["Tier-1 banks", "Global custodians", "Regulated funds"].map((t, i) => (
            <div key={t} style={{ opacity: q(f, 10 + i * 2, 5), color: C.mute, fontFamily: inter.fontFamily, fontSize: 15, letterSpacing: 3, textTransform: "uppercase" }}>• {t}</div>
          ))}
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const NativeScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const camera = interpolate(f, [0, dur], [variant === "kinetic" ? -48 : -22, variant === "kinetic" ? 44 : 22], clamp);
  const chips = ["AI-native core", "Agentic runtime", "Real-time insights", "Enterprise trust", "Autonomous triage", "Human oversight", "Grounded reasoning", "Audit-safe writes"];
  return (
    <SceneShell label="AI-native core" ticker="Engine online" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateX(${camera}px)`, display: "grid", gridTemplateColumns: "420px 720px", alignItems: "center", gap: 70 }}>
          <div style={{ position: "relative", height: 420, display: "grid", placeItems: "center", opacity: q(f, 0, 10) }}>
            <div style={{ position: "absolute", width: 360, height: 360, borderRadius: 999, border: `1px solid ${C.line}`, opacity: 0.5 }} />
            <div style={{ position: "absolute", width: 280, height: 280, borderRadius: 999, border: `1px solid ${C.line}`, opacity: 0.35 }} />
            <div style={{ position: "absolute" }}><FVMonogram size={180} glow={44} /></div>
          </div>
          <div>
            <div style={{ fontFamily: playfair.fontFamily, fontSize: 60, color: C.cream, lineHeight: 1.08, opacity: q(f, 0, 6), transform: `translateY(${rise(f, 0, 16, 6)}px)` }}>AI is not bolted on.<br /><span style={{ color: C.gold, fontStyle: "italic" }}>It is the reconciliation engine.</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 32 }}>
              {chips.map((chip, i) => {
                const start = spread(i, chips.length, dur, 28, 20);
                return <div key={chip} style={{ opacity: q(f, start, 8), transform: `translateY(${rise(f, start, 18, 8)}px)`, padding: "14px 18px", border: `1px solid ${C.line}`, borderRadius: 10, background: "rgba(15,31,61,0.62)", color: i % 4 === 0 ? C.goldSoft : C.cream, fontFamily: inter.fontFamily, fontSize: 17 }}>{chip}</div>;
              })}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const ProblemScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const rows = [["Brittle rules", "Adaptive agents"], ["Manual triage", "Autonomous diagnosis"], ["Weekly closes", "Continuous reconciliation"], ["Static thresholds", "Learning tolerances"]];
  return (
    <SceneShell label="Legacy pressure" ticker="Transform" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center" }}>
        <DashboardFrame title="Break queue comparison" style={{ transform: `scale(${interpolate(f, [0, dur], [0.97, 1.03], clamp)})` }}>
          <div style={{ padding: 40, display: "grid", gap: 14 }}>
            {rows.map(([left, right], i) => {
              const s = spread(i, rows.length, dur, 4, 14);
              return <div key={left} style={{ display: "grid", gridTemplateColumns: "1fr 70px 1fr", alignItems: "center", gap: 20, opacity: q(f, s, 8), fontFamily: inter.fontFamily }}>
                <div style={{ color: C.mute, fontSize: 26, textDecoration: "line-through", textAlign: "right" }}>{left}</div>
                <div style={{ color: C.gold, fontSize: 26, textAlign: "center", transform: `translateX(${interpolate(f, [s, s + 10], [-18, 0], clamp)}px)` }}>→</div>
                <div style={{ color: C.cream, fontSize: 28, fontWeight: 600, transform: `translateX(${rise(f, s, 26, 10)}px)` }}>{right}</div>
              </div>;
            })}
          </div>
        </DashboardFrame>
      </AbsoluteFill>
    </SceneShell>
  );
};

const AgentsScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const steps = ["Detect", "Diagnose", "Propose", "Review", "Resolve"];
  return (
    <SceneShell label="Agentic runs" ticker="Autonomy" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40 }}>
        <div style={{ fontFamily: playfair.fontFamily, fontSize: 58, color: C.cream, opacity: q(f, 0, 10), transform: `translateY(${rise(f, 0, 22, 10)}px)` }}>Agents move first. <span style={{ color: C.gold, fontStyle: "italic" }}>People approve.</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {steps.map((s, i) => {
            const start = spread(i, steps.length, dur, 18, 20);
            const active = f > start + 6;
            return <React.Fragment key={s}>
              <div style={{ opacity: q(f, start, 7), transform: `scale(${interpolate(spring({ frame: f - start, fps: FPS, config: { damping: 14, stiffness: 200 } }), [0, 1], [0.8, 1], clamp)})`, padding: "18px 26px", borderRadius: 10, border: `1px solid ${s === "Review" ? C.gold : C.line}`, background: s === "Review" && active ? "rgba(201,164,76,0.16)" : "rgba(15,31,61,0.68)", color: s === "Review" ? C.goldSoft : C.cream, fontFamily: inter.fontFamily, fontSize: 20, fontWeight: 600 }}>{s}</div>
              {i < steps.length - 1 && <div style={{ width: 46, height: 1, background: C.line, opacity: q(f, start + 4, 7), transform: `scaleX(${q(f, start + 4, 7)})`, transformOrigin: "left" }} />}
            </React.Fragment>;
          })}
        </div>
        <div style={{ opacity: q(f, dur - 40, 12), color: C.mute, fontFamily: inter.fontFamily, fontSize: 20, letterSpacing: 1.2 }}>Every action is logged · reversible · audit-ready</div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const CoverageScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const cards = [
    { t: "One-sided", d: "Ledger integrity", nodes: 1 },
    { t: "Two-sided", d: "Source vs counterparty", nodes: 2 },
    { t: "Tri-party", d: "Custodian · broker · fund", nodes: 3 },
  ];
  return (
    <SceneShell label="Coverage" ticker="Modes" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34 }}>
        <div style={{ fontFamily: playfair.fontFamily, fontSize: 58, color: C.cream, opacity: q(f, 0, 10) }}>One platform for <span style={{ color: C.gold, fontStyle: "italic" }}>every reconciliation.</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 340px)", gap: 28 }}>
          {cards.map((c, i) => {
            const start = spread(i, cards.length, dur, 14, 40);
            const op = q(f, start, 10);
            const pulse = 1 + Math.sin((f - start) / 8) * 0.02;
            return <div key={c.t} style={{ opacity: op, transform: `translateY(${rise(f, start, 36, 10)}px) scale(${interpolate(op, [0, 1], [0.94, pulse], clamp)})`, padding: 30, background: "rgba(21,42,82,0.62)", border: `1px solid ${C.line}`, borderRadius: 14, fontFamily: inter.fontFamily }}>
              <svg width="150" height="90" viewBox="0 0 150 90">
                {Array.from({ length: c.nodes }).map((_, k) => <circle key={k} cx={35 + k * 40} cy="45" r={interpolate(q(f, start + k * 6, 8), [0, 1], [3, 14], clamp)} fill="none" stroke={C.gold} strokeWidth="2" />)}
                {c.nodes >= 2 && <line x1="49" y1="45" x2="61" y2="45" stroke={C.gold} strokeWidth="2" opacity={q(f, start + 14, 6)} />}
                {c.nodes >= 3 && <line x1="89" y1="45" x2="101" y2="45" stroke={C.gold} strokeWidth="2" opacity={q(f, start + 20, 6)} />}
              </svg>
              <div style={{ fontFamily: playfair.fontFamily, fontSize: 32, color: C.cream, marginTop: 14 }}>{c.t}</div>
              <div style={{ fontSize: 16, color: C.mute, marginTop: 8 }}>{c.d}</div>
              <div style={{ marginTop: 20, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${interpolate(q(f, start + 24, dur - start - 30), [0, 1], [0, 100], clamp)}%`, height: "100%", background: C.gold }} />
              </div>
            </div>;
          })}
        </div>
      </AbsoluteFill>
      <SweepLine f={f} dur={dur} y={72} />
    </SceneShell>
  );
};

const CopilotScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const query = "Why did NA-USD cash break spike yesterday?";
  const charsPerFrame = variant === "kinetic" ? 0.55 : 0.42;
  const typed = query.slice(0, Math.min(query.length, Math.max(0, Math.floor((f - 10) * charsPerFrame))));
  const chips = ["NA-USD breaks", "SWIFT MT940", "SLA window", "Tenant scope", "Reasoning trace"];
  return (
    <SceneShell label="Copilot" ticker="Grounded" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center" }}>
        <DashboardFrame title="Copilot · grounded on your tenant" style={{ transform: `translateY(${rise(f, 0, 28, 10)}px)`, opacity: q(f, 0, 10) }}>
          <div style={{ padding: 44 }}>
            <div style={{ color: C.goldSoft, fontFamily: inter.fontFamily, fontSize: 14, letterSpacing: 3, textTransform: "uppercase", marginBottom: 18 }}>Ask the break queue in plain English</div>
            <div style={{ minHeight: 58, color: C.cream, fontFamily: inter.fontFamily, fontSize: 34, lineHeight: 1.25 }}>{typed}<span style={{ opacity: (f % 12) < 6 ? 1 : 0, color: C.gold }}>▍</span></div>
            <div style={{ height: 1, background: C.line, margin: "28px 0" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
              {chips.map((x, i) => {
                const start = spread(i, chips.length, dur, 80, 30);
                return <div key={x} style={{ opacity: q(f, start, 8), transform: `translateY(${rise(f, start, 20, 8)}px)`, padding: 16, border: `1px solid ${C.line}`, borderRadius: 10, background: "rgba(15,31,61,0.64)", color: i === 1 ? C.goldSoft : C.cream, fontFamily: inter.fontFamily, fontSize: 16 }}>{x}</div>;
              })}
            </div>
            <div style={{ marginTop: 26, display: "flex", gap: 8, alignItems: "center", opacity: q(f, dur - 60, 12) }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: C.gold, opacity: (f % 24) < 12 ? 1 : 0.3 }} />
              <span style={{ color: C.mute, fontFamily: inter.fontFamily, fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }}>Reasoning · 3 sources · tenant-scoped</span>
            </div>
          </div>
        </DashboardFrame>
      </AbsoluteFill>
    </SceneShell>
  );
};

const AnswerScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const bullets = ["Root cause: 3 SWIFT messages delayed 42 min", "Impact: $4.2M across 17 breaks", "Recommended action: approve auto-resolution"];
  return (
    <SceneShell label="Grounded answer" ticker="Explainable" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center" }}>
        <DashboardFrame title="Copilot response">
          <div style={{ padding: 44, display: "grid", gap: 16 }}>
            {bullets.map((b, i) => {
              const start = spread(i, bullets.length, dur, 4, 14);
              return <div key={b} style={{ opacity: q(f, start, 8), transform: `translateX(${rise(f, start, 26, 8)}px)`, display: "flex", alignItems: "center", gap: 16, color: C.cream, fontFamily: inter.fontFamily, fontSize: 28 }}><span style={{ color: C.gold, fontSize: 24 }}>◆</span>{b}</div>;
            })}
            <div style={{ marginTop: 18, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${interpolate(f, [0, dur - 8], [0, 100], clamp)}%`, height: "100%", background: `linear-gradient(90deg, ${C.gold}, ${C.goldSoft})` }} />
            </div>
          </div>
        </DashboardFrame>
      </AbsoluteFill>
    </SceneShell>
  );
};

const FourEyesScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const lanes = ["Agent proposed", "Reviewer A", "Reviewer B", "Approved", "Resolved"];
  return (
    <SceneShell label="Four-eyes control" ticker="Approval" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34 }}>
        <div style={{ fontFamily: playfair.fontFamily, fontSize: 56, color: C.cream, opacity: q(f, 0, 10) }}>Autonomy with <span style={{ color: C.gold, fontStyle: "italic" }}>bank-grade control.</span></div>
        <DashboardFrame title="Approval workflow">
          <div style={{ padding: 38, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
            {lanes.map((lane, i) => {
              const start = spread(i, lanes.length, dur, 18, 24);
              return <div key={lane} style={{ opacity: q(f, start, 7), transform: `translateY(${rise(f, start, 28, 7)}px)`, minHeight: 170, border: `1px solid ${i >= 3 ? C.gold : C.line}`, borderRadius: 12, background: i >= 3 ? "rgba(201,164,76,0.12)" : "rgba(15,31,61,0.62)", padding: 18, fontFamily: inter.fontFamily, color: C.cream }}>
                <div style={{ color: i >= 3 ? C.goldSoft : C.mute, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>Step {i + 1}</div>
                <div style={{ fontSize: 20, fontWeight: 650 }}>{lane}</div>
                <div style={{ marginTop: 18, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${interpolate(q(f, start + 6, 20), [0, 1], [0, 100], clamp)}%`, height: "100%", background: C.gold }} /></div>
              </div>;
            })}
          </div>
        </DashboardFrame>
      </AbsoluteFill>
    </SceneShell>
  );
};

const IngestScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const conns = ["SWIFT", "SAP", "Oracle", "Finacle", "Flexcube", "Tally", "Bloomberg", "Murex", "Calypso", "MT940", "ISO 20022", "FIX", "CAMT.053", "PAIN.002", "REST", "SFTP", "Kafka", "S3"];
  return (
    <SceneShell label="Ingestion" ticker="Feeds" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 30 }}>
        <div style={{ fontFamily: playfair.fontFamily, fontSize: 56, color: C.cream, opacity: q(f, 0, 10) }}>Ingest anything. <span style={{ color: C.gold, fontStyle: "italic" }}>Normalize instantly.</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 180px)", gap: 12 }}>
          {conns.map((c, i) => {
            const start = spread(i, conns.length, dur, 20, 26);
            return <div key={c} style={{ opacity: q(f, start, 6), transform: `translateY(${rise(f, start, 18, 6)}px)`, padding: "16px 10px", background: "rgba(15,31,61,0.68)", border: `1px solid ${C.line}`, borderRadius: 10, textAlign: "center", fontFamily: inter.fontFamily, fontSize: 16, color: C.cream, letterSpacing: 1 }}>{c}</div>;
          })}
        </div>
      </AbsoluteFill>
      <SweepLine f={f} dur={dur} y={82} />
    </SceneShell>
  );
};

const MatchingScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const tiers = [{ n: "Exact", pct: 62 }, { n: "Tolerance", pct: 21 }, { n: "Fuzzy", pct: 10 }, { n: "AI-inferred", pct: 7 }];
  return (
    <SceneShell label="Matching engine" ticker="Verdict" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 32 }}>
        <div style={{ fontFamily: playfair.fontFamily, fontSize: 56, color: C.cream, opacity: q(f, 0, 10) }}>Four tiers. <span style={{ color: C.gold, fontStyle: "italic" }}>One verdict.</span></div>
        <div style={{ width: 1180, display: "grid", gap: 18 }}>
          {tiers.map((t, i) => {
            const start = spread(i, tiers.length, dur, 16, 24);
            const w = interpolate(q(f, start, 22), [0, 1], [0, t.pct], clamp);
            return <div key={t.n} style={{ opacity: q(f, start, 7), fontFamily: inter.fontFamily }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, color: C.cream, fontSize: 22 }}><span>{t.n}</span><span style={{ color: C.gold, fontVariantNumeric: "tabular-nums" }}>{w.toFixed(0)}%</span></div>
              <div style={{ height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${w}%`, height: "100%", background: `linear-gradient(90deg, ${C.gold}, ${C.goldSoft})`, boxShadow: `0 0 14px ${C.gold}` }} /></div>
            </div>;
          })}
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const ResolutionScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const stats: Array<[string, string, number]> = [["17", "breaks closed", 17], ["$4.2M", "reconciled", 4.2], ["0", "unreviewed writes", 0]];
  return (
    <SceneShell label="Resolution" ticker="Auto-close" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", gap: 26 }}>
        {stats.map(([n, label, target], i) => {
          const start = spread(i, stats.length, dur, 6, 16);
          const counted = interpolate(q(f, start, 22), [0, 1], [0, target], clamp);
          const display = target === 4.2 ? `$${counted.toFixed(1)}M` : target === 0 ? "0" : Math.round(counted).toString();
          return <div key={label} style={{ opacity: q(f, start, 8), transform: `translateY(${rise(f, start, 30, 8)}px)`, width: 330, padding: "32px 28px", border: `1px solid ${C.line}`, borderRadius: 14, background: "rgba(15,31,61,0.66)", textAlign: "center" }}>
            <div style={{ color: C.goldSoft, fontFamily: playfair.fontFamily, fontSize: 60, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{display}</div>
            <div style={{ color: C.cream, fontFamily: inter.fontFamily, fontSize: 18, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 12 }}>{label}</div>
          </div>;
        })}
      </AbsoluteFill>
    </SceneShell>
  );
};

const TrustScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const badges = ["SOC 2 Type II", "ISO 27001", "GDPR", "Tenant isolation", "Data privacy", "Field-level encryption", "BYO-LLM keys", "Audit trail", "DORA-ready controls", "SSO / SAML / SCIM", "Immutable logs", "Region residency"];
  return (
    <SceneShell label="Trust" ticker="Governance" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 36 }}>
        <div style={{ fontFamily: playfair.fontFamily, fontSize: 56, color: C.cream, opacity: q(f, 0, 10) }}>Trust built into <span style={{ color: C.gold, fontStyle: "italic" }}>every layer.</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 320px)", gap: 16 }}>
          {badges.map((b, i) => {
            const start = spread(i, badges.length, dur, 16, 40);
            return <div key={b} style={{ opacity: q(f, start, 7), transform: `scale(${interpolate(spring({ frame: f - start, fps: FPS, config: { damping: 14, stiffness: 190 } }), [0, 1], [0.88, 1], clamp)})`, padding: "18px 22px", border: `1px solid ${C.line}`, borderRadius: 12, background: "rgba(15,31,61,0.62)", color: C.cream, fontFamily: inter.fontFamily, fontSize: 17, display: "flex", alignItems: "center", gap: 14 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: C.gold, opacity: (f + i * 5) % 40 < 20 ? 1 : 0.4 }} />{b}</div>;
          })}
        </div>
      </AbsoluteFill>
      <SweepLine f={f} dur={dur} y={88} />
    </SceneShell>
  );
};

const EnvScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  const envs = [{ n: "V-level", pct: 72 }, { n: "R-level", pct: 88 }, { n: "Region resilience", pct: 96 }];
  return (
    <SceneShell label="Configuration" ticker="Deploy" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 30 }}>
        <div style={{ fontFamily: playfair.fontFamily, fontSize: 52, color: C.cream, opacity: q(f, 0, 10) }}>Flexible deployment. <span style={{ color: C.gold, fontStyle: "italic" }}>Strict control.</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 340px)", gap: 24 }}>
          {envs.map((e, i) => {
            const start = spread(i, envs.length, dur, 16, 24);
            const pct = interpolate(q(f, start + 4, 22), [0, 1], [0, e.pct], clamp);
            return <div key={e.n} style={{ opacity: q(f, start, 7), padding: 28, border: `1px solid ${C.line}`, borderRadius: 14, background: "rgba(15,31,61,0.62)", fontFamily: inter.fontFamily }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: C.cream, fontSize: 22 }}><span>{e.n}</span><span style={{ color: C.gold, fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(0)}%</span></div>
              <div style={{ height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden", marginTop: 18 }}><div style={{ width: `${pct}%`, height: "100%", background: C.gold }} /></div>
            </div>;
          })}
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const CloseScene: React.FC<{ variant: Variant; dur: number }> = ({ variant, dur }) => {
  const f = useCurrentFrame();
  return (
    <SceneShell label="Close" ticker="Precision at bank scale" f={f} dur={dur}>
      <AbsoluteFill style={{ opacity: fadeLast(f, dur), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 24 }}>
        <div style={{ position: "relative", width: 328, height: 328, display: "grid", placeItems: "center", transform: `scale(${interpolate(f, [0, dur], [0.9, 1.08], clamp)})` }}>
          <div style={{ position: "absolute", width: 300, height: 300, borderRadius: 999, border: `1px solid ${C.line}`, opacity: 0.5 }} />
          <div style={{ position: "absolute", width: 230, height: 230, borderRadius: 999, border: `1px solid ${C.line}`, opacity: 0.32 }} />
          <div style={{ position: "absolute" }}><FVMonogram size={188} glow={64} /></div>
        </div>
        <div style={{ opacity: q(f, 4, 8), transform: `translateY(${rise(f, 4, 16, 8)}px)` }}><Wordmark size={58} /></div>
        <div style={{ width: 120, height: 1, background: C.gold, opacity: q(f, 12, 6), transform: `scaleX(${q(f, 12, 6)})` }} />
        <div style={{ opacity: q(f, 20, 8) }}><Tagline size={14} /></div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const SceneFor: React.FC<{ id: (typeof STORYBOARD)[number]["id"]; variant: Variant; dur: number }> = ({ id, variant, dur }) => {
  if (id === "brand") return <BrandScene variant={variant} dur={dur} />;
  if (id === "recon") return <MissionScene variant={variant} dur={dur} />;
  if (id === "native") return <NativeScene variant={variant} dur={dur} />;
  if (id === "breaks") return <ProblemScene variant={variant} dur={dur} />;
  if (id === "agents") return <AgentsScene variant={variant} dur={dur} />;
  if (id === "coverage") return <CoverageScene variant={variant} dur={dur} />;
  if (id === "copilot") return <CopilotScene variant={variant} dur={dur} />;
  if (id === "answer") return <AnswerScene variant={variant} dur={dur} />;
  if (id === "fourEyes") return <FourEyesScene variant={variant} dur={dur} />;
  if (id === "ingest") return <IngestScene variant={variant} dur={dur} />;
  if (id === "matching") return <MatchingScene variant={variant} dur={dur} />;
  if (id === "resolution") return <ResolutionScene variant={variant} dur={dur} />;
  if (id === "trust") return <TrustScene variant={variant} dur={dur} />;
  if (id === "env") return <EnvScene variant={variant} dur={dur} />;
  return <CloseScene variant={variant} dur={dur} />;
};

export const FVIVideo: React.FC<{ variant: Variant }> = ({ variant }) => (
  <AbsoluteFill style={{ background: C.ink }}>
    <BgBase variant={variant} />
    <Audio src={staticFile("audio/narration.mp3")} />
    {STORYBOARD.map((beat) => (
      <Sequence key={beat.id} from={beat.from} durationInFrames={beat.dur}>
        <SceneFor id={beat.id} variant={variant} dur={beat.dur} />
      </Sequence>
    ))}
    <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 56%, rgba(0,0,0,0.44) 100%)" }} />
  </AbsoluteFill>
);

export const storyboardRows = STORYBOARD.map((b) => ({
  ...b,
  startSec: +(b.from / FPS).toFixed(2),
  endSec: +((b.from + b.dur) / FPS).toFixed(2),
}));
