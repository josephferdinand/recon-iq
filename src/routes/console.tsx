import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { postLoginLanding } from "@/lib/auth-landing.functions";
import { recordAudit } from "@/lib/audit.functions";
import { recordAccessDenied } from "@/lib/access-audit.functions";
import {
  requestPlatformRole,
  listMyPlatformRoleRequests,
  cancelPlatformRoleRequest,
} from "@/lib/platform-role-requests.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck, LayoutDashboard, Palette, ArrowRight, LogOut, Loader2, Sparkles, Building2, Lock, Send, XCircle, CheckCircle2, Clock } from "lucide-react";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";

/**
 * Post-login chooser presented to Platform Owners only.
 *
 * Deep-link / auto-skip behavior:
 *   - `?to=mkt` → jump straight to /mkt-admin (Platform Super Admins only;
 *     others see the restricted fallback card).
 *   - `?to=fvi` → jump straight to the resolved ReconIQ landing path.
 *   - `?force=1` → always show the chooser, even when auto-skip would apply.
 *   - `?remember=1` (with `to=…`) → persist the choice in localStorage so
 *     subsequent visits auto-skip to the same destination.
 *   - Platform admins WITHOUT super-admin access and with a resolved tenant
 *     workspace (single viable destination) are auto-routed to ReconIQ.
 *   - Non-platform-admins are bounced straight to their ReconIQ landing path.
 */

const SKIP_KEY = "fvi.console.skip";
const SearchSchema = z.object({
  to: z.enum(["mkt", "fvi"]).optional(),
  force: z.coerce.boolean().optional(),
  remember: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/console")({
  ssr: false,
  validateSearch: (raw) => SearchSchema.parse(raw ?? {}),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { redirect: "/console" } });
  },
  component: ConsoleChooser,
});

