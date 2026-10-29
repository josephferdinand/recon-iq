import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Menu, Moon, Sun, X } from "lucide-react";
import { RQApprovedLogo } from "@/components/rq-approved-logo";
import { Button } from "@/components/ui/button";
import { appUrl } from "@/lib/cross-domain";
import { SOLUTIONS_NAV } from "@/components/solution-page";

type NavItem = { label: string; to: string; blurb?: string };
type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Solutions",
    items: [
      ...SOLUTIONS_NAV.map((s) => ({ label: s.label, to: `/solutions/${s.slug}` })),
      { label: "All solutions", to: "/solutions", blurb: "Every workflow on one foundation" },
    ],
  },
  {
    label: "Product",
    items: [
      { label: "Pricing", to: "/pricing", blurb: "Plans for teams of every size" },
      { label: "ROI calculator", to: "/roi", blurb: "Model the break-reduction case" },
      { label: "Security", to: "/security", blurb: "Controls, honestly labelled" },
      { label: "Developers", to: "/developers", blurb: "API, sandbox and guides" },
    ],
  },
  {
    label: "Company",
    items: [
      { label: "About", to: "/about" },
      { label: "Contact", to: "/contact" },
      { label: "Book a demo", to: "/book-demo" },
      { label: "Request invite", to: "/request-invite" },
    ],
  },
  {
    label: "Resources",
    items: [
      { label: "Support center", to: "/support" },
      { label: "System status", to: "/status" },
      { label: "Enterprise FAQ", to: "/enterprise-faq" },
      { label: "Due diligence", to: "/due-diligence" },
    ],
  },
];

const THEME_KEY = "reconiq-mkt-theme";

function applyTheme(light: boolean) {
  document.documentElement.classList.toggle("mkt-light", light);
  try {
    localStorage.setItem(THEME_KEY, light ? "light" : "dark");
  } catch {
    /* storage unavailable (private mode) — theme still applies for this page */
  }
}

export function MarketingNav() {
  const [light, setLight] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      stored = null;
    }
    if (stored === "light") {
      setLight(true);
      document.documentElement.classList.add("mkt-light");
    }
  }, []);

  function toggleTheme() {
    const next = !light;
    setLight(next);
    applyTheme(next);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--mkt-line)] bg-[var(--mkt-header-bg)] text-[var(--mkt-text)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
        <Link to="/" className="flex min-w-0 items-center gap-2" aria-label="ReconIQ home">
          <RQApprovedLogo className="h-9 w-9 rounded-md" />
          <span className="font-display text-xs font-semibold tracking-wide sm:text-sm">
            ReconIQ
          </span>
        </Link>

        {/* Desktop: grouped dropdown navigation */}
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {GROUPS.map((group) => (
            <div key={group.label} className="group relative">
              <button
                type="button"
                aria-haspopup="true"
                className="flex items-center gap-1 rounded-full px-3 py-2 text-sm text-[var(--mkt-text-2)] transition-colors duration-200 hover:text-[var(--mkt-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
              >
                {group.label}
                <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-180" aria-hidden />
              </button>
              <div className="invisible absolute left-1/2 top-full z-50 w-72 -translate-x-1/2 pt-2 opacity-0 transition-all duration-200 ease-out [transform:translate(-50%,6px)] group-hover:visible group-hover:opacity-100 group-hover:[transform:translate(-50%,0)] group-focus-within:visible group-focus-within:opacity-100 group-focus-within:[transform:translate(-50%,0)]">
                <div className="overflow-hidden rounded-2xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-2 shadow-[var(--mkt-shadow)]">
                  {group.items.map((item) => (
                    <Link
                      key={item.to + item.label}
                      to={item.to}
                      className="block rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-[var(--mkt-surface-2)]"
                    >
                      <span className="block text-sm font-medium text-[var(--mkt-text)]">{item.label}</span>
                      {item.blurb && (
                        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--mkt-text-3)]">{item.blurb}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={light ? "Switch to Onyx Dark theme" : "Switch to Onyx Light theme"}
            aria-pressed={light}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--mkt-text-2)] transition-colors duration-200 hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)]"
          >
            {light ? <Moon className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}
          </button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden text-[var(--mkt-text)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)] sm:inline-flex"
          >
            <a href={appUrl("/auth")}>Sign in</a>
          </Button>
          <Button
            asChild
            size="sm"
            className="bg-[var(--mkt-btn-bg)] text-[var(--mkt-btn-text)] hover:opacity-85"
          >
            <Link to="/book-demo" data-marketing-cta>
              Book a demo
            </Link>
          </Button>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--mkt-text)] transition-colors hover:bg-[var(--mkt-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)] lg:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        className={`overflow-hidden border-[var(--mkt-line)] transition-[max-height,opacity] duration-300 ease-out lg:hidden ${
          mobileOpen ? "max-h-[80vh] overflow-y-auto border-t opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav aria-label="Mobile" className="space-y-5 px-4 py-4">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">
                {group.label}
              </p>
              <ul className="mt-2 space-y-1">
                {group.items.map((item) => (
                  <li key={item.to + item.label}>
                    <Link
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className="block rounded-lg px-2 py-2 text-[15px] text-[var(--mkt-text)] transition-colors hover:bg-[var(--mkt-surface-2)]"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <a
            href={appUrl("/auth")}
            className="block rounded-lg px-2 py-2 text-[15px] font-medium text-[var(--mkt-accent)]"
          >
            Sign in
          </a>
        </nav>
      </div>
    </header>
  );
}
