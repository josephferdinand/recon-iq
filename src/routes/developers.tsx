import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { BackButton } from "@/components/back-button";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/developers")({
  head: () => ({
    meta: [
      { title: "Developer Portal — ReconIQ API" },
      {
        name: "description",
        content:
          "Official ReconIQ API documentation. OpenAPI 3.1 reference, authentication, rate limits, pagination, webhooks, SDK examples, and integration guides.",
      },
      { property: "og:title", content: "ReconIQ Developer Portal" },
      {
        property: "og:description",
        content:
          "OpenAPI 3.1 spec, guides, and SDK examples for the ReconIQ reconciliation platform.",
      },
      { property: "og:url", content: "https://reconintelligence.app/developers" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/developers" }],
  }),
  component: DevelopersLayout,
});

function DevelopersLayout() {
  return (
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <FviApprovedLogo className="h-11 w-11 rounded-sm" />
            <span className="font-display text-sm font-semibold">ReconIQ · Developers</span>
          </Link>
          <nav aria-label="Developers" className="hidden items-center gap-5 text-xs text-[#a1a1a6] md:flex">
            <Link to="/developers" activeOptions={{ exact: true }} activeProps={{ className: "text-white font-medium" }} className="hover:text-white">Overview</Link>
            <Link to="/developers/api-reference" activeProps={{ className: "text-white font-medium" }} className="hover:text-white">API Reference</Link>
            <Link to="/developers/guides" activeProps={{ className: "text-white font-medium" }} className="hover:text-white">Guides</Link>
            <Link to="/developers/changelog" activeProps={{ className: "text-white font-medium" }} className="hover:text-white">Changelog</Link>
            <Link to="/security" className="hover:text-white">Security</Link>
          </nav>
          <BackButton fallbackTo="/" label="Back" className="border-white/20 bg-transparent text-xs text-[#f5f5f7] hover:border-white/40 hover:bg-white/10 hover:text-white" />
        </div>
      </header>
      <Outlet />
      <div className="mt-24">
        <MarketingFooter />
      </div>
    </div>
  );
}
