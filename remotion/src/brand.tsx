import React from "react";
import { loadFont as loadPlayfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

export const playfair = loadPlayfair("normal", { weights: ["400", "600", "700"] });
export const inter = loadInter("normal", { weights: ["300", "400", "500", "600", "700"] });

export const C = {
  ink: "#08111F",
  navy: "#0F1F3D",
  navy2: "#152A52",
  gold: "#C9A44C",
  goldSoft: "#E5C87A",
  cream: "#F4EDE0",
  mute: "#6B7A99",
  line: "rgba(201,164,76,0.35)",
};

/** ReconIQ monogram — coffee seal with gold inset border and cream FV ligature. */
export const FVMonogram: React.FC<{ size?: number; glow?: number }> = ({ size = 240, glow = 0 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: glow ? `drop-shadow(0 0 ${glow}px rgba(201,164,76,0.55))` : undefined }}>
    <rect x="0" y="0" width="100" height="100" rx="6" fill="#2B1A0E" />
    <rect x="0" y="0" width="100" height="50" rx="6" fill="url(#sheen)" opacity="0.18" />
    <rect x="5" y="5" width="90" height="90" rx="3.5" fill="none" stroke={C.gold} strokeWidth="1.4" />
    <text x="50" y="54" textAnchor="middle" dominantBaseline="central" fill={C.cream}
      fontFamily={inter.fontFamily} fontWeight={700} fontSize="50" letterSpacing="-1.5">FV</text>
    <defs>
      <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
    </defs>
  </svg>
);

/** Hex Aperture — six gold segments forming a hexagon with a dark centre dot,
 *  matching the ReconIQ "APERTURE · PRECISION · VISION" mark. */
export const HexAperture: React.FC<{ size?: number; rotate?: number; opacity?: number }> = ({ size = 300, rotate = 0, opacity = 1 }) => {
  // outer hex points
  const R = 44;
  const hex = Array.from({ length: 6 }).map((_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(Math.cos(a) * R).toFixed(2)},${(Math.sin(a) * R).toFixed(2)}`;
  }).join(" ");
  const goldA = C.gold;
  const goldB = "#B08A38";
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ opacity, transform: `rotate(${rotate}deg)` }}>
      {/* outer hex outline */}
      <polygon points={hex} fill="none" stroke={C.gold} strokeWidth="0.7" opacity="0.7" />
      {/* six triangular segments */}
      {Array.from({ length: 6 }).map((_, i) => {
        const a0 = (Math.PI / 3) * i - Math.PI / 2;
        const a1 = (Math.PI / 3) * (i + 1) - Math.PI / 2;
        const x0 = Math.cos(a0) * (R - 4), y0 = Math.sin(a0) * (R - 4);
        const x1 = Math.cos(a1) * (R - 4), y1 = Math.sin(a1) * (R - 4);
        return <polygon key={i} points={`0,0 ${x0.toFixed(2)},${y0.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`} fill={i % 2 === 0 ? goldA : goldB} opacity="0.95" />;
      })}
      {/* centre dot */}
      <circle r="4.2" fill={C.ink} stroke={C.goldSoft} strokeWidth="0.8" />
    </svg>
  );
};

/** Aperture ring — legacy blade wheel kept for other scenes. */
export const Aperture: React.FC<{ size?: number; rotate?: number; opacity?: number }> = ({ size = 300, rotate = 0, opacity = 1 }) => {
  const blades = 8;
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ opacity, transform: `rotate(${rotate}deg)` }}>
      <circle r="42" fill="none" stroke={C.gold} strokeWidth="0.6" opacity="0.6" />
      <circle r="34" fill="none" stroke={C.gold} strokeWidth="0.4" opacity="0.4" />
      {Array.from({ length: blades }).map((_, i) => {
        const a = (i * 360) / blades;
        return (
          <g key={i} transform={`rotate(${a})`}>
            <path d="M 0 -40 L 14 -8 L 0 -14 L -14 -8 Z" fill={C.gold} opacity="0.85" />
          </g>
        );
      })}
      <circle r="6" fill={C.ink} stroke={C.goldSoft} strokeWidth="0.8" />
    </svg>
  );
};


export const Wordmark: React.FC<{ size?: number; align?: "left" | "center" }> = ({ size = 44, align = "center" }) => (
  <div style={{ textAlign: align, color: C.cream, fontFamily: playfair.fontFamily, fontWeight: 600, fontSize: size, letterSpacing: -1.2, lineHeight: 1 }}>
    ReconIQ <span style={{ color: C.gold, fontStyle: "italic" }}>Intelligence</span>
  </div>
);

export const Tagline: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <div style={{ fontFamily: inter.fontFamily, fontWeight: 500, fontSize: size, letterSpacing: 8, textTransform: "uppercase", color: C.goldSoft }}>
    Aperture · Precision · Vision
  </div>
);
