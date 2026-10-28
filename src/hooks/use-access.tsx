/**
 * Tenant-scoped access hook.
 *
 * Wraps `getMyAccess` in a React Query, exposes ergonomic predicates
 * (`has`, `hasAny`, `hasAll`) and ready-to-mount `<PermissionGate>` /
 * `<PageGate>` components.
 *
 * Platform admins are always granted; suspended members are always denied.
 */
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { getMyAccess, type AccessSnapshot } from "@/lib/access.functions";
import { logAccessDecision } from "@/lib/access-audit.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { USER_FACING_ERRORS } from "@/lib/user-facing-errors";

export function useAccess(tenantId: string | null | undefined, buId?: string | null) {
  const fetchAccess = useServerFn(getMyAccess);
  const q = useQuery<AccessSnapshot>({
    queryKey: ["my-access", tenantId, buId ?? null],
    queryFn: () =>
      fetchAccess({ data: { tenant_id: tenantId!, bu_id: buId ?? null } }),
    enabled: !!tenantId,
    staleTime: 60_000,
  });

  const set = useMemo(
    () => new Set<string>(q.data?.permission_ids ?? []),
    [q.data?.permission_ids],
  );

  return {
    access: q.data,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
    isPlatformAdmin: !!q.data?.is_platform_admin,
    tenantRole: q.data?.tenant_role ?? null,
    permissionIds: q.data?.permission_ids ?? [],
    has: (p: string | null | undefined) => !p ? true : set.has(p),
    hasAny: (ps: string[]) => ps.length === 0 || ps.some((p) => set.has(p)),
    hasAll: (ps: string[]) => ps.every((p) => set.has(p)),
  };
}

/** Inline gate: render children only if the user holds the permission. */
export function PermissionGate({
  tenantId,
  permission,
  anyOf,
  allOf,
  fallback = null,
  children,
}: {
  tenantId: string;
  permission?: string;
  anyOf?: string[];
  allOf?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const a = useAccess(tenantId);
  if (a.isLoading) return null;
  if (a.isError) return (
    <span role="alert" className="inline-flex items-center gap-2 text-sm text-warning">
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      We could not verify this action. Please try again shortly.
    </span>
  );
  const ok =
    (permission ? a.has(permission) : true) &&
    (anyOf ? a.hasAny(anyOf) : true) &&
    (allOf ? a.hasAll(allOf) : true);
  return <>{ok ? children : fallback}</>;
}

/**
 * Whole-page gate: shows a denied card when the user lacks the permission.
 * Use this around the body of a route page.
 */
export function PageGate({
  tenantId,
  permission,
  pageLabel,
  pageKey,
  scope = "workspace",
  children,
}: {
  tenantId: string;
  permission: string | null;
  pageLabel: string;
  pageKey?: string;
  scope?: "workspace" | "tenant" | "platform";
  children: ReactNode;
}) {
  const a = useAccess(tenantId);
  const logFn = useServerFn(logAccessDecision);
  const loggedKey = useRef<string | null>(null);

  const allowed = !permission || a.has(permission);

  useEffect(() => {
    if (a.isLoading || a.isError || !permission) return;
    const key = `${tenantId}|${permission}|${allowed ? "allow" : "deny"}`;
    if (loggedKey.current === key) return;
    if (!allowed) {
      loggedKey.current = key;
      // Fire-and-forget; gate UX must never depend on audit success.
      logFn({
        data: {
          tenant_id: tenantId,
          scope,
          page_key: pageKey ?? pageLabel.toLowerCase().replace(/\s+/g, "-"),
          page_label: pageLabel,
          required_permission: permission,
          decision: "deny",
        },
      }).catch(() => undefined);
    }
  }, [a.isLoading, a.isError, allowed, tenantId, permission, pageKey, pageLabel, scope, logFn]);

  if (a.isLoading) {
    return (
      <div className="animate-pulse text-sm text-foreground">Resolving access…</div>
    );
  }
  if (a.isError) {
    return (
      <Card role="alert" className="border-warning/40 bg-warning/5">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4 text-warning" aria-hidden />Access information temporarily unavailable</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">We could not verify permissions for this area. Your access has not necessarily changed.</p>
          <p className="text-muted-foreground">Please try again shortly. If the issue continues, contact support.</p>
          <Button variant="outline" size="sm" onClick={() => { void a.refetch(); }}>Retry access check</Button>
        </CardContent>
      </Card>
    );
  }
  if (allowed) return <>{children}</>;
  return (
    <Card role="alert" className="border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden /> {USER_FACING_ERRORS.access.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{USER_FACING_ERRORS.access.message}</p>
        <p className="text-muted-foreground">This area may be restricted by your role, department, tenant policy, subscription, or security settings.</p>
        <p className="text-muted-foreground">{USER_FACING_ERRORS.access.action}</p>
        <Button asChild variant="outline" size="sm"><a href="/home">Return to Home</a></Button>
      </CardContent>
    </Card>
  );
}
