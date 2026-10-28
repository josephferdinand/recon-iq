/**
 * ReconIQ — The Monogram
 * Rounded square seal in the brand primary (#1e3a5f) with an inset accent
 * border in brand cyan (#00d4ff) and a cream "RQ" ligature in Inter Bold.
 *
 * Brand colors are fixed per BRAND.md (do not theme-shift). The standalone
 * SVG mirror of this component lives at public/fv-monogram.svg.
 */
export function FVMonogram({ className = "" }: { className?: string }) {
  const PRIMARY = "#1e3a5f"; // deep brand blue
  const ACCENT = "#00d4ff";  // brand cyan
  const CREAM = "#f4ede0";   // brand cream
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="ReconIQ monogram"
    >
      {/* Brand seal */}
      <rect x="0" y="0" width="100" height="100" rx="6" fill={PRIMARY} />
      {/* Subtle inner sheen */}
      <rect
        x="0"
        y="0"
        width="100"
        height="50"
        rx="6"
        fill="url(#fv-sheen)"
        opacity="0.18"
      />
      {/* Inset accent border */}
      <rect
        x="5"
        y="5"
        width="90"
        height="90"
        rx="3.5"
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.4"
      />
      {/* RQ ligature in Inter Bold */}
      <text
        x="50"
        y="54"
        textAnchor="middle"
        dominantBaseline="central"
        fill={CREAM}
        fontFamily='Inter, var(--font-display, "Space Grotesk"), ui-sans-serif, system-ui, sans-serif'
        fontWeight={700}
        fontSize="50"
        letterSpacing="-1.5"
      >
        RQ
      </text>
      <defs>
        <linearGradient id="fv-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
