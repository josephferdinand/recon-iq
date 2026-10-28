import { useEffect, useMemo, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { getPrefs, setPrefs } from "@/lib/user-prefs";
import { resolveTour } from "@/lib/tour-registry";
import { normalizeDriverAccessibility } from "@/lib/driver-accessibility";

/**
 * Topbar tour control.
 *
 * - Auto-plays the section tour once per user per section (tracked in prefs.tourSeen).
 * - Persists step progress so refresh / re-open resumes on the saved step.
 * - Replay button restarts from step 0.
 */
export function TourButton() {
  const state = useRouterState();
  const pathname = state.location.pathname;
  const search = state.location.search as Record<string, unknown>;
  const tour = useMemo(() => resolveTour(pathname, search), [pathname, search]);
  const lastAutoRef = useRef<string | null>(null);

  const saveStep = (tourId: string, idx: number) => {
    const prefs = getPrefs();
    setPrefs({ tourProgress: { ...prefs.tourProgress, [tourId]: idx } });
  };

  const clearProgress = (tourId: string) => {
    const prefs = getPrefs();
    const next = { ...prefs.tourProgress };
    delete next[tourId];
    setPrefs({ tourProgress: next });
  };

  const play = (opts: { resume: boolean; markSeen: boolean }) => {
    if (!tour) return;
    const startAt = opts.resume
      ? Math.min(getPrefs().tourProgress[tour.id] ?? 0, tour.steps.length - 1)
      : 0;

    const d: Driver = driver({
      showProgress: true,
      popoverClass: "fvi-tour",
      stagePadding: 6,
      stageRadius: 12,
      overlayOpacity: 0.55,
      smoothScroll: true,
      animate: true,
      nextBtnText: "Next →",
      prevBtnText: "← Back",
      doneBtnText: "Finish",
      steps: tour.steps,
      onPopoverRender: normalizeDriverAccessibility,
      onHighlightStarted: () => {
        normalizeDriverAccessibility();
        const idx = d.getActiveIndex();
        if (typeof idx === "number") saveStep(tour.id, idx);
      },
      onDestroyed: () => {
        const idx = d.getActiveIndex();
        const completed = typeof idx !== "number" || idx >= tour.steps.length - 1;
        if (completed) {
          clearProgress(tour.id);
          if (opts.markSeen) {
            const prefs = getPrefs();
            setPrefs({ tourSeen: { ...prefs.tourSeen, [tour.id]: true } });
          }
        }
      },
    });
    d.drive(startAt);
  };

  // Auto-play once per section per user; resume mid-tour if a step was saved.
  useEffect(() => {
    if (!tour) return;
    if (lastAutoRef.current === tour.id) return;
    lastAutoRef.current = tour.id;
    const prefs = getPrefs();
    const hasProgress = (prefs.tourProgress[tour.id] ?? 0) > 0;
    if (prefs.tourSeen[tour.id] && !hasProgress) return;
    const t = setTimeout(() => play({ resume: hasProgress, markSeen: true }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      aria-label={tour ? `Replay tour: ${tour.title}` : "Guided tour"}
      title={tour ? `Replay tour: ${tour.title}` : "No tour for this page"}
      onClick={() => play({ resume: false, markSeen: false })}
      disabled={!tour}
    >
      <HelpCircle className="h-4 w-4" />
      <span className="hidden sm:inline text-xs font-medium">Tour</span>
    </Button>
  );
}
