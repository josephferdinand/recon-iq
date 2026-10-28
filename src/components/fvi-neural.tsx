/**
 * ReconIQ Neural — ported design elements from the reference HTML.
 *   - NeuralCanvas       : full-page particle-network backdrop, mouse reactive.
 *   - HeroOrbital        : hexagon core + orbital rings + floating metric tiles.
 *   - ArchitectureBands  : three-band Sources · Signals+ReconIQ Core · Actions.
 *
 * Kept as a single file to make the port self-contained. Uses only Tailwind
 * plus inline styles (no new tokens required) so it drops into the existing
 * noir coffee/gold landing without theme drift.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/* ------------------------------------------------------------------ */
/* Neural particle backdrop                                            */
/* ------------------------------------------------------------------ */
export function NeuralCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mouse = { x: -9999, y: -9999 };
    const colors = [
      { r: 212, g: 181, b: 129 }, // gold
      { r: 107, g: 229, b: 255 }, // cyan
      { r: 139, g: 124, b: 255 }, // violet
      { r: 102, g: 229, b: 176 }, // emerald
    ];

    type P = { x: number; y: number; vx: number; vy: number; r: number; c: typeof colors[number]; phase: number };
    let particles: P[] = [];
    let dpr = 1;
    let raf = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (): P => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.4 + 0.4,
      c: colors[Math.floor(Math.random() * colors.length)],
      phase: Math.random() * Math.PI * 2,
    });

    const seed = () => {
      const count = window.innerWidth < 768 ? 45 : 100;
      particles = Array.from({ length: count }, spawn);
    };

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    seed();
    window.addEventListener("resize", () => {
      resize();
      seed();
    });
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);

    const step = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 250 && d > 0) {
          const f = ((250 - d) / 250) * 0.4;
          p.vx += (dx / d) * f * 0.02;
          p.vy += (dy / d) * f * 0.02;
        }
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.phase += 0.04;

        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        const alpha = 0.4 + Math.sin(p.phase) * 0.2;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.c.r},${p.c.g},${p.c.b},${alpha})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.c.r},${p.c.g},${p.c.b},${alpha * 0.15})`;
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < 130) {
            const alpha = (1 - d / 130) * 0.16;
            const c = a.c;
            ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      if (mouse.x > 0) {
        const grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 220);
        grad.addColorStop(0, "rgba(212,181,129,0.08)");
        grad.addColorStop(0.5, "rgba(107,229,255,0.04)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(mouse.x - 220, mouse.y - 220, 440, 440);
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [reduce]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{ opacity: 0.85 }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Atmospheric overlay — mouse-reactive multi-hue radial glow          */
/* Ported from reference HTML `.atmos` layer.                          */
/* ------------------------------------------------------------------ */
export function AtmosOverlay() {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;

    // Coarse-pointer devices (touch / most mobiles) have no hover cursor —
    // fall back to a slow autonomous drift so the atmos still feels alive
    // without jitter from tap-driven pointer events.
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: none), (pointer: coarse)").matches;

    let raf = 0;
    // Target vs rendered position — lerping between them filters out
    // touchpad micro-jitter and yields a buttery follow.
    let tx = 50;
    let ty = 30;
    let cx = 50;
    let cy = 30;
    const t0 = performance.now();

    const onMove = (e: PointerEvent) => {
      // Only real mouse/trackpad hover moves drive the target; touch/pen
      // streams would fight the drift and jump on tap.
      if (e.pointerType && e.pointerType !== "mouse") return;
      tx = (e.clientX / window.innerWidth) * 100;
      ty = (e.clientY / window.innerHeight) * 100;
    };

    const tick = (now: number) => {
      if (coarse) {
        const t = (now - t0) / 1000;
        tx = 50 + Math.sin(t * 0.12) * 22;
        ty = 40 + Math.cos(t * 0.09) * 18;
      }
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      el.style.setProperty("--mx", cx.toFixed(2) + "%");
      el.style.setProperty("--my", cy.toFixed(2) + "%");
      raf = requestAnimationFrame(tick);
    };

    if (!coarse) {
      window.addEventListener("pointermove", onMove, { passive: true });
    }
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (!coarse) window.removeEventListener("pointermove", onMove);
    };
  }, [reduce]);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at var(--mx,50%) var(--my,30%), rgba(212,181,129,0.07), transparent 60%)," +
          "radial-gradient(ellipse 60% 40% at 90% 20%, rgba(107,229,255,0.05), transparent 60%)," +
          "radial-gradient(ellipse 50% 50% at 10% 80%, rgba(139,124,255,0.06), transparent 60%)",
        // rAF lerp handles smoothing; a CSS transition here would stack
        // on top and re-introduce lag/jitter.
      }}
    />
  );
}


/* ------------------------------------------------------------------ */
/* Hero orbital — hexagon core + rings + floating tiles                */
/* ------------------------------------------------------------------ */

type Tile = {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  pip: string;
  pos: React.CSSProperties;
};

const HERO_TILES: Tile[] = [
  { label: "Nostro matches", value: "12,438", delta: "▲ +2.4% today",   pip: "#6BE5FF", pos: { top: "4%",  right: "4%" } },
  { label: "Auto-match",     value: "97.0", unit: "%", delta: "▲ +0.6 vs last week", pip: "#D4B581", pos: { top: "24%", left: "-2%" } },
  { label: "MTTR reduced",   value: "−73",  unit: "%", delta: "vs legacy recon",     pip: "#66E5B0", pos: { bottom: "8%", right: "2%" } },
  { label: "Active agents",  value: "4",    unit: "/4", delta: "all systems nominal",pip: "#8B7CFF", pos: { bottom: "6%", left: "6%" } },
  { label: "Hash block",     value: "#48219", delta: "SHA-256 sealed",               pip: "#6BE5FF", pos: { top: "48%", left: "-2%", transform: "translateY(-50%)" } },
];

/**
 * useTileAutoLayout — collision-avoidance for absolutely-positioned tiles.
 *
 * Measures the container + each tile + a central exclusion circle (the hex
 * core), then iteratively separates any overlapping pair by pushing them
 * apart along the minimum-translation axis. Also pushes tiles outward from
 * the core. Result offsets are written as CSS vars (--fvi-dx / --fvi-dy)
 * on each wrapper so the float animation on the inner motion.div is
 * preserved. Re-runs on ResizeObserver + window resize.
 */
function useTileAutoLayout(
  containerRef: React.RefObject<HTMLDivElement | null>,
  tileRefs: React.MutableRefObject<(HTMLDivElement | null)[]>,
  opts: { padding?: number; corePct?: number; iterations?: number } = {},
) {
  const padding = opts.padding ?? 10;
  const corePct = opts.corePct ?? 0.22; // exclusion radius vs container min-dim
  const iterations = opts.iterations ?? 12;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let raf = 0;
    const relayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cRect = container.getBoundingClientRect();
        if (cRect.width < 10 || cRect.height < 10) return;
        const tiles = tileRefs.current.filter(Boolean) as HTMLDivElement[];
        if (tiles.length === 0) return;

        // reset offsets so measurement reflects natural anchored positions
        tiles.forEach((el) => {
          el.style.setProperty("--fvi-dx", "0px");
          el.style.setProperty("--fvi-dy", "0px");
        });

        // measure natural rects relative to container
        const rects = tiles.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            x: r.left - cRect.left,
            y: r.top - cRect.top,
            w: r.width,
            h: r.height,
            dx: 0,
            dy: 0,
          };
        });

        const cx = cRect.width / 2;
        const cy = cRect.height / 2;
        const coreR = Math.min(cRect.width, cRect.height) * corePct;

        for (let iter = 0; iter < iterations; iter++) {
          let moved = false;

          // tile-vs-tile separation (AABB with MTV)
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i];
              const b = rects[j];
              const ax1 = a.x + a.dx, ay1 = a.y + a.dy;
              const bx1 = b.x + b.dx, by1 = b.y + b.dy;
              const overlapX =
                Math.min(ax1 + a.w, bx1 + b.w) - Math.max(ax1, bx1) + padding;
              const overlapY =
                Math.min(ay1 + a.h, by1 + b.h) - Math.max(ay1, by1) + padding;
              if (overlapX > 0 && overlapY > 0) {
                moved = true;
                if (overlapX < overlapY) {
                  const push = overlapX / 2;
                  const dir = ax1 + a.w / 2 < bx1 + b.w / 2 ? -1 : 1;
                  a.dx += dir * push;
                  b.dx -= dir * push;
                } else {
                  const push = overlapY / 2;
                  const dir = ay1 + a.h / 2 < by1 + b.h / 2 ? -1 : 1;
                  a.dy += dir * push;
                  b.dy -= dir * push;
                }
              }
            }
          }

          // push tiles out of the central core exclusion circle
          for (const r of rects) {
            const tcx = r.x + r.dx + r.w / 2;
            const tcy = r.y + r.dy + r.h / 2;
            const vx = tcx - cx;
            const vy = tcy - cy;
            const dist = Math.hypot(vx, vy) || 0.0001;
            const minDist = coreR + Math.max(r.w, r.h) / 2 + padding;
            if (dist < minDist) {
              moved = true;
              const push = minDist - dist;
              r.dx += (vx / dist) * push;
              r.dy += (vy / dist) * push;
            }
          }

          // clamp inside container
          for (const r of rects) {
            const x1 = r.x + r.dx;
            const y1 = r.y + r.dy;
            if (x1 < 0) r.dx += -x1;
            if (y1 < 0) r.dy += -y1;
            const overRight = x1 + r.w - cRect.width;
            const overBottom = y1 + r.h - cRect.height;
            if (overRight > 0) r.dx -= overRight;
            if (overBottom > 0) r.dy -= overBottom;
          }

          if (!moved) break;
        }

        rects.forEach((r, i) => {
          const el = tiles[i];
          el.style.setProperty("--fvi-dx", `${Math.round(r.dx)}px`);
          el.style.setProperty("--fvi-dy", `${Math.round(r.dy)}px`);
        });
      });
    };

    relayout();
    const ro = new ResizeObserver(relayout);
    ro.observe(container);
    tileRefs.current.forEach((el) => el && ro.observe(el));
    window.addEventListener("resize", relayout);
    // fonts can shift tile sizes after paint
    (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(relayout);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", relayout);
    };
  }, [containerRef, tileRefs, padding, corePct, iterations]);
}

export function HeroOrbital() {
  const reduce = useReducedMotion();
  const orbitRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  useTileAutoLayout(orbitRef, tileRefs, { padding: 12, corePct: 0.24 });
  return (
    <div className="mx-auto w-full max-w-[900px]">
      <div ref={orbitRef} className="relative mx-auto aspect-square w-full overflow-hidden sm:aspect-[4/3] md:aspect-[16/10] md:overflow-visible">
        {/* halo */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-[-40%]"
          style={{
            background:
              "radial-gradient(circle, rgba(212,181,129,0.30) 0%, rgba(212,181,129,0.08) 30%, transparent 60%)",
            filter: "blur(20px)",
          }}
          animate={reduce ? {} : { opacity: [0.55, 1, 0.55], scale: [1, 1.08, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* rings — wrapper centers, inner motion.div owns rotation so framer
            can drive `transform` without clobbering the centering translate. */}
        {[
          { size: 380, color: "rgba(107,229,255,0.30)", dur: 30, dir: 1, dashed: false },
          { size: 480, color: "rgba(139,124,255,0.20)", dur: 45, dir: -1, dashed: true },
          { size: 600, color: "rgba(212,181,129,0.18)", dur: 60, dir: 1, dashed: false },
        ].map((r, i) => {
          const dim = `min(${r.size}px, ${(r.size / 600) * 90}vw)`;
          return (
            <div
              key={i}
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ width: dim, height: dim }}
            >
              <motion.div
                className="h-full w-full rounded-full"
                style={{ border: `1px ${r.dashed ? "dashed" : "solid"} ${r.color}` }}
                animate={reduce ? {} : { rotate: r.dir * 360 }}
                transition={{ duration: r.dur, repeat: Infinity, ease: "linear" }}
              />
            </div>
          );
        })}

        {/* hexagon core — same wrapper trick so rotation stays centered. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[180px] w-[180px] -translate-x-1/2 -translate-y-1/2 sm:h-[220px] sm:w-[220px] md:h-[280px] md:w-[280px]"
        >
          <motion.svg
            viewBox="-50 -50 100 100"
            className="h-full w-full"
            style={{ filter: "drop-shadow(0 0 60px rgba(212,181,129,0.5))" }}
            animate={reduce ? {} : { rotate: 360 }}
            transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          >
            <defs>
              <linearGradient id="fvi-hex-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#F2DDB4" />
                <stop offset=".5" stopColor="#D4B581" />
                <stop offset="1" stopColor="#5C4F36" />
              </linearGradient>
            </defs>
            <polygon points="0,-32 28,-16 28,16 0,32 -28,16 -28,-16" fill="url(#fvi-hex-grad)" opacity=".9" />
            <polygon points="0,-32 28,-16 28,16 0,32 -28,16 -28,-16" fill="none" stroke="#F2DDB4" strokeWidth=".6" opacity=".55" />
            <circle cx="0" cy="0" r="36" fill="none" stroke="#6BE5FF" strokeWidth=".4" opacity=".6" />
            <circle cx="0" cy="0" r="24" fill="none" stroke="#8B7CFF" strokeWidth=".4" opacity=".6" />
            <g stroke="#F2DDB4" strokeWidth=".4" opacity=".4">
              <line x1="0" y1="-32" x2="0" y2="32" />
              <line x1="-32" y1="0" x2="32" y2="0" />
              <line x1="-22" y1="-22" x2="22" y2="22" />
              <line x1="-22" y1="22" x2="22" y2="-22" />
            </g>
            <circle cx="0" cy="0" r="3" fill="#F2DDB4" />
          </motion.svg>
        </div>

        {/* floating tiles — desktop / tablet only. Outer wrapper carries the
            anchor position + collision offset (CSS vars set by
            useTileAutoLayout); inner motion.div keeps the float animation. */}
        {HERO_TILES.map((t, i) => (
          <div
            key={t.label}
            ref={(el) => { tileRefs.current[i] = el; }}
            className="absolute hidden md:block"
            style={{
              ...t.pos,
              transform: "translate(var(--fvi-dx, 0px), var(--fvi-dy, 0px))",
              transition: "transform 400ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "transform",
            }}
          >
            <motion.div
              className="min-w-[160px] rounded-[18px] px-[14px] py-[12px] lg:min-w-[180px] lg:px-[18px] lg:py-[14px]"
              style={{
                background: "rgba(8,12,22,0.78)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                border: "1px solid rgba(212,181,129,0.22)",
                boxShadow: "0 30px 60px -20px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
              animate={reduce ? {} : { y: [0, -10, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: -i * 1.2 }}
            >
              <div className="mb-2.5 flex items-center gap-2.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: t.pip, boxShadow: `0 0 10px ${t.pip}` }}
                />
                <span
                  className="font-mono text-[9.5px] uppercase tracking-[0.16em]"
                  style={{ color: "rgba(246,248,252,0.86)" }}
                >
                  {t.label}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 font-display text-[20px] font-normal tracking-tight text-white lg:text-[22px]">
                {t.value}
                {t.unit && <span className="text-[13px]" style={{ color: "rgba(246,248,252,0.7)" }}>{t.unit}</span>}
              </div>
              <div className="mt-1 font-mono text-[10px]" style={{ color: "#7CF0BE" }}>
                {t.delta}
              </div>
            </motion.div>
          </div>
        ))}

        {/* accent orbs */}
        {(
          [
            { pos: { top: "18%", left: "8%" },      c: "#D4B581", delay: 0 },
            { pos: { top: "35%", right: "14%" },    c: "#6BE5FF", delay: -1.2 },
            { pos: { bottom: "22%", left: "18%" },  c: "#8B7CFF", delay: -2.4 },
            { pos: { top: "60%", left: "42%" },     c: "#66E5B0", delay: -3.6 },
            { pos: { bottom: "8%", right: "28%" },  c: "#D4B581", delay: -1.8 },
          ] as const
        ).map((o, i) => (
          <motion.span
            key={i}
            aria-hidden
            className="pointer-events-none absolute h-1.5 w-1.5 rounded-full"
            style={{ ...o.pos, background: o.c, boxShadow: `0 0 20px ${o.c}` }}
            animate={reduce ? {} : { x: [0, 40, -20, -40, 0], y: [0, -30, -60, 30, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: o.delay }}
          />
        ))}
      </div>

      {/* mobile-only stacked tile grid — replaces overlapping floats */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:hidden">
        {HERO_TILES.map((t) => (
          <div
            key={t.label}
            className="rounded-[16px] px-3 py-3"
            style={{
              background: "rgba(10,15,26,0.65)",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 20px 40px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: t.pip, boxShadow: `0 0 10px ${t.pip}` }} />
              <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: "rgba(246,248,252,0.7)" }}>
                {t.label}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 font-display text-[18px] tracking-tight text-white">
              {t.value}
              {t.unit && <span className="text-[12px]" style={{ color: "rgba(246,248,252,0.5)" }}>{t.unit}</span>}
            </div>
            <div className="mt-1 font-mono text-[10px]" style={{ color: "#66E5B0" }}>
              {t.delta}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Architecture bands                                                  */
/* ------------------------------------------------------------------ */

const SOURCES = [
  { name: "SWIFT",             meta: "MT103 · MT940" },
  { name: "GL · Oracle / SAP", meta: "streaming CDC" },
  { name: "Custodian",         meta: "State Street · BNY" },
  { name: "Broker · FIX · FpML", meta: "T+0 feed" },
];

const SIGNALS = [
  { nm: "SLA breaches",     vl: "3 watches" },
  { nm: "Anomaly z-score",  vl: "live" },
  { nm: "Anomaly IQR",      vl: "live" },
  { nm: "Quality rules",    vl: "42 active" },
  { nm: "Recon runners",    vl: "6 active" },
];

const AGENTS = [
  { nm: "Resolution Agent", vl: "live" },
  { nm: "Design Agent",     vl: "live" },
  { nm: "AIDP · PDF",       vl: "live" },
  { nm: "Knowledge Graph",  vl: "learning" },
  { nm: "4-eyes queue",     vl: "2 pending" },
];

const ACTIONS = [
  { name: "Agent triage",     meta: "drafts · awaits 4-eyes" },
  { name: "Human 4-eyes",     meta: "controllable approval" },
  { name: "Write-back · ERP / GL", meta: "signed · witnessed" },
  { name: "SHA-256 anchor",   meta: "tenant-isolated" },
];

function BandHead({ label, ctr }: { label: string; ctr: string }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.2em]" style={{ color: "#F2DDB4" }}>
        <span className="inline-block h-px w-6" style={{ background: "#D4B581" }} />
        {label}
      </div>
      <div className="font-mono text-[10px] tracking-[0.06em]" style={{ color: "rgba(246,248,252,0.5)" }}>
        {ctr}
      </div>
    </div>
  );
}

function Node({ name, meta }: { name: string; meta: string }) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="flex items-center gap-3 rounded-[14px] px-4 py-3.5 font-mono text-[12px]"
      style={{
        background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(10px)",
        color: "rgba(246,248,252,0.9)",
      }}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
        style={{
          color: "#B3F1FF",
          background: "rgba(107,229,255,0.08)",
          border: "1px solid rgba(107,229,255,0.15)",
        }}
      >
        <span className="block h-1.5 w-1.5 rounded-full" style={{ background: "#6BE5FF", boxShadow: "0 0 8px #6BE5FF" }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate">{name}</span>
        <span className="mt-0.5 block text-[9.5px]" style={{ color: "rgba(246,248,252,0.5)" }}>{meta}</span>
      </span>
    </motion.div>
  );
}

function Signal({ nm, vl }: { nm: string; vl: string }) {
  return (
    <motion.div
      whileHover={{ x: 4 }}
      className="flex items-center justify-between rounded-lg border-l-2 px-3.5 py-2.5 font-mono text-[11.5px] transition"
      style={{ background: "rgba(255,255,255,0.02)", borderLeftColor: "transparent" }}
    >
      <span style={{ color: "rgba(246,248,252,0.9)" }}>{nm}</span>
      <span className="flex items-center gap-1.5 font-semibold" style={{ color: "#B3F1FF" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#6BE5FF", boxShadow: "0 0 6px #6BE5FF" }} />
        {vl}
      </span>
    </motion.div>
  );
}

/* Live connection overlay — measures source/core/action node centers and
   draws animated curved wires with traveling packets between them. */
type Pt = { x: number; y: number };
type Wire = { d: string; from: Pt; to: Pt; color: string; delay: number };

/* Wire geometry is measured in a single rAF pass to coalesce ResizeObserver
   bursts, then diffed against the previous result so React only re-renders
   when the SVG paths actually change. Keeps the connector layer smooth on
   low-end devices even while other page motion is running. */
function useWires(
  containerRef: React.RefObject<HTMLDivElement | null>,
  sourceRefs: React.MutableRefObject<(HTMLDivElement | null)[]>,
  coreRef: React.RefObject<HTMLDivElement | null>,
  actionRefs: React.MutableRefObject<(HTMLDivElement | null)[]>,
) {
  const [state, setState] = useState<{ wires: Wire[]; box: { w: number; h: number } }>({
    wires: [],
    box: { w: 0, h: 0 },
  });
  const lastSigRef = useRef<string>("");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    let pending = false;
    let disposed = false;

    const compute = () => {
      pending = false;
      if (disposed) return;
      const cRect = container.getBoundingClientRect();
      const core = coreRef.current;
      if (!core || cRect.width < 10) return;
      const coreRect = core.getBoundingClientRect();
      const cx = coreRect.left - cRect.left + coreRect.width / 2;
      const coreTopY = coreRect.top - cRect.top + 8;
      const coreBotY = coreRect.bottom - cRect.top - 8;
      const gold = "rgba(212,181,129,0.55)";
      const cyan = "rgba(107,229,255,0.5)";
      const round = (n: number) => Math.round(n * 100) / 100;

      const next: Wire[] = [];
      const sources = sourceRefs.current;
      for (let i = 0; i < sources.length; i++) {
        const el = sources[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const from: Pt = {
          x: round(r.left - cRect.left + r.width / 2),
          y: round(r.bottom - cRect.top - 4),
        };
        const to: Pt = { x: round(cx), y: round(coreTopY) };
        const mid = round((from.y + to.y) / 2);
        const d = `M ${from.x} ${from.y} C ${from.x} ${mid}, ${to.x} ${mid}, ${to.x} ${to.y}`;
        next.push({ d, from, to, color: cyan, delay: i * 0.35 });
      }
      const actions = actionRefs.current;
      for (let i = 0; i < actions.length; i++) {
        const el = actions[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const to: Pt = {
          x: round(r.left - cRect.left + r.width / 2),
          y: round(r.top - cRect.top + 4),
        };
        const from: Pt = { x: round(cx), y: round(coreBotY) };
        const mid = round((from.y + to.y) / 2);
        const d = `M ${from.x} ${from.y} C ${from.x} ${mid}, ${to.x} ${mid}, ${to.x} ${to.y}`;
        next.push({ d, from, to, color: gold, delay: 0.6 + i * 0.35 });
      }

      const w = round(cRect.width);
      const h = round(cRect.height);
      // Signature-based equality gate: skip setState when nothing moved
      // enough to matter (sub-pixel jitter is filtered by rounding above).
      const sig = `${w}x${h}|${next.map((n) => n.d).join("|")}`;
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;
      setState({ wires: next, box: { w, h } });
    };

    const schedule = () => {
      if (pending) return;
      pending = true;
      raf = requestAnimationFrame(compute);
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    sourceRefs.current.forEach((el) => el && ro.observe(el));
    actionRefs.current.forEach((el) => el && ro.observe(el));
    if (coreRef.current) ro.observe(coreRef.current);
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [containerRef, sourceRefs, coreRef, actionRefs]);

  return state;
}

export function ArchitectureBands() {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sourceRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const { wires, box } = useWires(containerRef, sourceRefs, coreRef, actionRefs);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-[28px] p-6 md:p-9"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(107,229,255,0.04), transparent 70%), rgba(10,15,26,0.5)",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(40px)",
        boxShadow: "0 60px 120px -30px rgba(0,0,0,0.8)",
      }}
    >
      {/* faint grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 50%, black, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 50%, black, transparent 80%)",
        }}
      />

      {/* wire overlay — sits above the grid, below content interactions */}
      {box.w > 0 && wires.length > 0 && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden lg:block"
          width={box.w}
          height={box.h}
          viewBox={`0 0 ${box.w} ${box.h}`}
          style={{ willChange: "transform", transform: "translateZ(0)", contain: "strict" }}
        >
          <defs>
            <radialGradient id="fvi-packet-cyan" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#B3F1FF" stopOpacity="1" />
              <stop offset="0.4" stopColor="#6BE5FF" stopOpacity="0.9" />
              <stop offset="1" stopColor="#6BE5FF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="fvi-packet-gold" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#F2DDB4" stopOpacity="1" />
              <stop offset="0.4" stopColor="#D4B581" stopOpacity="0.9" />
              <stop offset="1" stopColor="#D4B581" stopOpacity="0" />
            </radialGradient>
          </defs>
          {wires.map((w, i) => {
            const isGold = w.color.includes("212");
            const packet = isGold ? "url(#fvi-packet-gold)" : "url(#fvi-packet-cyan)";
            const pathId = `fvi-wire-${i}`;
            return (
              <g key={i}>
                {/* static faint rail */}
                <path d={w.d} fill="none" stroke={w.color} strokeWidth="1" strokeOpacity="0.25" />
                {/* draw-in animated stroke */}
                <motion.path
                  id={pathId}
                  d={w.d}
                  fill="none"
                  stroke={w.color}
                  strokeWidth="1.25"
                  strokeDasharray="4 6"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={reduce ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1.2, delay: w.delay, ease: "easeOut" }}
                />
                {/* endpoint pulse at source/action side */}
                <circle cx={isGold ? w.to.x : w.from.x} cy={isGold ? w.to.y : w.from.y} r="2" fill={isGold ? "#D4B581" : "#6BE5FF"} opacity="0.9" />
                {/* traveling packet — animateMotion follows the wire */}
                {!reduce && (
                  <circle r="4" fill={packet}>
                    <animateMotion
                      dur="3.2s"
                      begin={`${w.delay + 1}s`}
                      repeatCount="indefinite"
                      rotate="auto"
                    >
                      <mpath href={`#${pathId}`} />
                    </animateMotion>
                  </circle>
                )}
                {!reduce && (
                  <circle r="1.6" fill={isGold ? "#F2DDB4" : "#B3F1FF"}>
                    <animateMotion
                      dur="3.2s"
                      begin={`${w.delay + 2.4}s`}
                      repeatCount="indefinite"
                    >
                      <mpath href={`#${pathId}`} />
                    </animateMotion>
                  </circle>
                )}
              </g>
            );
          })}
        </svg>
      )}

      <div className="relative flex flex-col gap-7">
        {/* Band 1: Sources */}
        <div>
          <BandHead label="① Sources · 12 connectors" ctr="SWIFT · MT940 · ISO 20022 · Oracle · SAP · State Street · FIX · FpML" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SOURCES.map((s, i) => (
              <div key={s.name} ref={(el) => { sourceRefs.current[i] = el; }}>
                <Node name={s.name} meta={s.meta} />
              </div>
            ))}
          </div>
        </div>

        {/* Band 2: Signals + Core */}
        <div>
          <BandHead label="② Signals & ReconIQ Core" ctr="match · reason · audit · seal" />
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr]">
            <div
              className="flex flex-col justify-center gap-2.5 rounded-[20px] p-5"
              style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {SIGNALS.map((s) => <Signal key={s.nm} nm={s.nm} vl={s.vl} />)}
            </div>

            <div
              ref={coreRef}
              className="relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-[20px] p-8 text-center"
              style={{
                background: "linear-gradient(135deg, rgba(212,181,129,0.08), rgba(212,181,129,0.02))",
                border: "1px solid rgba(212,181,129,0.3)",
              }}
            >
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background: "linear-gradient(135deg, rgba(212,181,129,0.35), transparent 50%, rgba(107,229,255,0.25))",
                  backgroundSize: "200% 200%",
                  opacity: 0.55,
                  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                  WebkitMaskComposite: "xor" as unknown as string,
                  maskComposite: "exclude" as unknown as string,
                  padding: 1,
                  borderRadius: 20,
                }}
                animate={reduce ? {} : { backgroundPosition: ["0% 0%", "200% 0%"] }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              />
              <motion.div
                className="relative grid h-[92px] w-[92px] place-items-center rounded-full"
                style={{
                  background: "radial-gradient(circle at 30% 30%, #F2DDB4, #D4B581 50%, #8C7651)",
                  boxShadow: "0 0 60px rgba(212,181,129,0.5), inset 0 0 30px rgba(0,0,0,0.4)",
                  color: "#0a0a0a",
                }}
                animate={reduce ? {} : { boxShadow: ["0 0 60px rgba(212,181,129,0.5), inset 0 0 30px rgba(0,0,0,0.4)", "0 0 90px rgba(212,181,129,0.7), inset 0 0 30px rgba(0,0,0,0.4)", "0 0 60px rgba(212,181,129,0.5), inset 0 0 30px rgba(0,0,0,0.4)"] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" />
                </svg>
              </motion.div>
              <div className="relative">
                <h4 className="font-serif text-[26px] italic" style={{ background: "linear-gradient(135deg, #F2DDB4, #D4B581)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                  ReconIQ Core
                </h4>
                <div className="mt-1 font-mono text-[12px] tracking-[0.08em]" style={{ color: "rgba(246,248,252,0.7)" }}>
                  match · reason · audit · seal
                </div>
              </div>
            </div>

            <div
              className="flex flex-col justify-center gap-2.5 rounded-[20px] p-5"
              style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {AGENTS.map((s) => <Signal key={s.nm} nm={s.nm} vl={s.vl} />)}
            </div>
          </div>
        </div>

        {/* Band 3: Actions */}
        <div>
          <BandHead label="③ Actions · Audit · Governance" ctr="4-eyes approval · SHA-256 anchor · policy / RBAC · kill switch" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ACTIONS.map((s, i) => (
              <div key={s.name} ref={(el) => { actionRefs.current[i] = el; }}>
                <Node name={s.name} meta={s.meta} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Capability Trio — Aperture · Precision · Intelligence               */
/* ------------------------------------------------------------------ */
const TRIO = [
  {
    num: "i.",
    title: "Aperture",
    desc: "A bird's-eye view across cash, securities, intercompany and general ledger — without losing resolution.",
    features: [
      "Cash & nostro across 12+ formats",
      "Securities & trade lifecycles T+0 → T+N",
      "Intercompany matching with policy books",
      "GL with sub-ledger reconciliation",
    ],
    foot: "Read all sources →",
    accent: "#6BE5FF",
  },
  {
    num: "ii.",
    title: "Precision",
    desc: "Deterministic rules meet probabilistic matching. Tolerance-aware clustering where it counts.",
    features: [
      "20+ matching rules (1:1, 1:N, N:N)",
      "Fuzzy, tolerance, composite keys",
      "Deterministic replay for audit",
      "Confidence-scored resolution paths",
    ],
    foot: "Match with certainty →",
    accent: "#D4B581",
  },
  {
    num: "iii.",
    title: "Intelligence",
    desc: "Agentic AI that reasons about breaks and drafts fixes under four-eyes human control.",
    features: [
      "Resolution agent · confidence scoring",
      "Root-cause analysis & NL rule builder",
      "AIDP for PDF statements",
      "Break Knowledge Graph — learns per-tenant",
    ],
    foot: "Reasoning, not guesses →",
    accent: "#8B7CFF",
  },
] as const;

export function CapabilityTrio() {
  const reduce = useReducedMotion();
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {TRIO.map((c, i) => (
        <motion.article
          key={c.title}
          initial={reduce ? undefined : { opacity: 0, y: 24 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
          whileHover={reduce ? undefined : { y: -6 }}
          className="group relative overflow-hidden rounded-2xl p-8"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,12,22,0.88), rgba(3,5,8,0.94))",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 14%, transparent)",
            boxShadow:
              "0 30px 80px -40px color-mix(in oklab, var(--brand-gold) 30%, transparent)",
          }}
        >
          {/* Top gilded hairline that lights on hover */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-40 transition-opacity duration-500 group-hover:opacity-100"
            style={{
              background:
                "linear-gradient(90deg, transparent, color-mix(in oklab, var(--brand-gold) 70%, transparent), transparent)",
            }}
          />
          {/* Accent glow */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-50"
            style={{ background: c.accent }}
          />

          <div
            className="mb-5 font-display italic leading-none"
            style={{
              fontSize: "3.25rem",
              color: "color-mix(in oklab, var(--brand-gold) 85%, transparent)",
              letterSpacing: "-0.02em",
            }}
          >
            {c.num}
          </div>

          <h3
            className="font-display text-3xl font-medium tracking-tight"
            style={{ color: "var(--brand-cream)" }}
          >
            {c.title}
          </h3>

          <p
            className="mt-4 text-[15px] leading-relaxed"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}
          >
            {c.desc}
          </p>

          <ul className="mt-7 space-y-3 border-t border-b py-6"
            style={{ borderColor: "color-mix(in oklab, var(--brand-gold) 10%, transparent)" }}
          >
            {c.features.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm"
                style={{ color: "color-mix(in oklab, var(--brand-cream) 82%, transparent)" }}
              >
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: c.accent, boxShadow: `0 0 10px ${c.accent}` }}
                />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <div
            className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em]"
            style={{ color: c.accent }}
          >
            {c.foot}
          </div>
        </motion.article>
      ))}
    </div>
  );
}
