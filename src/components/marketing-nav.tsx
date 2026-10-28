import { Link } from "@tanstack/react-router";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { Button } from "@/components/ui/button";
import { appUrl } from "@/lib/cross-domain";

const NAV = [
  { to: "/solutions", label: "Solutions" },
  { to: "/pricing", label: "Pricing" },
  { to: "/security", label: "Security" },
  { to: "/developers", label: "Developers" },
  { to: "/about", label: "Company" },
  { to: "/support", label: "Support" },
  { to: "/contact", label: "Contact" },
];

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 text-[#f5f5f7] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <FviApprovedLogo className="h-9 w-9 rounded-sm" />
          <span className="font-display text-xs font-semibold tracking-wide sm:text-sm">
            ReconIQ
          </span>
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 text-sm lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="text-[#d4d4da] transition-colors hover:text-white"
              activeProps={{ className: "text-white" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="text-[#f5f5f7] hover:bg-white/10 hover:text-white">
            <a href={appUrl("/auth")}>Sign in</a>
          </Button>
          <Button asChild size="sm" className="bg-white text-black hover:bg-white/85">
            <Link to="/book-demo" data-marketing-cta>
              Book a demo
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
