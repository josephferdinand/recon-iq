/** Keep the current page while a new query loads; clamp only after a real result. */
export function pageWithinLoadedResult(page: number, totalPages: number, loaded: boolean): number {
  if (!loaded) return page;
  return Math.min(page, Math.max(totalPages, 1));
}
