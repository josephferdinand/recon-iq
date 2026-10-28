import { useEffect, useRef } from "react";

export type Shortcut = {
  /** Single key (case-insensitive) or combo like "mod+k", "shift+/", "alt+a" */
  combo: string;
  /** Human description shown in the help dialog */
  description: string;
  /** Group label for the help dialog */
  group?: string;
  /** Handler — receives the original KeyboardEvent */
  handler: (e: KeyboardEvent) => void;
  /** Run even when focus is inside an input/textarea (default false) */
  allowInInput?: boolean;
  /** Prevent default browser action (default true) */
  preventDefault?: boolean;
  /** Disable this shortcut */
  disabled?: boolean;
};

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

const normalize = (combo: string): string => {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const mods = new Set<string>();
  let key = "";
  for (const p of parts) {
    if (p === "mod" || p === "cmd" || p === "ctrl" || p === "meta") mods.add("mod");
    else if (p === "shift") mods.add("shift");
    else if (p === "alt" || p === "option") mods.add("alt");
    else key = p;
  }
  return [...["mod", "shift", "alt"].filter((m) => mods.has(m)), key].join("+");
};

const eventCombo = (e: KeyboardEvent): string => {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("mod");
  if (e.shiftKey) mods.push("shift");
  if (e.altKey) mods.push("alt");
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  if (key === "escape") key = "esc";
  return [...mods, key].join("+");
};

/**
 * Global keyboard shortcut manager. Register an array of shortcuts; they
 * are bound to window and torn down on unmount or when the array changes.
 *
 * - Inputs / textareas / contenteditable are ignored unless `allowInInput`.
 * - Combos use the `mod` token (Cmd on macOS, Ctrl elsewhere).
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const combo = eventCombo(e);
      for (const sc of ref.current) {
        if (sc.disabled) continue;
        if (normalize(sc.combo) !== combo) continue;
        if (!sc.allowInInput && isEditable(e.target)) continue;
        if (sc.preventDefault !== false) e.preventDefault();
        sc.handler(e);
        break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export const formatCombo = (combo: string): string => {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return normalize(combo)
    .split("+")
    .map((p) => {
      if (p === "mod") return isMac ? "⌘" : "Ctrl";
      if (p === "shift") return isMac ? "⇧" : "Shift";
      if (p === "alt") return isMac ? "⌥" : "Alt";
      if (p === "esc") return "Esc";
      if (p === "space") return "Space";
      if (p === "arrowup") return "↑";
      if (p === "arrowdown") return "↓";
      if (p === "arrowleft") return "←";
      if (p === "arrowright") return "→";
      return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(isMac ? "" : "+");
};
