import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { BackButton } from "@/components/back-button";

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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: "https://app-fvi.reconiq.example/developers" }],
  }),
  component: DevelopersLayout,
});

function DevelopersLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fvi-marketing-header sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <FviApprovedLogo className="h-11 w-11 rounded-sm" />
            <span className="font-display text-sm font-semibold">ReconIQ · Developers</span>
          </Link>
          <nav className="hidden items-center gap-5 text-xs text-muted-foreground md:flex">
            <Link to="/developers" activeOptions={{ exact: true }} activeProps={{ className: "text-foreground font-medium" }} className="hover:text-foreground">Overview</Link>
            <Link to="/developers/api-reference" activeProps={{ className: "text-foreground font-medium" }} className="hover:text-foreground">API Reference</Link>
            <Link to="/developers/guides" activeProps={{ className: "text-foreground font-medium" }} className="hover:text-foreground">Guides</Link>
            <Link to="/developers/changelog" activeProps={{ className: "text-foreground font-medium" }} className="hover:text-foreground">Changelog</Link>
            <Link to="/security" className="hover:text-foreground">Security</Link>
          </nav>
          <BackButton fallbackTo="/" label="Back" className="fvi-marketing-header-back text-xs" />
        </div>
      </header>
      <Outlet />
      <footer className="border-t border-border/60 mt-24">
        <div className="mx-auto max-w-7xl px-6 py-8 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} ReconIQ · API v4.0 · OpenAPI 3.1</span>
          <span>
            Contact <a href="mailto:developers@reconiq.example" className="underline">developers@reconiq.example</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
