import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccess, listMyTenants } from "@/lib/tenants.functions";
import { listMyInvitations } from "@/lib/members.functions";
import { setDefaultTenant } from "@/lib/auth-landing.functions";
import { AppShell, SidebarLink, SidebarSection } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, ShieldAlert, ArrowRight, Plus, Home, Sparkles, Pin, PinOff, Check, Mail, Eye, Shield, Activity, ShieldCheck } from "lucide-react";
import { GAP_COUNT } from "@/lib/gap-closure.registry";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
});

function envColor(env: string) {
  return env === "prod"
    ? "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-100"
    : env === "uat"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
      : "bg-muted text-foreground";
}

export function HomePage() {
  const fetchTenants = useServerFn(listMyTenants);
  const fetchAccess = useServerFn(getMyAccess);
  const persistDefault = useServerFn(setDefaultTenant);
  const fetchMyInvites = useServerFn(listMyInvitations);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const tenantsQ = useQuery({
    queryKey: ["my-tenants"],
    queryFn: () => fetchTenants(),
  });
  const tenants = tenantsQ.data ?? [];
  const accessQ = useQuery({
    queryKey: ["my-access"],
    queryFn: () => fetchAccess(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => fetchMyInvites(),
  });

  const [userId, setUserId] = useState<string | null>(null);
  const isPlatformAdmin = !!accessQ.data?.is_platform_admin;
  const isPlatformMember = !!accessQ.data?.is_platform_member;
  const accessUnavailable = tenantsQ.isError || accessQ.isError;
  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => {
      if (!u.user) return;
      setUserId(u.user.id);
    });
  }, []);

  const defaultTenantQ = useQuery({
    queryKey: ["profile-default-tenant", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("default_tenant_id")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.default_tenant_id as string | null) ?? null;
    },
  });
  const defaultTenantId = defaultTenantQ.data;

  const setDefault = useMutation({
    mutationFn: (tenant_id: string) => persistDefault({ data: { tenant_id } }),
    onSuccess: (_res, tenant_id) => {
      const t = tenants.find((x: any) => x.id === tenant_id);
      toast.success(t ? `${t.name} set as your default workspace` : "Default workspace updated");
      queryClient.invalidateQueries({ queryKey: ["profile-default-tenant", userId] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not save default workspace"),
  });

  const clearDefault = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("profiles").update({ default_tenant_id: null }).eq("id", userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Default workspace cleared");
      queryClient.invalidateQueries({ queryKey: ["profile-default-tenant", userId] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not clear default workspace"),
  });

  function openTenant(t: any, opts?: { remember?: boolean }) {
    if (opts?.remember && t.id !== defaultTenantId) {
      setDefault.mutate(t.id);
    }
    navigate({ to: "/$slug/workspace", params: { slug: t.slug } });
  }

  return (
    <AppShell
      title="Home"
      sidebar={
        <>
          <SidebarSection label="Account">
            <SidebarLink to="/home" icon={Home}>Home</SidebarLink>
            {isPlatformAdmin ? (
              <>
                <SidebarLink to="/platform" search={{ page: "ops-console" }} icon={Activity}>Ops console</SidebarLink>
                <SidebarLink to="/platform" search={{ page: "gap-closure" }} icon={ShieldCheck}>Gap closure ({GAP_COUNT})</SidebarLink>
              </>
            ) : null}
          </SidebarSection>
          {isPlatformAdmin ? (
            <SidebarSection label="Platform">
              <SidebarLink to="/platform" icon={ShieldAlert}>Platform admin</SidebarLink>
            </SidebarSection>
          ) : null}
          <SidebarSection label="Your tenants">
            {tenants.map((t: any) => (
              <SidebarLink key={t.id} to="/$slug/workspace" params={{ slug: t.slug }} icon={Building2}>
                {t.name}
              </SidebarLink>
            ))}
          </SidebarSection>
        </>
      }
    >
      {accessUnavailable ? (
        <Card className="mb-6 border-warning/40 bg-warning/5" role="alert">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4 text-warning" aria-hidden />Access information temporarily unavailable</CardTitle>
            <CardDescription>We could not check your platform access or workspaces. Your permissions have not necessarily changed. Please retry shortly or contact support if the issue continues.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => { void tenantsQ.refetch(); void accessQ.refetch(); }}>Retry access check</Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Your tenants</CardTitle><CardDescription>Workspaces you can access</CardDescription></CardHeader>
          <CardContent><div className="font-display text-3xl font-semibold">{tenantsQ.isSuccess ? tenants.length : "—"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>AI-enabled</CardTitle><CardDescription>Tenants with Copilot turned on</CardDescription></CardHeader>
          <CardContent><div className="font-display text-3xl font-semibold">{tenantsQ.isSuccess ? tenants.filter((t: any) => t.ai_enabled).length : "—"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Default workspace</CardTitle><CardDescription>Where future sign-ins land</CardDescription></CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            {defaultTenantQ.isError ? (
              <Badge variant="secondary">Temporarily unavailable</Badge>
            ) : defaultTenantQ.isPending ? (
              <Badge variant="secondary">Checking…</Badge>
            ) : defaultTenantId ? (
              <>
                <Badge variant="default" className="truncate">
                  {tenants.find((t: any) => t.id === defaultTenantId)?.name ?? "Selected"}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => clearDefault.mutate()}
                  disabled={clearDefault.isPending}
                  aria-label="Clear default workspace"
                >
                  <PinOff className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Badge variant="secondary">Not set — picker shown</Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {(isPlatformAdmin || isPlatformMember) ? (
        <Card className={`mt-6 ${isPlatformAdmin ? "border-primary/40 bg-primary/5" : "border-info/40 bg-info/5"}`}>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {isPlatformAdmin ? <Shield className="h-4 w-4 text-primary" /> : <Eye className="h-4 w-4 text-info" />}
              {isPlatformAdmin ? "You are a Platform Admin" : "You are a Platform Member (read-only)"}
            </CardTitle>
            <CardDescription>
              {isPlatformAdmin ? (
                <>You can view <strong>every tenant</strong> on this platform and <strong>manage</strong> tenant settings, memberships, roles, invitations, AI, entitlements, and platform configuration.</>
              ) : (
                <>You can <strong>view every tenant</strong> and its dashboards for oversight and support. You <strong>cannot</strong> create tenants, invite members, change roles, edit tenant settings, or perform any write action inside a tenant workspace. To make changes, ask a Platform Admin or a Tenant Admin to invite you into the specific tenant.</>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {pendingInvites.length > 0 ? (
        <Card className="mt-6 border-primary/40 bg-primary/5">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">You have {pendingInvites.length} pending invitation{pendingInvites.length > 1 ? "s" : ""}</CardTitle>
            </div>
            <Button size="sm" onClick={() => navigate({ to: "/accept-invite" })}>
              Review & accept <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {pendingInvites.slice(0, 3).map((i: any) => (
              <div key={i.id} className="flex items-center justify-between">
                <span>
                  <span className="font-medium">{i.tenant?.name ?? "Workspace"}</span>{" "}
                  <span className="text-muted-foreground">— {i.role}</span>
                </span>
                <span className="text-xs text-muted-foreground">expires {new Date(i.expires_at).toLocaleDateString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}


      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Tenants</h2>
          {isPlatformAdmin ? (
            <Button size="sm" onClick={() => navigate({ to: "/platform" })}><Plus className="mr-1 h-4 w-4" /> Create tenant</Button>
          ) : null}
        </div>
        {tenantsQ.isLoading || accessQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : accessUnavailable ? (
          <p className="text-sm text-muted-foreground">Access information unavailable. Retry the access check above.</p>
        ) : tenants.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-medium">Nothing To Display Yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                You do not currently have a workspace to open.
                {isPlatformAdmin ? " Create a tenant to get started." : " Contact your platform administrator to request an invitation."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {tenants.map((t: any) => {
              const isDefault = t.id === defaultTenantId;
              return (
                <Card
                  key={t.id}
                  className={`group transition hover:border-primary/50 ${isDefault ? "border-primary/60 ring-1 ring-primary/30" : ""}`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-display flex items-center gap-2">
                        {t.name}
                        {isDefault ? (
                          <Badge variant="default" className="gap-1 text-[10px]">
                            <Check className="h-3 w-3" /> Default
                          </Badge>
                        ) : null}
                      </CardTitle>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${envColor(t.environment)}`}>
                        {t.environment}
                      </span>
                    </div>
                    <CardDescription>/{t.slug} · {t.role.replace("tenant_", "")}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <Badge variant={t.ai_enabled ? "default" : "outline"}>
                      {t.ai_enabled ? "AI on" : "AI off"}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={isDefault ? "secondary" : "ghost"}
                        disabled={setDefault.isPending || isDefault}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDefault.mutate(t.id);
                        }}
                        aria-label={isDefault ? "This is your default workspace" : `Set ${t.name} as default`}
                        title={isDefault ? "Default workspace" : "Set as default"}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          openTenant(t, { remember: true });
                        }}
                        aria-label={`Open ${t.name} and remember`}
                        title="Open and remember"
                      >
                        <ArrowRight className="h-4 w-4" />
                        <span>Open</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
