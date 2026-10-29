import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { RQApprovedLogo } from "@/components/rq-approved-logo";
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
    <div className="min-h-screen bg-[var(--mkt-bg)] text-[var(--mkt-text)] transition-colors duration-300">
      <header className="sticky top-0 z-30 border-b border-[var(--mkt-line)] bg-[var(--mkt-header-bg)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <RQApprovedLogo className="h-11 w-11 rounded-sm" />
            <span className="font-display text-sm font-semibold">ReconIQ · Developers</span>
          </Link>
          <nav aria-label="Developers" className="hidden items-center gap-5 text-xs text-[var(--mkt-text-2)] md:flex">
            <Link to="/developers" activeOptions={{ exact: true }} activeProps={{ className: "text-[var(--mkt-text)] font-medium" }} className="hover:text-[var(--mkt-text)]">Overview</Link>
            <Link to="/developers/api-reference" activeProps={{ className: "text-[var(--mkt-text)] font-medium" }} className="hover:text-[var(--mkt-text)]">API Reference</Link>
            <Link to="/developers/guides" activeProps={{ className: "text-[var(--mkt-text)] font-medium" }} className="hover:text-[var(--mkt-text)]">Guides</Link>
            <Link to="/developers/changelog" activeProps={{ className: "text-[var(--mkt-text)] font-medium" }} className="hover:text-[var(--mkt-text)]">Changelog</Link>
            <Link to="/security" className="hover:text-[var(--mkt-text)]">Security</Link>
          </nav>
          <BackButton fallbackTo="/" label="Back" className="border-[var(--mkt-line-strong)] bg-transparent text-xs text-[var(--mkt-text)] hover:border-[var(--mkt-line-strong)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]" />
        </div>
      </header>
      <Outlet />
      <div className="mt-24">
        <MarketingFooter />
      </div>
    </div>
  );
}
