export type ThemeMode = "light" | "dark";

export const THEME_PALETTE_IDS = [
  "porcelain",
  "cloudy-mist",
  "arctic-frost",
  "coffee-warm-sand",
] as const;
export type PaletteId = (typeof THEME_PALETTE_IDS)[number];

export const THEME_CHROME_IDS = ["navy", "graphite", "sapphire", "forest"] as const;
export type ChromeId = (typeof THEME_CHROME_IDS)[number];

export type PaletteMeta = {
  id: PaletteId;
  name: string;
  mode: ThemeMode;
  description: string;
  swatches: string[];
};

export type ChromeMeta = {
  id: ChromeId;
  name: string;
  tone: "dark";
  description: string;
  swatches: string[];
};

export const PALETTES: PaletteMeta[] = [
  { id: "porcelain", name: "Porcelain", mode: "light", description: "Clean warm-white canvas with precise slate typography.", swatches: ["#fafbfc", "#e8ecf1", "#334155", "#0f766e"] },
  { id: "cloudy-mist", name: "Cloudy Mist", mode: "light", description: "Soft cool-grey canvas for low-glare operational work.", swatches: ["#f4f7fa", "#e2e8f0", "#475569", "#3b82f6"] },
  { id: "arctic-frost", name: "Arctic Frost", mode: "light", description: "Crisp fintech blue with calm analytical contrast.", swatches: ["#e8f0f8", "#b8d4e8", "#2e6b8a", "#0f766e"] },
  { id: "coffee-warm-sand", name: "Coffee Warm Sand", mode: "light", description: "Warm sand canvas with restrained coffee accents.", swatches: ["#f7f1e8", "#e8d9c4", "#5c3b1e", "#a47148"] },
];

export const CHROMES: ChromeMeta[] = [
  { id: "navy", name: "Navy & Gold", tone: "dark", description: "Deep navy chrome with warm gold brand accents.", swatches: ["#0e1a30", "#1c2c4d", "#c9a44c", "#e6ecf5"] },
  { id: "graphite", name: "Graphite Grey", tone: "dark", description: "Neutral low-glare graphite for focused operations.", swatches: ["#3a3f47", "#4b525c", "#94a3b8", "#f1f5f9"] },
  { id: "sapphire", name: "Sapphire Blue", tone: "dark", description: "Royal sapphire with a clear sky-blue accent.", swatches: ["#0b2a5b", "#133a7a", "#60a5fa", "#e6efff"] },
  { id: "forest", name: "Forest Pine", tone: "dark", description: "Deep forest green with a restrained mint accent.", swatches: ["#14352a", "#1f4a3a", "#6ee7b7", "#e8f5ec"] },
];

const LEGACY_PALETTE_MAP: Record<string, PaletteId> = {
  porcelain: "porcelain",
  "cloudy-mist": "cloudy-mist",
  "arctic-frost": "arctic-frost",
  "coffee-warm-sand": "coffee-warm-sand",
  "cloud-white": "porcelain",
  "paper-ink": "porcelain",
  "warm-sand": "coffee-warm-sand",
  "coffee-cream": "coffee-warm-sand",
  "cream-amber": "coffee-warm-sand",
  "sage-bone": "cloudy-mist",
  "rose-quartz": "cloudy-mist",
};

const LEGACY_CHROME_MAP: Record<string, ChromeId> = {
  navy: "navy",
  graphite: "graphite",
  sapphire: "sapphire",
  forest: "forest",
  midnight: "sapphire",
  slate: "sapphire",
  "sky-light": "sapphire",
  charcoal: "graphite",
  pearl: "graphite",
  mist: "graphite",
  crimson: "graphite",
  plum: "graphite",
  espresso: "navy",
  porcelain: "navy",
  linen: "navy",
  sand: "navy",
  "honey-light": "navy",
  "sage-light": "forest",
  "mint-light": "forest",
  blush: "graphite",
};

export const FVI_FACTORY_PRESET = {
  palette: "porcelain" as PaletteId,
  chrome: "navy" as ChromeId,
  topChrome: "navy" as ChromeId,
  dualMode: false,
};

export function normalizePaletteId(value: unknown): PaletteId {
  return typeof value === "string" ? LEGACY_PALETTE_MAP[value] ?? FVI_FACTORY_PRESET.palette : FVI_FACTORY_PRESET.palette;
}

export function normalizeChromeId(value: unknown): ChromeId {
  return typeof value === "string" ? LEGACY_CHROME_MAP[value] ?? FVI_FACTORY_PRESET.chrome : FVI_FACTORY_PRESET.chrome;
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "dark" ? "dark" : "light";
}
