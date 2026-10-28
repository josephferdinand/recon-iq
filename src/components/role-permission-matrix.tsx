import { CheckCircle2, XCircle, Shield, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { exportCsv, exportPdf, exportXlsxCols, type ExportColumn } from "@/lib/export-utils";

/**
 * Static, admin-facing reference of what each platform-level role
 * is allowed and denied. Mirrors the checks in server functions
 * (`isPlatformAdmin`, `is_platform_staff`) and RLS policies so admins
 * always have a single source of truth for tenant/platform authorization.
 */

type Cell = "yes" | "no" | "read";

type Capability = {
  area: string;
  action: string;
  detail: string;
  admin: Cell;
  member: Cell;
  tenantAdmin?: Cell;
  tenantMember?: Cell;
};

const CAPS: Capability[] = [
  {
    area: "Tenants",
    action: "List all tenants",
    detail: "See every tenant on the platform, including those they are not a direct member of.",
    admin: "yes", member: "yes", tenantAdmin: "read", tenantMember: "read",
  },
  {
    area: "Tenants",
    action: "Create tenants",
    detail: "Provision a new tenant workspace under any family.",
    admin: "yes", member: "no", tenantAdmin: "no", tenantMember: "no",
  },
  {
    area: "Tenants",
    action: "Edit tenant metadata",
    detail: "Change display name, environment, AI toggle, custom domain.",
    admin: "yes", member: "no", tenantAdmin: "no", tenantMember: "no",
  },
  {
    area: "Tenants",
    action: "Delete / archive tenant",
    detail: "Take a tenant out of service.",
    admin: "yes", member: "no", tenantAdmin: "no", tenantMember: "no",
  },
  {
    area: "Roles & access",
    action: "Grant platform_admin",
    detail: "Only existing platform admins can grant this role.",
    admin: "yes", member: "no",
  },
  {
    area: "Roles & access",
    action: "Grant platform_member",
    detail: "Confer read-only cross-tenant visibility to an operator.",
    admin: "yes", member: "no",
  },
  {
    area: "Roles & access",
    action: "Invite tenant members",
    detail: "Send a tenant_admin / tenant_member invitation.",
    admin: "yes", member: "no", tenantAdmin: "yes", tenantMember: "no",
  },
  {
    area: "Roles & access",
    action: "Change roles inside a tenant",
    detail: "Promote/demote/remove members of a specific tenant.",
    admin: "yes", member: "no", tenantAdmin: "yes", tenantMember: "no",
  },
  {
    area: "Data — reconciliations",
    action: "View recon runs, matches, breaks",
    detail: "Read-only across tenants for staff; write within owned tenant only.",
    admin: "read", member: "read", tenantAdmin: "yes", tenantMember: "yes",
  },
  {
    area: "Data — reconciliations",
    action: "Create/edit definitions or rules",
    detail: "Mutating operations on any recon config.",
    admin: "no", member: "no", tenantAdmin: "yes", tenantMember: "read",
  },
  {
    area: "Data — reconciliations",
    action: "Approve manual matches / break notes",
    detail: "Governance mutations on tenant data.",
    admin: "no", member: "no", tenantAdmin: "yes", tenantMember: "yes",
  },
  {
    area: "Financial master data",
    action: "Read reference data",
    detail: "Accounts, securities, counterparties.",
    admin: "read", member: "read", tenantAdmin: "yes", tenantMember: "yes",
  },
  {
    area: "Financial master data",
    action: "Insert / update / delete master data",
    detail: "Governed by tenant-admin RLS. Blocked for platform_member.",
    admin: "no", member: "no", tenantAdmin: "yes", tenantMember: "no",
  },
  {
    area: "Data quality",
    action: "Author DQ rules and operations",
    detail: "Blocked for platform_member; tenant admins only.",
    admin: "no", member: "no", tenantAdmin: "yes", tenantMember: "no",
  },
  {
    area: "Security & audit",
    action: "View immutable audit log",
    detail: "Full trail, all tenants.",
    admin: "yes", member: "yes", tenantAdmin: "read", tenantMember: "no",
  },
  {
    area: "Security & audit",
    action: "Verify audit chain",
    detail: "Cryptographic verification of the hash chain (writes verify event).",
    admin: "yes", member: "no",
  },
  {
    area: "Security & audit",
    action: "Export audit / security scan (CSV/XLSX/PDF)",
    detail: "Client-side export of what the user can already see on screen.",
    admin: "yes", member: "yes", tenantAdmin: "yes", tenantMember: "no",
  },
  {
    area: "Security & audit",
    action: "Break-glass access grants",
    detail: "Only platform admins can approve.",
    admin: "yes", member: "no",
  },
  {
    area: "Security & audit",
    action: "Manage BYOK / vault secrets",
    detail: "Sensitive key material — admins only.",
    admin: "yes", member: "no",
  },
  {
    area: "AI governance",
    action: "View AI usage, budgets, drift",
    detail: "Read-only for platform staff.",
    admin: "yes", member: "yes", tenantAdmin: "read", tenantMember: "no",
  },
  {
    area: "AI governance",
    action: "Change kill-switches, budgets, models",
    detail: "Governance mutation.",
    admin: "yes", member: "no",
  },
  {
    area: "Reliability",
    action: "View status / worker health / SLOs",
    detail: "Observability, read-only across the board.",
    admin: "yes", member: "yes", tenantAdmin: "read", tenantMember: "read",
  },
  {
    area: "Reliability",
    action: "Trigger maintenance windows, cross-recon",
    detail: "Ops mutation.",
    admin: "yes", member: "no",
  },
  {
    area: "Marketing site",
    action: "Manage dynamic website themes",
    detail: "Publish to the public marketing site. Platform Owners (platform_admin) have full access via implicit bypass — no extra grant needed. Marketing admins (mkt_admin_roles.super_admin / marketing_admin) also allowed.",
    admin: "yes", member: "no", tenantAdmin: "no", tenantMember: "no",
  },
  {
    area: "Marketing site",
    action: "Grant / revoke marketing admin roles",
    detail: "Platform Owners can self-grant super_admin at /mkt-admin (audited). Existing mkt super_admins can also grant/revoke roles.",
    admin: "yes", member: "no", tenantAdmin: "no", tenantMember: "no",
  },

];

type MatrixRow = { area: string; action: string; detail: string; platform_admin: string; platform_member: string; tenant_admin: string; tenant_member: string };
const MATRIX_COLS: ExportColumn<MatrixRow>[] = [
  { key: "area", header: "Area" },
  { key: "action", header: "Action" },
  { key: "detail", header: "Detail" },
  { key: "platform_admin", header: "platform_admin" },
  { key: "platform_member", header: "platform_member" },
  { key: "tenant_admin", header: "tenant_admin" },
  { key: "tenant_member", header: "tenant_member" },
];
const cellLabel = (v?: Cell) => v === "yes" ? "Yes" : v === "read" ? "Read-only" : v === "no" ? "Denied" : "—";
function matrixRows(): MatrixRow[] {
  return CAPS.map((c) => ({
    area: c.area, action: c.action, detail: c.detail,
    platform_admin: cellLabel(c.admin),
    platform_member: cellLabel(c.member),
    tenant_admin: cellLabel(c.tenantAdmin),
    tenant_member: cellLabel(c.tenantMember),
  }));
}

function Mark({ v }: { v?: Cell }) {
  if (!v) return <span className="text-muted-foreground">—</span>;
  if (v === "yes") return (
    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4" /> Yes
    </span>
  );
  if (v === "read") return (
    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
      <CheckCircle2 className="h-4 w-4" /> Read-only
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-destructive">
      <XCircle className="h-4 w-4" /> Denied
    </span>
  );
}

export function RolePermissionMatrixTab() {
  const areas = Array.from(new Set(CAPS.map((c) => c.area)));
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Shield className="mt-1 h-6 w-6 text-primary" />
        <div>
          <h1 className="font-display text-2xl font-semibold">Role permission matrix</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Authoritative reference for what each role can and cannot do. Enforced in three
            layers: (1) UI gating, (2) server-function <code>isPlatformAdmin</code>/
            <code>assertMktRole</code> checks, (3) Postgres RLS policies. Two independent
            <em> deny </em> checks must fail before any tenant-scoped mutation can succeed.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge>platform_admin</Badge>
          <Badge variant="outline">platform_member (read-only)</Badge>
          <Badge variant="secondary">tenant_admin</Badge>
          <Badge variant="outline">tenant_member</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCsv("role-permission-matrix", MATRIX_COLS, matrixRows())}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportXlsxCols("role-permission-matrix", "matrix", MATRIX_COLS, matrixRows())}>
            <Download className="mr-2 h-4 w-4" /> XLSX
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportPdf("role-permission-matrix.pdf", "Role permission matrix", "ReconIQ — current permission model", MATRIX_COLS, matrixRows())}>
            <Download className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      {areas.map((area) => (
        <Card key={area}>
          <CardHeader>
            <CardTitle>{area}</CardTitle>
            <CardDescription>Actions grouped by domain.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 w-1/3">Action</th>
                  <th className="px-4 py-3">Platform admin</th>
                  <th className="px-4 py-3">Platform member</th>
                  <th className="px-4 py-3">Tenant admin</th>
                  <th className="px-4 py-3">Tenant member</th>
                </tr>
              </thead>
              <tbody>
                {CAPS.filter((c) => c.area === area).map((c) => (
                  <tr key={c.action} className="border-b align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.action}</div>
                      <div className="text-xs text-muted-foreground">{c.detail}</div>
                    </td>
                    <td className="px-4 py-3"><Mark v={c.admin} /></td>
                    <td className="px-4 py-3"><Mark v={c.member} /></td>
                    <td className="px-4 py-3"><Mark v={c.tenantAdmin} /></td>
                    <td className="px-4 py-3"><Mark v={c.tenantMember} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Enforcement layers</CardTitle>
          <CardDescription>Every mutating action is gated by all three of the following.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">1. UI</div>
            <div className="text-xs text-muted-foreground">Controls hidden / disabled for read-only roles. Prevents accidental clicks — never the security boundary.</div>
          </div>
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">2. Server function guards</div>
            <div className="text-xs text-muted-foreground"><code>requireSupabaseAuth</code> + <code>isPlatformAdmin</code> / <code>assertMktRole</code> checks before any DB write.</div>
          </div>
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">3. Postgres RLS</div>
            <div className="text-xs text-muted-foreground">Last line of defence. Even a bypassed UI + bypassed server guard would still be blocked at the database.</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