function ConsoleChooser() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const landingFn = useServerFn(postLoginLanding);
  const auditFn = useServerFn(recordAudit);
  const denyFn = useServerFn(recordAccessDenied);
  const deniedLoggedRef = useRef(false);

  const landingQ = useQuery({
    queryKey: ["console", "post-login"],
    queryFn: () => landingFn({ data: { skip_chooser: true } }),
  });

  const [busy, setBusy] = useState<null | "mkt" | "fvi">(null);
  const autoRoutedRef = useRef(false);

  const isPlatformAdmin = Boolean(landingQ.data?.isPlatformAdmin);
  const isPlatformSuperAdmin = Boolean((landingQ.data as any)?.isPlatformSuperAdmin);
  const fviPath = landingQ.data?.path ?? "/home";
  const hasResolvedTenant = Boolean(landingQ.data?.path && landingQ.data.path !== "/home");

  // Auto-skip resolver — runs once landing data is ready.
  useEffect(() => {
    if (!landingQ.data || autoRoutedRef.current) return;

    // Non-platform admins never see the chooser.
    if (!isPlatformAdmin) {
      autoRoutedRef.current = true;
      navigate({ to: fviPath as never, replace: true });
      return;
    }

    if (search.force) return; // explicit override — always show chooser

    const persisted = typeof window !== "undefined" ? window.localStorage.getItem(SKIP_KEY) : null;
    const target = search.to ?? (persisted === "mkt" || persisted === "fvi" ? persisted : null);

    // Explicit deep-link `?to=mkt`
    if (target === "mkt" && isPlatformSuperAdmin) {
      autoRoutedRef.current = true;
      if (search.remember && typeof window !== "undefined") window.localStorage.setItem(SKIP_KEY, "mkt");
      auditFn({ data: {
        scope: "platform", action: "console.chooser.auto_skip",
        resource_type: "console_target", resource_id: "mkt-admin",
        context: { target: "mkt-admin", path: "/mkt-admin", reason: search.to ? "deeplink" : "remembered" },
      } }).catch(() => {});
      navigate({ to: "/mkt-admin", replace: true });
      return;
    }

    // Explicit deep-link `?to=fvi`
    if (target === "fvi") {
      autoRoutedRef.current = true;
      if (search.remember && typeof window !== "undefined") window.localStorage.setItem(SKIP_KEY, "fvi");
      auditFn({ data: {
        scope: "platform", action: "console.chooser.auto_skip",
        resource_type: "console_target", resource_id: "fvi-console",
        context: { target: "fvi-console", path: fviPath, reason: search.to ? "deeplink" : "remembered" },
      } }).catch(() => {});
      navigate({ to: fviPath as never, replace: true });
      return;
    }

    // Single viable destination: platform admin without super-admin access
    // AND with a resolved tenant → nothing to choose, skip to ReconIQ.
    if (!isPlatformSuperAdmin && hasResolvedTenant) {
      autoRoutedRef.current = true;
      auditFn({ data: {
        scope: "platform", action: "console.chooser.auto_skip",
        resource_type: "console_target", resource_id: "fvi-console",
        context: { target: "fvi-console", path: fviPath, reason: "single_viable_destination" },
      } }).catch(() => {});
      navigate({ to: fviPath as never, replace: true });
    }
  }, [landingQ.data, isPlatformAdmin, isPlatformSuperAdmin, hasResolvedTenant, fviPath, search.to, search.force, search.remember, navigate, auditFn]);

  if (landingQ.isLoading || autoRoutedRef.current || !isPlatformAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading your workspaces…
      </div>
    );
  }

  const goMkt = () => {
    if (!isPlatformSuperAdmin) return;
    setBusy("mkt");
    auditFn({ data: {
      scope: "platform",
      action: "console.chooser.select",
      resource_type: "console_target",
      resource_id: "mkt-admin",
      context: { target: "mkt-admin", path: "/mkt-admin", selected_at: new Date().toISOString() },

    } }).catch(() => {});
    navigate({ to: "/mkt-admin", replace: true });
  };
  const goFvi = () => {
    setBusy("fvi");
    auditFn({ data: {
      scope: "platform",
      action: "console.chooser.select",
      resource_type: "console_target",
      resource_id: "fvi-console",
      context: { target: "fvi-console", path: fviPath, selected_at: new Date().toISOString() },
    } }).catch(() => {});
    navigate({ to: fviPath as never, replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-background via-background to-muted/40">
      {/* Ambient brand halo */}
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--brand-gold, hsl(var(--primary))), transparent)" }} />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between border-b border-border/60 bg-background/60 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <FviApprovedLogo className="h-8 w-8 rounded-sm" />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">ReconIQ</div>
            <div className="font-display text-sm font-semibold">Platform Owner Console</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> Platform admin</Badge>
          <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/auth"); }}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 py-16">
        <div className="mb-12 max-w-2xl text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3 w-3" /> You're signed in as a Platform Owner
          </div>
          <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Where would you like to go?
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            You have access to both consoles. Pick one — you can switch anytime from the profile menu.
          </p>
        </div>

        <div className="grid w-full gap-6 md:grid-cols-2">
          {/* Marketing / Public Site Admin — Platform Super Admins only */}
          {isPlatformSuperAdmin ? (
            <button
              type="button"
              onClick={goMkt}
              disabled={busy !== null}
              aria-label="Open Marketing and Public Site Admin Console"
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-8 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/60 hover:shadow-xl disabled:cursor-wait disabled:opacity-70"
            >
              <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-fuchsia-500/25 to-primary/10 blur-2xl transition-opacity group-hover:opacity-100" />
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Palette className="h-6 w-6" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-2xl font-semibold">Marketing / Public Site Admin</h2>
                {busy === "mkt" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Manage the public reconiq.example marketing site — homepage sections, dynamic themes,
                trusted-by logos, chatbot prompts, KB sources, leads, pipeline, and marketing admin roles.
              </p>
              <ul className="mt-5 space-y-1.5 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> Homepage & theme publishing</li>
                <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> Leads, appointments, CRM pipeline</li>
                <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> Chatbot KB, LLM providers, analytics</li>
              </ul>
              <div className="mt-8 flex items-center justify-between text-sm">
                <span className="font-medium text-primary">Enter marketing console</span>
                <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Marketing and Public Site Admin Console — Platform Super Admin required. Click to record a request-for-access attempt."
              onClick={() => {
                if (deniedLoggedRef.current) {
                  toast.info("Access denied — already logged. Use the request form below.");
                  return;
                }
                deniedLoggedRef.current = true;
                denyFn({ data: {
                  surface: "console.card.mkt-admin",
                  reason: "not_platform_super_admin",
                  required_role: "platform_super_admin",
                  path: typeof window !== "undefined" ? window.location.pathname : "/console",
                  context: { via: "console_card_click" },
                } }).catch(() => {});
                toast.warning("Access denied — this console requires Platform Super Admin. The attempt has been recorded.");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  (e.currentTarget as HTMLElement).click();
                }
              }}
              className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-dashed border-border/70 bg-muted/40 p-8 text-left shadow-sm transition hover:border-amber-500/50"
            >
              <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-muted-foreground/10 blur-2xl" />
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Lock className="h-6 w-6" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-2xl font-semibold">Marketing / Public Site Admin</h2>
                <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-600">
                  <Lock className="h-3 w-3" /> Restricted
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Your role:</span>
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="h-3 w-3" /> platform_admin
                  <span className="text-muted-foreground">(Platform Admin)</span>
                </Badge>
                <span className="text-muted-foreground">Required:</span>
                <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-600">
                  <Lock className="h-3 w-3" /> platform_super_admin
                  <span className="opacity-80">(Platform Super Admin)</span>
                </Badge>
              </div>

              <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">Why you're blocked.</strong> The Marketing / Public
                  Site Admin console manages the public reconiq.example marketing site, brand themes,
                  ReconIQ Copilot chatbot policy, CRM pipeline, and lead data. These surfaces sit outside
                  tenant isolation and can affect every visitor and prospect, so they are gated behind
                  the elevated <strong>platform_super_admin</strong> tier — a strict superset of your
                  current <strong>platform_admin</strong> role. Every click on this card is written to
                  the immutable audit trail (<code className="rounded bg-muted px-1">access.denied</code>,
                  resource <code className="rounded bg-muted px-1">console.card.mkt-admin</code>).
                </p>

                <div className="rounded-md border border-border/60 bg-background/60 p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                    How to get elevated
                  </div>
                  <ol className="list-decimal space-y-1 pl-5 text-xs">
                    <li>
                      Click <strong>Request access</strong> below and paste a business justification
                      (min. 10 chars: what you need to do, for how long, and why now).
                    </li>
                    <li>
                      Your request is routed to every active <strong>Platform Super Admin</strong>
                      and logged (<code className="rounded bg-muted px-1">platform_role_request.create</code>).
                    </li>
                    <li>
                      If it's urgent, ping a Super Admin directly at{" "}
                      <a
                        href="mailto:platform-superadmins@reconiq.example?subject=Platform%20Super%20Admin%20elevation%20request"
                        className="underline underline-offset-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        platform-superadmins@reconiq.example
                      </a>{" "}
                      or in the <code className="rounded bg-muted px-1">#platform-access</code> Slack
                      channel and reference your submitted request ID.
                    </li>
                    <li>
                      On approval you'll be granted <code className="rounded bg-muted px-1">platform_super_admin</code>{" "}
                      automatically — reload this page and the card unlocks.
                    </li>
                  </ol>
                </div>
              </div>

              <div className="mt-5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <RequestSuperAdminAccess />
              </div>
            </div>
          )}

          {/* ReconIQ Console */}
          <button
            type="button"
            onClick={goFvi}
            disabled={busy !== null}
            aria-label="Open ReconIQ Console"
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-8 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/60 hover:shadow-xl disabled:cursor-wait disabled:opacity-70"
          >
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-emerald-500/25 to-primary/10 blur-2xl transition-opacity group-hover:opacity-100" />
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LayoutDashboard className="h-6 w-6" />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl font-semibold">ReconIQ Console</h2>
              {busy === "fvi" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The reconciliation product — tenants, recon runs, breaks, matches, master data,
              AI governance, audit, security, and platform administration.
            </p>
            <ul className="mt-5 space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><Building2 className="h-3 w-3 text-primary" /> Platform, tenant & security admin</li>
              <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> Recon engine, breaks, matching</li>
              <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> AI Copilot, governance, observability</li>
            </ul>
            <div className="mt-8 flex items-center justify-between text-sm">
              <span className="font-medium text-primary">Enter ReconIQ console</span>
              <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
            </div>
          </button>
        </div>

        <p className="mt-10 max-w-lg text-center text-xs text-muted-foreground">
          Tip: bookmark <code className="rounded bg-muted px-1 py-0.5">/console</code> to land here every time,
          or go directly to <code className="rounded bg-muted px-1 py-0.5">/mkt-admin</code> or your tenant workspace.
        </p>
      </main>
    </div>
  );
}

