import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  FVI_FACTORY_PRESET,
  normalizeChromeId,
  normalizePaletteId,
  normalizeThemeMode,
  type ChromeId,
  type PaletteId,
  type ThemeMode,
} from "@/lib/theme-config";

export { CHROMES, FVI_FACTORY_PRESET, PALETTES } from "@/lib/theme-config";
export type { ChromeId, ChromeMeta, PaletteId, PaletteMeta, ThemeMode } from "@/lib/theme-config";

type Ctx = {
  theme: ThemeMode;
  palette: PaletteId;
  chrome: ChromeId;          // side rail chrome
  topChrome: ChromeId;       // top bar chrome (== chrome when dualMode = false)
  dualMode: boolean;         // when true, top + side use independent chromes
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
  setPalette: (p: PaletteId) => void;
  setChrome: (c: ChromeId) => void;
  setTopChrome: (c: ChromeId) => void;
  setDualMode: (v: boolean) => void;
  applyRemote: (s: { palette: PaletteId; chrome: ChromeId; topChrome: ChromeId; dualMode: boolean }) => void;
};

const ThemeContext = createContext<Ctx>({
  theme: "light",
  palette: FVI_FACTORY_PRESET.palette,
  chrome: FVI_FACTORY_PRESET.chrome,
  topChrome: FVI_FACTORY_PRESET.topChrome,
  dualMode: false,
  toggle: () => {},
  setMode: () => {},
  setPalette: () => {},
  setChrome: () => {},
  setTopChrome: () => {},
  setDualMode: () => {},
  applyRemote: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [palette, setPaletteState] = useState<PaletteId>(FVI_FACTORY_PRESET.palette);
  const [chrome, setChromeState] = useState<ChromeId>(FVI_FACTORY_PRESET.chrome);
  const [topChrome, setTopChromeState] = useState<ChromeId>(FVI_FACTORY_PRESET.topChrome);
  const [dualMode, setDualModeState] = useState<boolean>(false);

  // Hydrate from storage
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPaletteState(normalizePaletteId(localStorage.getItem("fvi-palette")));
    setChromeState(normalizeChromeId(localStorage.getItem("fvi-chrome")));
    setTopChromeState(normalizeChromeId(localStorage.getItem("fvi-chrome-top")));

    const storedDual = localStorage.getItem("fvi-chrome-dual");
    if (storedDual != null) setDualModeState(storedDual === "1");

    setTheme(normalizeThemeMode(localStorage.getItem("fvi-theme")));
  }, []);

  // Apply to <html>
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-palette", palette);
    root.setAttribute("data-chrome", chrome);
    if (dualMode) {
      root.setAttribute("data-topbar", topChrome);
    } else {
      root.removeAttribute("data-topbar");
    }
    try {
      localStorage.setItem("fvi-theme", theme);
      localStorage.setItem("fvi-palette", palette);
      localStorage.setItem("fvi-chrome", chrome);
      localStorage.setItem("fvi-chrome-top", topChrome);
      localStorage.setItem("fvi-chrome-dual", dualMode ? "1" : "0");
    } catch {}
  }, [theme, palette, chrome, topChrome, dualMode]);

  const setMode = (mode: ThemeMode) => setTheme(mode);
  const setPalette = (p: PaletteId) => setPaletteState(p);
  const setChrome = (c: ChromeId) => setChromeState(c);
  const setTopChrome = (c: ChromeId) => setTopChromeState(c);
  const setDualMode = (v: boolean) => setDualModeState(v);
  const applyRemote: Ctx["applyRemote"] = (s) => {
    setPaletteState(normalizePaletteId(s.palette));
    setChromeState(normalizeChromeId(s.chrome));
    setTopChromeState(normalizeChromeId(s.topChrome));
    setDualModeState(s.dualMode);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme, palette, chrome, topChrome, dualMode,
        toggle: () => setMode(theme === "dark" ? "light" : "dark"),
        setMode, setPalette, setChrome, setTopChrome, setDualMode, applyRemote,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
