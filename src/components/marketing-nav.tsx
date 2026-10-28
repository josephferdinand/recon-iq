import { Link } from "@tanstack/react-router";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { Button } from "@/components/ui/button";
import { appUrl } from "@/lib/cross-domain";

const NAV = [
  { to: "/", label: "Platform" },
  { to: "/contact", label: "Contact" },
  { to: "/book-demo", label: "Book a demo" },
];

export function MarketingNav() {
  return (
    <header className="fvi-marketing-header sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <FviApprovedLogo className="h-9 w-9 rounded-sm" />
          <span className="font-display text-xs font-semibold tracking-wide text-[color:var(--brand-cream)] sm:text-sm">
            ReconIQ
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm md:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="text-foreground transition-colors hover:text-primary"
              activeProps={{ className: "text-foreground" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="text-foreground">
            <a href={appUrl("/auth")}>Sign in</a>
          </Button>
          <Button asChild size="sm">
            <Link to="/book-demo" data-marketing-cta>
              Book a demo
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