/* ---------------- Self-serve Super Admin request ---------------- */

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string; Icon: any }> = {
    pending:   { label: "Pending",   className: "border-amber-500/60 text-amber-600",       Icon: Clock },
    approved:  { label: "Approved",  className: "border-emerald-500/60 text-emerald-600",   Icon: CheckCircle2 },
    denied:    { label: "Denied",    className: "border-destructive/60 text-destructive",   Icon: XCircle },
    cancelled: { label: "Cancelled", className: "border-muted-foreground/40 text-muted-foreground", Icon: XCircle },
  };
  const m = map[status] ?? map.pending;
  const Icon = m.Icon;
  return (
    <Badge variant="outline" className={`gap-1 ${m.className}`}>
      <Icon className="h-3 w-3" /> {m.label}
    </Badge>
  );
}

function RequestSuperAdminAccess() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyPlatformRoleRequests);
  const submitFn = useServerFn(requestPlatformRole);
  const cancelFn = useServerFn(cancelPlatformRoleRequest);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const listQ = useQuery({
    queryKey: ["my-platform-role-requests"],
    queryFn: () => listFn(),
  });

  const rows = (listQ.data ?? []) as any[];
  const superAdminRows = rows.filter((r) => r.requested_role === "platform_super_admin");
  const pending = superAdminRows.find((r) => r.status === "pending");
  const latestDecided = superAdminRows.find((r) => r.status !== "pending");

  const mSubmit = useMutation({
    mutationFn: () => submitFn({ data: { requested_role: "platform_super_admin", reason: reason.trim() } }),
    onSuccess: () => {
      toast.success("Access request submitted. A Platform Super Admin will review it shortly.");
      setOpen(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["my-platform-role-requests"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to submit request"),
  });

  const mCancel = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { request_id: id } }),
    onSuccess: () => {
      toast.success("Request cancelled");
      qc.invalidateQueries({ queryKey: ["my-platform-role-requests"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to cancel"),
  });

  return (
    <div className="rounded-md border border-border/60 bg-background/60 p-3 text-xs text-muted-foreground">
      <div className="mb-2 text-sm font-medium text-foreground">Request Platform Super Admin access</div>
      <p>
        Submit a self-serve request with justification. An existing Platform Super Admin will approve or
        deny it. Every request and decision is written to the audit log.
      </p>

      {pending ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          <div className="flex items-center gap-2">
            {statusBadge(pending.status)}
            <span className="text-muted-foreground">
              Submitted {new Date(pending.created_at).toLocaleString()}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={mCancel.isPending}
            onClick={() => mCancel.mutate(pending.id)}
          >
            {mCancel.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <XCircle className="mr-1 h-3 w-3" />}
            Cancel request
          </Button>
        </div>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="mt-3">
              <Send className="mr-2 h-3.5 w-3.5" /> Request access
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Platform Super Admin</DialogTitle>
              <DialogDescription>
                Tell reviewers why you need elevated access. Be specific — this is recorded in the audit log.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="req-reason">Business justification</Label>
              <Textarea
                id="req-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Covering for our current Super Admin during PTO to publish theme changes and manage CRM leads."
                rows={5}
                maxLength={2000}
              />
              <div className="text-right text-xs text-muted-foreground">
                {reason.trim().length}/2000 (min 10)
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => mSubmit.mutate()}
                disabled={reason.trim().length < 10 || mSubmit.isPending}
              >
                {mSubmit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {!pending && latestDecided ? (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {statusBadge(latestDecided.status)}
          <span className="text-muted-foreground">
            Last decided {new Date(latestDecided.decided_at ?? latestDecided.created_at).toLocaleString()}
            {latestDecided.decision_note ? ` — "${latestDecided.decision_note}"` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
