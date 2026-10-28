/**
 * Shortcut registry — single source of truth for keyboard shortcuts.
 *
 * Consumed by:
 *  - `src/hooks/use-keyboard-shortcuts.tsx` (global handler)
 *  - `src/components/keyboard-shortcuts-dialog.tsx` (cheat sheet)
 *  - `src/components/command-palette.tsx` (hints)
 *  - `docs/96_phase2_ux_design_system_v2.md` (documentation)
 */

export type ShortcutScope = "global" | "workspace" | "console" | "settings";

export interface Shortcut {
  /** Human readable label */
  label: string;
  /** Displayed key hint, e.g. "⌘K", "g d", "?" */
  keys: string;
  /** Semantic key for programmatic dispatch. */
  action: string;
  scope: ShortcutScope;
  description?: string;
}

export const SHORTCUTS: Shortcut[] = [
  { action: "palette.open", keys: "⌘K", label: "Command palette", scope: "global", description: "Search, navigate, execute" },
  { action: "help.open", keys: "⌘/", label: "Shortcuts cheat sheet", scope: "global" },
  { action: "help.open", keys: "?", label: "Shortcuts cheat sheet", scope: "global" },
  { action: "close.top", keys: "Esc", label: "Close top overlay", scope: "global" },

  { action: "go.home", keys: "g h", label: "Go home", scope: "global" },
  { action: "go.workspace", keys: "g w", label: "Workspace", scope: "global" },
  { action: "go.domain", keys: "g d", label: "Domain Console", scope: "console" },
  { action: "go.scale", keys: "g s", label: "Scale Console", scope: "console" },
  { action: "go.vertical", keys: "g v", label: "Vertical Console", scope: "console" },
  { action: "go.attestations", keys: "g a", label: "Attestations", scope: "console" },
  { action: "go.settings", keys: "g t", label: "Tenant settings", scope: "settings" },

  { action: "recons.new", keys: "n r", label: "New reconciliation", scope: "workspace" },
  { action: "breaks.open", keys: "b", label: "Open breaks", scope: "workspace" },
  { action: "exceptions.open", keys: "e", label: "Open exceptions", scope: "workspace" },
  { action: "kb.search", keys: "/", label: "Knowledge base search", scope: "workspace" },

  { action: "audit.verify", keys: "g u", label: "Audit chain verify", scope: "console" },
  { action: "breakglass.request", keys: "g b", label: "Break-glass grant", scope: "console" },
];

export function shortcutsByScope(scope: ShortcutScope): Shortcut[] {
  return SHORTCUTS.filter((s) => s.scope === scope);
}

export function shortcutFor(action: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.action === action);
}
