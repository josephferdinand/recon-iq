import { useEffect } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { getPrefs, setPrefs } from "@/lib/user-prefs";
import { normalizeDriverAccessibility } from "@/lib/driver-accessibility";

type TourStep = {
  element?: string;
  popover: {
    title: string;
    description: string;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";

  };
};

export function GuidedTour({ tourId, steps, auto = true }: {
  tourId: string;
  steps: TourStep[];
  auto?: boolean;
}) {

  useEffect(() => {
    if (!auto) return;
    const seen = getPrefs().tourSeen[tourId];
    if (seen) return;
    const id = setTimeout(() => {
      const d = driver({
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
        steps,
        onPopoverRender: normalizeDriverAccessibility,
        onDestroyed: () => setPrefs({ tourSeen: { ...getPrefs().tourSeen, [tourId]: true } }),
      });
      d.drive();
    }, 400);
    return () => clearTimeout(id);
  }, [tourId, auto, steps]);
  return null;
}

export function startTour(steps: { element?: string; popover: { title: string; description: string } }[]) {
  driver({
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
    steps,
    onPopoverRender: normalizeDriverAccessibility,
  }).drive();
}
