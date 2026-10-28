// ─────────────────────────────────────────────────────────────────────────────
// Vault Access Matrix
// Renders a clear, role-based view of who can manage Platform vs Tenant
// secrets. Mirrors the RLS policies on `app_vault_secrets` /
// `app_vault_kms_bindings` / `app_vault_rotation_log` so operators can audit
// authorised principals without reading SQL.
// ─────────────────────────────────────────────────────────────────────────────
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Building2,
  CheckCircle2,
  Eye,
  Info,
  Landmark,
  Lock,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { getVaultAccess } from "@/lib/vault.functions";

type Scope = "platform" | "tenant";

type Admin = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  is_you: boolean;
  granted_at?: string;
  joined_at?: string;
};

type AccessData = {
  viewer: {
    user_id: string;
    is_platform_admin: boolean;
    is_tenant_admin: boolean;
    can_manage_platform_secrets: boolean;
    can_manage_tenant_secrets: boolean;
  };
  scope: Scope;
  tenant_id: string | null;
  platform_admins: Admin[];
  tenant_admins: Admin[];
};

export function VaultAccessMatrix({
  scope,
  tenantId,
}: {
  scope: Scope;
  tenantId?: string;
}) {
  const fn = useServerFn(getVaultAccess);
  const q = useQuery<AccessData>({
    queryKey: ["vault-access", scope, tenantId ?? null],
    queryFn: () => fn({ data: { scope, tenant_id: tenantId } }) as Promise<AccessData>,
  });

  const data = q.data;
  const viewerCanManageCurrent =
    scope === "platform"
      ? !!data?.viewer.can_manage_platform_secrets
      : !!data?.viewer.can_manage_tenant_secrets;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Role-based access — who can manage vault secrets
        </CardTitle>
        <CardDescription>
          Enforced by row-level security on{" "}
          <code>app_vault_secrets</code>,{" "}
          <code>app_vault_kms_bindings</code>, and{" "}
          <code>app_vault_rotation_log</code>. This screen reflects the live
          policy — it does not grant access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Viewer banner */}
        {data ? (
          viewerCanManageCurrent ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>You can manage {scope} secrets</AlertTitle>
              <AlertDescription className="text-xs">
                Signed in as{" "}
                <span className="font-mono">{data.viewer.user_id}</span> with
                role{" "}
                <Badge variant="outline" className="ml-1">
                  {scope === "platform" ? "platform_admin" : "tenant_admin"}
                </Badge>
                . All add / rotate / delete actions are recorded to{" "}
                <code>audit_log</code>.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Read-only view</AlertTitle>
              <AlertDescription className="text-xs">
                Your current role cannot manage {scope} secrets. Contact an
                administrator listed below to request access. Attempts to
                write will be blocked by RLS.
              </AlertDescription>
            </Alert>
          )
        ) : null}

        {/* Two-scope matrix */}
        <div className="grid gap-4 md:grid-cols-2">
          <ScopeCard
            active={scope === "platform"}
            icon={<Landmark className="h-4 w-4" />}
            title="Platform secrets"
            subtitle="scope = 'platform', tenant_id IS NULL"
            roleLabel="platform_admin"
            rlsSummary="private.is_platform_admin(auth.uid()) = true"
            admins={data?.platform_admins ?? []}
            loading={q.isLoading}
            emptyText="No platform administrators granted. Ask the initial platform bootstrap owner to assign one."
          />
          <ScopeCard
            active={scope === "tenant"}
            icon={<Building2 className="h-4 w-4" />}
            title="Tenant secrets"
            subtitle="scope = 'tenant', tenant_id = current tenant"
            roleLabel="tenant_admin"
            rlsSummary="tenant_members.role = 'tenant_admin' AND active"
            admins={data?.tenant_admins ?? []}
            loading={q.isLoading}
            disabled={scope !== "tenant"}
            disabledReason="Switch to a tenant workspace to see its authorised admins."
            emptyText="No active tenant administrators. Invite one from Tenant → Members."
          />
        </div>

        {/* Permission legend */}
        <div className="rounded-md border bg-muted/30 p-3 text-xs">
          <div className="mb-2 flex items-center gap-1 font-medium">
            <Info className="h-3 w-3" /> Permission legend
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <LegendItem
              icon={<CheckCircle2 className="h-3 w-3 text-emerald-500" />}
              label="Manage"
              desc="Add, rotate, delete secrets and KMS bindings within scope."
            />
            <LegendItem
              icon={<Eye className="h-3 w-3 text-sky-500" />}
              label="Metadata read"
              desc="Names, fingerprints, last-4, KEK ref only — never plaintext."
            />
            <LegendItem
              icon={<Lock className="h-3 w-3 text-muted-foreground" />}
              label="Denied"
              desc="RLS blocks the row from returning; write attempts return 403."
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScopeCard({
  active,
  icon,
  title,
  subtitle,
  roleLabel,
  rlsSummary,
  admins,
  loading,
  disabled,
  disabledReason,
  emptyText,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  roleLabel: string;
  rlsSummary: string;
  admins: Admin[];
  loading: boolean;
  disabled?: boolean;
  disabledReason?: string;
  emptyText: string;
}) {
  return (
    <div
      className={
        "rounded-md border p-4 " +
        (active
          ? "border-primary/60 bg-primary/5"
          : "border-border bg-background")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
            {active ? (
              <Badge variant="default" className="text-[10px]">
                current scope
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
        <Badge variant="outline" className="whitespace-nowrap">
          {roleLabel}
        </Badge>
      </div>

      <div className="mt-3 rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        RLS: {rlsSummary}
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Authorised principals{admins.length > 0 ? ` (${admins.length})` : ""}
        </div>
        {disabled ? (
          <p className="text-xs italic text-muted-foreground">
            {disabledReason}
          </p>
        ) : loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="space-y-1">
            {admins.map((a) => (
              <li
                key={a.user_id}
                className="flex items-center justify-between gap-2 rounded border border-transparent px-2 py-1 hover:border-border hover:bg-muted/40"
              >
                <div className="flex items-center gap-2 truncate">
                  <UserRound className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate text-xs">
                    {a.full_name || a.email || a.user_id}
                  </span>
                  {a.email && a.full_name ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {a.email}
                    </span>
                  ) : null}
                </div>
                {a.is_you ? (
                  <Badge variant="secondary" className="text-[10px]">
                    you
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LegendItem({
  icon,
  label,
  desc,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}
