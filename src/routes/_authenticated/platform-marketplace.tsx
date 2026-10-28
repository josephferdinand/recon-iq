import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "@/components/back-button";
import { TemplateMarketplace } from "@/components/template-marketplace";

export const Route = createFileRoute("/_authenticated/platform-marketplace")({
  head: () => ({
    meta: [
      { title: "Template Marketplace — Platform | ReconIQ" },
      {
        name: "description",
        content:
          "Publish, approve, retire, and manage reconciliation templates across every tenant.",
      },
    ],
  }),
  component: PlatformMarketplacePage,
});

function PlatformMarketplacePage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">
          Platform Administration
        </p>
        <h1 className="text-3xl font-semibold">Template Marketplace</h1>
        <p className="text-muted-foreground mt-1">
          Publish, approve (dual-control), retire, and manage the global reconciliation
          template catalog for all tenants.
        </p>
      </header>
      <TemplateMarketplace scope={{ kind: "platform" }} />
    </main>
  );
}
