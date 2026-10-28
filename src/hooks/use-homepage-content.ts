import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  HOMEPAGE_DEFAULTS,
  getHomepageSections,
  type HomepageBundle,
  type HomepageSectionKey,
  type Json,
  type SectionContent,
} from "@/lib/mkt-homepage.functions";
import {
  applyHomepagePreview,
  useHomepagePreviewDraft,
} from "@/lib/homepage-preview";

/**
 * Fetch the current homepage section content (defaults merged with any admin overrides).
 * SSR-safe: always returns defaults synchronously while the query resolves.
 * When rendered inside a live-preview iframe (`?preview=fvi`), unsaved edits
 * broadcast from the Site admin editor are overlaid in real time.
 */
export function useHomepageContent(): HomepageBundle {
  const fn = useServerFn(getHomepageSections);
  const q = useQuery({
    queryKey: ["public", "homepage-sections"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const preview = useHomepagePreviewDraft();
  const base = (q.data as HomepageBundle | undefined) ?? HOMEPAGE_DEFAULTS;
  return applyHomepagePreview(base, preview);
}


export function pickString(
  content: SectionContent | undefined,
  key: string,
  fallback: string,
): string {
  const v: Json | undefined = content?.[key];
  return typeof v === "string" && v.trim().length > 0 ? v : fallback;
}

export function pickStringArray(
  content: SectionContent | undefined,
  key: string,
  fallback: string[],
): string[] {
  const v: Json | undefined = content?.[key];
  if (Array.isArray(v)) {
    const arr = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    return arr.length > 0 ? arr : fallback;
  }
  return fallback;
}

export type { HomepageBundle, HomepageSectionKey };
