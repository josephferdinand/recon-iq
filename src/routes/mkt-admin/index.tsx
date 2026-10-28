import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { leadKpis } from "@/lib/mkt-leads.functions";
import { chatKpis } from "@/lib/mkt-admin.functions";
import { Badge } from "@/components/ui/badge";
import {
  Users, Flame, Snowflake, Sun, MessageSquare, DollarSign, TrendingUp, Zap,
  Building2, CalendarClock, LayoutTemplate, ArrowRight, Palette, Film, KeyRound,
  Cpu, ScrollText, ShieldCheck, GitBranch, Database, BarChart3, Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/mkt-admin/")({
  component: Dashboard,
});

const QUICK_ACTIONS = [
  { to: "/mkt-admin/homepage", label: "Homepage sections", desc: "Hero, strip, and agentic showcase copy.", icon: LayoutTemplate, tone: "from-sky-500/20 to-primary/5" },
  { to: "/mkt-admin/media", label: "Media & reels", desc: "Upload video reels, product footage, imagery.", icon: Film, tone: "from-fuchsia-500/20 to-primary/5" },
  { to: "/mkt-admin/themes", label: "Website themes", desc: "Manage tokens, approvals, and publishing.", icon: Palette, tone: "from-amber-500/20 to-primary/5" },
  { to: "/mkt-admin/site-logos", label: "Trusted-by logos", desc: "Client & partner logos with ordering.", icon: Building2, tone: "from-emerald-500/20 to-primary/5" },
  { to: "/mkt-admin/chatbot", label: "Chatbot prompts", desc: "ReconIQ Copilot system prompts & guardrails.", icon: MessageSquare, tone: "from-violet-500/20 to-primary/5" },
  { to: "/mkt-admin/appointments", label: "Appointments", desc: "Meeting types, availability, routing.", icon: CalendarClock, tone: "from-cyan-500/20 to-primary/5" },
] as const;

const PLATFORM_LINKS = [
  { to: "/mkt-admin/ai-models", label: "AI models", icon: Cpu },
  { to: "/mkt-admin/vault", label: "Secure vault", icon: KeyRound },
  { to: "/mkt-admin/users", label: "Users & roles", icon: ShieldCheck },
  { to: "/mkt-admin/audit", label: "Audit log", icon: ScrollText },
  { to: "/mkt-admin/pipeline", label: "Pipeline", icon: GitBranch },
  { to: "/mkt-admin/knowledge", label: "Knowledge base", icon: Database },
  { to: "/mkt-admin/analytics", label: "Analytics", icon: BarChart3 },
] as const;

