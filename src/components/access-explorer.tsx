/**
 * Access Explorer — verification UI for the RBAC matrix.
 *
 * Lets an operator pick a tenant member (or themselves) and a Business Unit
 * scope, then renders three views:
 *   1. Identity card — role + group memberships + platform-admin flag
 *   2. Permission matrix — every catalog permission with allow/deny + sources
 *   3. Page coverage — every workspace/tenant page with required permission
 *      and live outcome (allowed / denied / not applicable)
 *
 * Non-admins can only inspect themselves; tenant admins / platform admins can
 * inspect any tenant member. All resolution happens server-side through the
 * `getMyAccess` / `explainUserAccess` server functions.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyAccess,
  explainUserAccess,
  listInspectableMembers,
  listAccessLookups,
  type AccessSnapshot,
} from "@/lib/access.functions";
import { WORKSPACE_PAGES, TENANT_PAGES, type PageDef } from "@/lib/page-permissions";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, Search, ShieldCheck, ShieldAlert, Users, Layers, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { logAccessDecision } from "@/lib/access-audit.functions";

type Mode = "self" | "other";

export function AccessExplorer({ tenantId }: { tenantId: string }) {
  const me = useAccess(tenantId);
  const isAdminViewer = me.isPlatformAdmin || me.tenantRole === "tenant_admin";

  const fetchMine = useServerFn(getMyAccess);
  const fetchOther = useServerFn(explainUserAccess);
  const fetchMembers = useServerFn(listInspectableMembers);
  const fetchLookups = useServerFn(listAccessLookups);

  const [mode, setMode] = useState<Mode>("self");
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [buId, setBuId] = useState<string>("__root");
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<string>("__all");

  const lookupsQ = useQuery({
    queryKey: ["access-lookups", tenantId],
    queryFn: () => fetchLookups({ data: { tenant_id: tenantId } }),
    staleTime: 60_000,
  });

  const membersQ = useQuery({
    queryKey: ["access-members", tenantId],
    queryFn: () => fetchMembers({ data: { tenant_id: tenantId } }),
    enabled: isAdminViewer,
    staleTime: 30_000,
  });

  const buEffective = buId === "__root" ? null : buId;

  const snapshotQ = useQuery<AccessSnapshot>({
    queryKey: ["access-snapshot", tenantId, mode, targetUserId, buEffective],
    queryFn: () =>
      mode === "self" || !targetUserId
        ? fetchMine({ data: { tenant_id: tenantId, bu_id: buEffective } })
        : fetchOther({
            data: { tenant_id: tenantId, user_id: targetUserId, bu_id: buEffective },
          }),
    enabled: !!tenantId && (mode === "self" || !!targetUserId),
  });

  const snap = snapshotQ.data;
  const grantedSet = useMemo(
    () => new Set<string>(snap?.permission_ids ?? []),
    [snap?.permission_ids],
  );
  const sourcesByPerm = useMemo(() => {
    const map: Record<string, AccessSnapshot["sources"]> = {};
    for (const s of snap?.sources ?? []) {
      (map[s.permission_id] ||= []).push(s);
    }
    return map;
  }, [snap?.sources]);

  const rolesById = useMemo(
    () => Object.fromEntries((lookupsQ.data?.roles ?? []).map((r: any) => [r.id, r])),
    [lookupsQ.data],
  );
  const groupsById = useMemo(
    () => Object.fromEntries((lookupsQ.data?.groups ?? []).map((g: any) => [g.id, g])),
    [lookupsQ.data],
  );

  const permissions = lookupsQ.data?.permissions ?? [];
  const categories = useMemo(
    () => Array.from(new Set(permissions.map((p: any) => p.category as string))).sort(),
    [permissions],
  );
  const filteredPerms = useMemo(() => {
    const f = filter.toLowerCase();
    return permissions.filter((p: any) => {
      if (category !== "__all" && p.category !== category) return false;
      if (!f) return true;
      return (
        p.id.toLowerCase().includes(f) ||
        (p.description ?? "").toLowerCase().includes(f)
      );
    });
  }, [permissions, filter, category]);

  const grantedCount = grantedSet.size;
  const totalPerms = permissions.length;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Verify access
          </CardTitle>
          <CardDescription>
            Resolve the effective permissions for a user against this tenant
            (and optionally a Business Unit scope). The matrix and page
            coverage below update live.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <Select
                value={mode === "self" ? "__self" : targetUserId}
                onValueChange={(v) => {
                  if (v === "__self") { setMode("self"); setTargetUserId(""); }
                  else { setMode("other"); setTargetUserId(v); }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__self">Me ({me.tenantRole ?? "—"})</SelectItem>
                  {isAdminViewer && (membersQ.data ?? []).map((m: any) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name || m.email || m.user_id.slice(0, 8)}
                      {m.active === false ? " (suspended)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Scope</label>
              <Select value={buId} onValueChange={setBuId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root">Tenant root</SelectItem>
                  {(lookupsQ.data?.business_units ?? []).map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Filter permissions</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="e.g. recon, audit, byok"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verify a specific page / action */}
      <VerifyPagePanel
        tenantId={tenantId}
        snap={snap}
        grantedSet={grantedSet}
        targetUserId={mode === "self" ? undefined : targetUserId}
      />



      {/* Identity summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm">
          {snap?.is_platform_admin ? (
            <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20">
              Platform admin
            </Badge>
          ) : null}
          {snap?.tenant_role ? (
            <Badge variant="outline">Tenant role: {snap.tenant_role.replace("_", " ")}</Badge>
          ) : (
            <Badge variant="outline">Not a member</Badge>
          )}
          <Badge variant="secondary">
            {grantedCount}/{totalPerms} permissions granted
          </Badge>
          {buEffective ? (
            <Badge variant="outline">
              BU: {(lookupsQ.data?.business_units ?? []).find((b: any) => b.id === buEffective)?.name ?? buEffective.slice(0, 8)}
            </Badge>
          ) : null}
          {snap?.resolved_at ? (
            <span className="text-xs text-muted-foreground">
              Resolved {new Date(snap.resolved_at).toLocaleTimeString()}
            </span>
          ) : null}
        </CardContent>
      </Card>

      {/* Permission matrix */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4" /> Permission matrix
            </CardTitle>
            <CardDescription>
              Each row is a catalog permission. Source badges explain why it is
              granted (role/group/direct).
            </CardDescription>
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 w-10"></th>
                  <th className="px-4 py-2">Permission</th>
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2">Sources</th>
                </tr>
              </thead>
              <tbody>
                {filteredPerms.map((p: any) => {
                  const granted = grantedSet.has(p.id);
                  const srcs = sourcesByPerm[p.id] ?? [];
                  return (
                    <tr key={p.id} className="border-b">
                      <td className="px-4 py-2">
                        {granted ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground/60" />
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-mono text-xs">{p.id}</div>
                        {p.description ? (
                          <div className="text-xs text-muted-foreground">{p.description}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-[10px] uppercase">{p.category}</Badge>
                        {p.is_dangerous ? (
                          <Badge variant="destructive" className="ml-1 text-[10px] uppercase">danger</Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        {!granted && snap?.is_platform_admin ? (
                          <Badge className="bg-amber-500/15 text-amber-700">via platform admin</Badge>
                        ) : null}
                        <div className="flex flex-wrap gap-1">
                          {srcs.map((s, i) => {
                            const tag =
                              s.source === "role"
                                ? `role: ${rolesById[s.role_id ?? ""]?.name ?? "—"}`
                                : s.source === "group"
                                ? `group: ${groupsById[s.group_id ?? ""]?.name ?? "—"}`
                                : s.source;
                            return (
                              <Badge key={i} variant="secondary" className="text-[10px]">{tag}</Badge>
                            );
                          })}
                          {granted && srcs.length === 0 && snap?.is_platform_admin ? null : null}
                          {!granted && srcs.length === 0 && !snap?.is_platform_admin ? (
                            <span className="text-xs text-muted-foreground">no grants</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredPerms.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No permissions match the filter.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Page coverage */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PageCoverageCard
          title="Workspace pages"
          pages={WORKSPACE_PAGES}
          grantedSet={grantedSet}
          isPlatformAdmin={!!snap?.is_platform_admin}
        />
        <PageCoverageCard
          title="Tenant admin pages"
          pages={TENANT_PAGES}
          grantedSet={grantedSet}
          isPlatformAdmin={!!snap?.is_platform_admin}
        />
      </div>
    </div>
  );
}

function PageCoverageCard({
  title,
  pages,
  grantedSet,
  isPlatformAdmin,
}: {
  title: string;
  pages: PageDef[];
  grantedSet: Set<string>;
  isPlatformAdmin: boolean;
}) {
  const allowed = pages.filter(
    (p) => !p.permission || isPlatformAdmin || grantedSet.has(p.permission),
  ).length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {allowed}/{pages.length} pages accessible
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 w-10"></th>
                <th className="px-4 py-2">Page</th>
                <th className="px-4 py-2">Required permission</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => {
                const ok = !p.permission || isPlatformAdmin || grantedSet.has(p.permission);
                return (
                  <tr key={p.key} className="border-b">
                    <td className="px-4 py-2">
                      {ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <ShieldAlert className="h-4 w-4 text-destructive" />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{p.label}</div>
                      {p.group ? (
                        <div className="text-xs text-muted-foreground">{p.group}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      {p.permission ? (
                        <code className="text-xs">{p.permission}</code>
                      ) : (
                        <span className="text-xs text-muted-foreground">— (open)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Verify Page / Action Panel ---------------- */

type VerifyTarget = { kind: "page"; scope: "workspace" | "tenant"; def: PageDef } | { kind: "action"; permission: string };

function VerifyPagePanel({
  tenantId, snap, grantedSet, targetUserId,
}: {
  tenantId: string;
  snap: AccessSnapshot | undefined;
  grantedSet: Set<string>;
  targetUserId: string | undefined;
}) {
  const logFn = useServerFn(logAccessDecision);
  const [kind, setKind] = useState<"page" | "action">("page");
  const [pageKey, setPageKey] = useState<string>("");
  const [actionPerm, setActionPerm] = useState<string>("");
  const [result, setResult] = useState<null | { allowed: boolean; permission: string | null; label: string; explanation: string[]; logged: boolean }>(null);

  const allPages = useMemo(
    () => [
      ...WORKSPACE_PAGES.map((p) => ({ scope: "workspace" as const, def: p })),
      ...TENANT_PAGES.map((p) => ({ scope: "tenant" as const, def: p })),
    ],
    [],
  );

  function evaluate() {
    if (!snap) return;
    let target: VerifyTarget | null = null;
    if (kind === "page") {
      const hit = allPages.find((p) => `${p.scope}:${p.def.key}` === pageKey);
      if (!hit) return;
      target = { kind: "page", scope: hit.scope, def: hit.def };
    } else {
      if (!actionPerm) return;
      target = { kind: "action", permission: actionPerm };
    }

    const required =
      target.kind === "page" ? target.def.permission : target.permission;
    const label =
      target.kind === "page" ? `${target.scope} → ${target.def.label}` : `action: ${target.permission}`;

    let allowed = true;
    const explanation: string[] = [];

    if (snap.is_platform_admin) {
      explanation.push("Platform admin override: bypasses tenant permission checks.");
    } else if (!required) {
      explanation.push("Page has no required permission — open to all tenant members.");
    } else {
      allowed = grantedSet.has(required);
      explanation.push(`Required permission: ${required}`);
      const sources = (snap.sources ?? []).filter((s) => s.permission_id === required);
      if (sources.length === 0 && !allowed) {
        explanation.push("Not granted by role, any group, or direct assignment.");
      } else {
        for (const s of sources) {
          explanation.push(`Granted via ${s.source}`);
        }
      }
      if (snap.tenant_role) explanation.push(`Subject's tenant role: ${snap.tenant_role}`);
    }

    // Fire-and-forget audit
    let logged = false;
    if (required) {
      logFn({
        data: {
          tenant_id: tenantId,
          scope: target.kind === "page" ? target.scope : "tenant",
          page_key: target.kind === "page" ? target.def.key : `action:${target.permission}`,
          page_label: label,
          required_permission: required,
          decision: allowed ? "allow" : "deny",
          effective_sample: Array.from(grantedSet).slice(0, 25),
          user_id: targetUserId,
        },
      }).then(() => { logged = true; }).catch(() => undefined);
    }

    setResult({ allowed: allowed || !required, permission: required ?? null, label, explanation, logged });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PlayCircle className="h-4 w-4" /> Verify a specific page or action
        </CardTitle>
        <CardDescription>
          Pick a page from any scope, or paste a permission key. The result is
          written to <code>audit_log</code> as <code>access.checked</code> /{" "}
          <code>access.denied</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Select value={kind} onValueChange={(v) => setKind(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="page">Page</SelectItem>
              <SelectItem value="action">Action / permission key</SelectItem>
            </SelectContent>
          </Select>
          {kind === "page" ? (
            <Select value={pageKey} onValueChange={setPageKey}>
              <SelectTrigger><SelectValue placeholder="Select a page" /></SelectTrigger>
              <SelectContent>
                {allPages.map(({ scope, def }) => (
                  <SelectItem key={`${scope}:${def.key}`} value={`${scope}:${def.key}`}>
                    {scope} → {def.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              placeholder="e.g. recon.run"
              value={actionPerm}
              onChange={(e) => setActionPerm(e.target.value)}
            />
          )}
          <Button onClick={evaluate} disabled={!snap || (kind === "page" ? !pageKey : !actionPerm)}>
            Verify
          </Button>
        </div>

        {result && (
          <div className={`rounded border p-3 text-sm ${result.allowed ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
            <div className="flex items-center gap-2 font-medium">
              {result.allowed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-destructive" />}
              {result.allowed ? "Allowed" : "Denied"} — {result.label}
            </div>
            {result.permission && (
              <p className="mt-1 text-xs text-muted-foreground">
                Required: <code>{result.permission}</code>
              </p>
            )}
            <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-1">
              {result.explanation.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
