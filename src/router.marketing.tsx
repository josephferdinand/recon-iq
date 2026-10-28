// LL-046: marketing-only router that imports from the filtered route tree.
// The app build keeps `src/router.tsx` (which imports `./routeTree.gen` —
// the full 654-route tree). The marketing build points its server entry at
// this file so the filtered `routeTree.marketing.gen` is used instead.
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.marketing.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
}
