import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getUiPreferences, updateUiPreferences } from "@/lib/ui-prefs.functions";

export type UiPreferences = {
  theme: "light" | "dark" | "system";
  density: "compact" | "cozy" | "comfortable";
  reduce_motion: boolean;
  high_contrast: boolean;
  sidebar_collapsed: boolean;
  keyboard_hints: boolean;
};

const STORAGE_KEY = "fvi-ui-prefs";
const DEFAULTS: UiPreferences = {
  theme: "system",
  density: "comfortable",
  reduce_motion: false,
  high_contrast: false,
  sidebar_collapsed: false,
  keyboard_hints: true,
};

function loadLocal(): UiPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function useUiPreferences() {
  const [prefs, setPrefs] = useState<UiPreferences>(loadLocal);
  const fetchPrefs = useServerFn(getUiPreferences);
  const savePrefs = useServerFn(updateUiPreferences);

  // Hydrate from server on mount
  useEffect(() => {
    let active = true;
    fetchPrefs({} as any).then((p: any) => {
      if (!active || !p) return;
      const next = { ...DEFAULTS, ...p };
      setPrefs(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    }).catch(() => { /* anonymous fallback ok */ });
    return () => { active = false; };
  }, [fetchPrefs]);

  const update = useCallback(
    (patch: Partial<UiPreferences>) => {
      setPrefs((cur) => {
        const next = { ...cur, ...patch };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
        savePrefs({ data: patch } as any).catch(() => { /* offline ok */ });
        return next;
      });
    },
    [savePrefs],
  );

  return { prefs, update };
}
