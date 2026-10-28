/**
 * RailAccordion — shared single-open accordion state for a sidebar.
 *
 * Coordinates every collapsible section (SidebarSection + LeftRail groups)
 * inside one AppShell so exactly one group can be open at a time. Opening
 * a new group collapses whichever was previously open. Clicking the open
 * group collapses it (leaving none expanded).
 *
 * Persisted per-scope in localStorage so the choice survives navigation.
 * When no provider is mounted, `useRailAccordion` returns null and
 * consumers fall back to their previous non-coordinated behavior.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Ctx = {
  openId: string | null;
  setOpen: (id: string | null) => void;
  toggle: (id: string) => void;
  isOpen: (id: string) => boolean;
};

const RailAccordionContext = createContext<Ctx | null>(null);

export function RailAccordionProvider({
  scope,
  initialOpenId,
  children,
}: {
  scope: string;
  initialOpenId?: string | null;
  children: ReactNode;
}) {
  const storageKey = `fvi.rail.accordion.${scope}`;
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof window === "undefined") return initialOpenId ?? null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return initialOpenId ?? null;
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" || parsed === null ? parsed : initialOpenId ?? null;
    } catch {
      return initialOpenId ?? null;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(openId));
    } catch {
      /* storage disabled — non-fatal */
    }
  }, [openId, storageKey]);

  const setOpen = useCallback((id: string | null) => setOpenId(id), []);
  const toggle = useCallback(
    (id: string) => setOpenId((prev) => (prev === id ? null : id)),
    [],
  );
  const isOpen = useCallback((id: string) => openId === id, [openId]);

  const value = useMemo<Ctx>(
    () => ({ openId, setOpen, toggle, isOpen }),
    [openId, setOpen, toggle, isOpen],
  );

  return (
    <RailAccordionContext.Provider value={value}>{children}</RailAccordionContext.Provider>
  );
}

export function useRailAccordion(): Ctx | null {
  return useContext(RailAccordionContext);
}
