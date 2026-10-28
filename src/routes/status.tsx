import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusPublicView } from "@/components/status-public-view";
import { EMPTY_STATUS_SNAPSHOT, getPublicStatusSnapshot, subscribeToStatus } from "@/lib/status.functions";

const snapshotQuery = () => ({
  queryKey: ["public-status-snapshot"] as const,
  queryFn: ({ signal }: { signal?: AbortSignal }) => getPublicStatusSnapshot({ signal }),
  staleTime: 30_000,
});
export const Route = createFileRoute("/status")({
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery()),
  head: () => ({ meta: [
    { title: "Status — ReconIQ" },
    { name: "description", content: "Measured ReconIQ service health, monitoring coverage, incident updates and maintenance across registered environments and regions." },
  ] }),
  component: StatusPage,
  errorComponent: () => <main className="mx-auto max-w-2xl p-10"><h1 className="text-2xl font-semibold">Status evidence unavailable</h1><p className="mt-3">We could not retrieve status evidence. Refresh shortly; unavailable data does not establish service health.</p><a className="mt-4 inline-block underline" href="/status">Refresh status</a></main>,
  notFoundComponent: () => <main className="p-10">Status page not found.</main>,
});
function StatusPage() {
  const loaderData = Route.useLoaderData();
  const query = useQuery({ ...snapshotQuery(), initialData: loaderData, refetchInterval: 30_000 });
  return <StatusPublicView snapshot={query.data ?? EMPTY_STATUS_SNAPSHOT} loading={query.isFetching}
    refresh={() => { void query.refetch(); }}
    subscribe={async (email) => { await subscribeToStatus({ data: { email, component_keys: [] } }); }} />;
}
