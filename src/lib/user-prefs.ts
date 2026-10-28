import { useEffect, useState } from "react";

export type UserPrefs = {
  locale: "en" | "fr" | "es" | "de";
  density: "comfortable" | "compact";
  emailDigest: "off" | "daily" | "weekly";
  tourSeen: Record<string, boolean>;
  tourProgress: Record<string, number>;
};

const KEY = "fvi.prefs.v1";
const DEFAULTS: UserPrefs = {
  locale: "en",
  density: "comfortable",
  emailDigest: "off",
  tourSeen: {},
  tourProgress: {},
};

export function getPrefs(): UserPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return DEFAULTS; }
}

export function setPrefs(p: Partial<UserPrefs>) {
  const next = { ...getPrefs(), ...p };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("fvi:prefs", { detail: next }));
  return next;
}

export function resetAllTours() {
  setPrefs({ tourSeen: {}, tourProgress: {} });
}

export function useUserPrefs(): [UserPrefs, (p: Partial<UserPrefs>) => void] {
  const [prefs, setState] = useState<UserPrefs>(DEFAULTS);
  useEffect(() => {
    setState(getPrefs());
    const onChange = (e: Event) => setState((e as CustomEvent).detail);
    window.addEventListener("fvi:prefs", onChange);
    return () => window.removeEventListener("fvi:prefs", onChange);
  }, []);
  return [prefs, (p) => setState(setPrefs(p))];
}
