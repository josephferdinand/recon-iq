import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings,
  X,
  LayoutDashboard,
  Users,
  Mail,
  MessageSquare,
  BookOpen,
  Cpu,
  BarChart3,
  CalendarClock,
  ImageIcon,
  GitBranch,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * ReconIQ Inline Admin Console
 *
 * Floating, opt-in admin launcher rendered on the public landing page.
 * - Only visible to authenticated users (any signed-in session).
 * - Server-side authorisation still enforced by mkt-admin routes / RLS.
 * - Purely a convenience shortcut to /mkt-admin/* editors.
 */

type AdminLink = {
  to: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ADMIN_LINKS: AdminLink[] = [
  { to: "/mkt-admin",             label: "Admin home",       desc: "Overview & shortcuts",              icon: LayoutDashboard },
  { to: "/mkt-admin/homepage",    label: "Homepage sections", desc: "Hero, strip, showcase copy",       icon: GitBranch },
  { to: "/mkt-admin/site-logos",  label: "Site logos",       desc: "Trusted-by strip & brand marks",    icon: ImageIcon },
  { to: "/mkt-admin/leads",       label: "Leads",            desc: "Contact & demo requests",           icon: Mail },
  { to: "/mkt-admin/pipeline",    label: "Pipeline",         desc: "CRM stages & owners",               icon: BarChart3 },
  { to: "/mkt-admin/appointments",label: "Appointments",     desc: "Demo bookings",                     icon: CalendarClock },
  { to: "/mkt-admin/chatbot",     label: "ReconIQ Copilot",       desc: "Chatbot prompts & policy",          icon: MessageSquare },
  { to: "/mkt-admin/knowledge",   label: "Knowledge base",   desc: "RAG sources & documents",           icon: BookOpen },
  { to: "/mkt-admin/ai-models",   label: "LLM routing",      desc: "Multi-model configuration",         icon: Cpu },
  { to: "/mkt-admin/analytics",   label: "Analytics",        desc: "Site & funnel metrics",             icon: BarChart3 },
  { to: "/mkt-admin/users",       label: "Admin users",      desc: "Roles & access",                    icon: Users },
];

export function InlineAdminConsole() {
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!authed) return null;

  return (
    <div
      className="fixed z-40"
      style={{ right: "1.25rem", bottom: "5.5rem" }}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="mb-3 w-[340px] overflow-hidden rounded-2xl shadow-2xl backdrop-blur"
            style={{
              background: "color-mix(in oklab, var(--brand-coffee-deep) 88%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 28%, transparent)",
            }}
            role="dialog"
            aria-label="Site admin console"
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{
                borderBottom: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
                background: "color-mix(in oklab, var(--brand-gold) 8%, transparent)",
              }}
            >
              <div>
                <p
                  className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em]"
                  style={{ color: "var(--brand-gold)" }}
                >
                  Site admin console
                </p>
                <p
                  className="font-display text-sm font-semibold"
                  style={{ color: "var(--brand-cream)" }}
                >
                  Manage the marketing site
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close admin console"
                className="rounded-md p-1 transition hover:brightness-125"
                style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ul className="max-h-[60vh] overflow-y-auto p-2">
              {ADMIN_LINKS.map(({ to, label, desc, icon: Icon }) => (
                <li key={to}>
                  <Link
                    to={to}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition"
                    style={{ color: "var(--brand-cream)" }}
                    activeProps={{
                      style: {
                        background: "color-mix(in oklab, var(--brand-gold) 12%, transparent)",
                      },
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "color-mix(in oklab, var(--brand-cream) 4%, transparent)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{
                        background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                        border: "1px solid color-mix(in oklab, var(--brand-gold) 28%, transparent)",
                        color: "var(--brand-gold)",
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold">{label}</span>
                      <span
                        className="block text-[11px]"
                        style={{ color: "color-mix(in oklab, var(--brand-cream) 60%, transparent)" }}
                      >
                        {desc}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <p
              className="px-4 pb-3 pt-1 text-[10px]"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 50%, transparent)" }}
            >
              Access is enforced server-side. Non-admin sessions will be denied by the target editor.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Open site admin console"
        className="flex items-center gap-2 rounded-full px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.18em] shadow-lg transition hover:brightness-110"
        style={{
          background: "color-mix(in oklab, var(--brand-gold) 20%, var(--brand-coffee-deep))",
          border: "1px solid color-mix(in oklab, var(--brand-gold) 45%, transparent)",
          color: "var(--brand-cream)",
        }}
      >
        <Settings className="h-4 w-4" style={{ color: "var(--brand-gold)" }} />
        {open ? "Close admin" : "Admin console"}
      </button>
    </div>
  );
}