function Dashboard() {
  const leadFn = useServerFn(leadKpis);
  const chatFn = useServerFn(chatKpis);
  const leadsQ = useQuery({ queryKey: ["mkt","kpis","leads"], queryFn: () => leadFn({ data: undefined }) });
  const chatQ = useQuery({ queryKey: ["mkt","kpis","chat"], queryFn: () => chatFn({ data: undefined }) });

  const l = leadsQ.data;
  const c = chatQ.data;

  return (
    <div className="space-y-10">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-muted/30 p-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--brand-gold, hsl(var(--primary))), transparent)" }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-primary/10 opacity-40 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground backdrop-blur">
            <Sparkles className="h-3 w-3 text-primary" /> Marketing / Public Site Admin
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            Everything that powers <span className="text-primary">reconiq.example</span>, in one console.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
            Publish homepage sections, manage themes and media reels, tune ReconIQ Copilot, and follow every lead from
            first click to signed contract. Recon platform admin lives separately in the ReconIQ Console.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/mkt-admin/homepage" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90">
              Edit homepage <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link to="/mkt-admin/leads" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-muted">
              View leads
            </Link>
            <Link to="/mkt-admin/themes" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-muted">
              Themes
            </Link>
          </div>
        </div>
      </section>

      {/* KPIs — combined leads + chat */}
      <section>
        <SectionHeader title="Today's pulse" hint="Live from leads, appointments, and ReconIQ Copilot" />
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi icon={Users} label="Total leads" value={l?.total ?? "—"} sub={l ? `${l.last7} new · 7d` : undefined} />
          <Kpi icon={Flame} label="Hot leads" value={l?.byTemp.hot ?? 0} tone="text-red-500" sub={l ? `${l.byTemp.warm ?? 0} warm` : undefined} />
          <Kpi icon={MessageSquare} label="Chat sessions" value={c?.totalSessions ?? "—"} sub={c ? `${c.totalMessages} msgs` : undefined} />
          <Kpi icon={DollarSign} label="AI spend (USD)" value={c ? (c.totalCost != null ? `$${c.totalCost.toFixed(4)}` : "Unavailable") : "—"} sub={c ? `${c.escalationRate != null ? Math.round(c.escalationRate * 100) : "—"}% escalated` : undefined} />
        </div>
      </section>

      {/* QUICK ACTIONS */}
      <section>
        <SectionHeader title="Site management" hint="Publish, curate, and monitor the public marketing site" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {QUICK_ACTIONS.map((t) => {
            const Icon = t.icon;
            return (
              <Link key={t.to} to={t.to}
                className="group relative overflow-hidden rounded-xl border border-border/60 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg">
                <div aria-hidden className={`pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-gradient-to-br ${t.tone} blur-2xl transition-opacity group-hover:opacity-100`} />
                <div className="relative">
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="font-display text-base font-semibold">{t.label}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                  <div className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Open <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* PIPELINE STRIP */}
      <section>
        <SectionHeader title="Sales pipeline" hint="Lead counts by stage" cta={{ to: "/mkt-admin/pipeline", label: "Open pipeline" }} />
        <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {(["new","qualified","meeting_scheduled","proposal","negotiation","won","lost"] as const).map((s) => (
            <div key={s} className="rounded-lg border border-border/60 bg-card p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.replace("_"," ")}</div>
              <div className="mt-1 font-display text-2xl font-semibold">{l?.byStage[s] ?? 0}</div>
            </div>
          ))}
        </div>
      </section>

      {/* RECONIQ COPILOT DETAIL */}
      <section>
        <SectionHeader title="ReconIQ Copilot (chatbot)" hint="Session, escalation & spend metrics" cta={{ to: "/mkt-admin/chatbot", label: "Prompts" }} />
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi icon={MessageSquare} label="Sessions" value={c?.totalSessions ?? "—"} />
          <Kpi icon={Zap} label="Messages" value={c?.totalMessages ?? "—"} />
          <Kpi icon={Snowflake} label="Escalation rate" value={c ? (c.escalationRate != null ? `${Math.round(c.escalationRate * 100)}%` : "—") : "—"} tone="text-sky-500" />
          <Kpi icon={Sun} label="Avg. warm/hot" value={l ? (l.byTemp.hot ?? 0) + (l.byTemp.warm ?? 0) : "—"} tone="text-amber-500" />
        </div>
      </section>

      {/* PLATFORM SHORTCUTS */}
      <section>
        <SectionHeader title="Platform" hint="Governance, AI, and infrastructure" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORM_LINKS.map((p) => {
            const Icon = p.icon;
            return (
              <Link key={p.to} to={p.to}
                className="group flex items-center justify-between rounded-lg border border-border/60 bg-card px-3.5 py-3 transition hover:border-primary/50 hover:bg-muted/40">
                <div className="flex items-center gap-2.5 text-sm font-medium">
                  <Icon className="h-4 w-4 text-primary" /> {p.label}
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ title, hint, cta }: { title: string; hint?: string; cta?: { to: string; label: string } }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {cta && (
        <Link to={cta.to} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
          {cta.label} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | string; tone?: string; sub?: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${tone ?? "text-primary"}`} />
      </div>
      <div className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
