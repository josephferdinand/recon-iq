import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BackButton } from "@/components/back-button";
import { TemplateMarketplace } from "@/components/template-marketplace";
import { getTenantBySlug } from "@/lib/tenants.functions";

export const Route = createFileRoute("/_authenticated/$slug/tenant/templates")({
  head: () => ({
    meta: [
      { title: "Template Gallery — Tenant | ReconIQ" },
      {
        name: "description",
        content:
          "Browse and install platform-certified templates into your tenant's Template Gallery — reconciliations, regulatory packs, AI agents, personas, and more.",
      },
    ],
  }),
  component: TenantMarketplacePage,
});

function TenantMarketplacePage() {
  const { slug } = Route.useParams();
  const tenantFn = useServerFn(getTenantBySlug);
  const tenantQ = useQuery({
    queryKey: ["tenant", slug],
    queryFn: () => tenantFn({ data: { slug } }),
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">
          Tenant Administration
        </p>
        <h1 className="text-3xl font-semibold">Template Gallery</h1>
        <p className="text-muted-foreground mt-1">
          Browse the platform Marketplace and install certified templates into your tenant's Template Gallery.
        </p>
      </header>
      {tenantQ.data?.id ? (
        <TemplateMarketplace scope={{ kind: "tenant", tenantId: tenantQ.data.id }} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading tenant…</p>
      )}
    </main>
  );
}
