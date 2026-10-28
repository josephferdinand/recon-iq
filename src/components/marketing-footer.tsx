import { Link } from "@tanstack/react-router";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { appUrl } from "@/lib/cross-domain";

const COLUMNS: { heading: string; links: { label: string; to?: string; href?: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Solutions", to: "/solutions" },
      { label: "Pricing", to: "/pricing" },
      { label: "Security", to: "/security" },
      { label: "Developers", to: "/developers" },
      { label: "ROI calculator", to: "/roi" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Contact", to: "/contact" },
      { label: "Book a demo", to: "/book-demo" },
      { label: "Request invite", to: "/request-invite" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Support center", to: "/support" },
      { label: "System status", to: "/status" },
      { label: "Enterprise FAQ", to: "/enterprise-faq" },
      { label: "Due diligence", to: "/due-diligence" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", to: "/privacy" },
      { label: "Data retention", to: "/retention" },
      { label: "Terms", to: "/legal" },
      { label: "Sign in", href: appUrl("/auth") },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-black text-[#f5f5f7]">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Link to="/" className="flex items-center gap-2.5">
              <FviApprovedLogo className="h-9 w-9 rounded-md" />
              <span className="font-display text-sm font-semibold tracking-wide">ReconIQ</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[#a1a1a6]">
              AI-assisted reconciliation for finance teams — deterministic matching,
              human-approved break resolution, and a hash-chained audit trail.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.to ? (
                      <Link to={l.to} className="text-sm text-[#d4d4da] transition-colors hover:text-white">
                        {l.label}
                      </Link>
                    ) : (
                      <a href={l.href} className="text-sm text-[#d4d4da] transition-colors hover:text-white">
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs leading-relaxed text-[#86868b] md:flex-row md:items-center md:justify-between">
          <p>© 2026 ReconIQ. All rights reserved.</p>
          <p className="max-w-xl">
            Security controls are designed with reference to SOC 2 and ISO 27001 frameworks.
            Formal certifications are on the roadmap — we don&apos;t claim certifications we
            haven&apos;t earned.
          </p>
        </div>
      </div>
    </footer>
  );
}
