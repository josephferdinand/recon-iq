import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getSecuritySettings, updateSecuritySettings,
  getTenantPasskeyStats, listPasskeyPolicyAudit,
} from "@/lib/security.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Fingerprint, ShieldCheck, KeyRound, Info, History } from "lucide-react";
import { toast } from "sonner";

type Policy = {
  passkeys_enabled: boolean;
  passkeys_required: boolean;
  passkeys_user_verification: "required" | "preferred" | "discouraged";
  passkeys_allow_platform_authenticators: boolean;
  passkeys_allow_roaming_authenticators: boolean;
  passkeys_policy_updated_at: string | null;
};

const DEFAULTS: Policy = {
  passkeys_enabled: true,
  passkeys_required: false,
  passkeys_user_verification: "preferred",
  passkeys_allow_platform_authenticators: true,
  passkeys_allow_roaming_authenticators: true,
  passkeys_policy_updated_at: null,
};

export function PasskeyPolicyCard({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const getSettings = useServerFn(getSecuritySettings);
  const updateSettings = useServerFn(updateSecuritySettings);
  const getStats = useServerFn(getTenantPasskeyStats);
  const listAudit = useServerFn(listPasskeyPolicyAudit);

  const settings = useQuery({
    queryKey: ["tenant-security-settings", tenantId],
    queryFn: () => getSettings({ data: { tenant_id: tenantId } }),
  });
  const stats = useQuery({
    queryKey: ["tenant-passkey-stats", tenantId],
    queryFn: () => getStats({ data: { tenant_id: tenantId } }),
    enabled: canWrite,
  });
  const audit = useQuery({
    queryKey: ["tenant-passkey-audit", tenantId],
    queryFn: () => listAudit({ data: { tenant_id: tenantId } }),
    enabled: canWrite,
  });

  const [local, setLocal] = useState<Policy>(DEFAULTS);
  useEffect(() => {
    if (settings.data) {
      setLocal({
        passkeys_enabled: settings.data.passkeys_enabled ?? true,
        passkeys_required: settings.data.passkeys_required ?? false,
        passkeys_user_verification: (settings.data.passkeys_user_verification ?? "preferred") as Policy["passkeys_user_verification"],
        passkeys_allow_platform_authenticators: settings.data.passkeys_allow_platform_authenticators ?? true,
        passkeys_allow_roaming_authenticators: settings.data.passkeys_allow_roaming_authenticators ?? true,
        passkeys_policy_updated_at: settings.data.passkeys_policy_updated_at ?? null,
      });
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Policy>) =>
      updateSettings({ data: { tenant_id: tenantId, ...patch } }),
    onSuccess: () => {
      toast.success("Passkey policy updated");
      qc.invalidateQueries({ queryKey: ["tenant-security-settings", tenantId] });
      qc.invalidateQueries({ queryKey: ["tenant-passkey-audit", tenantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update policy"),
  });

  const patch = (p: Partial<Policy>) => {
    setLocal((prev) => ({ ...prev, ...p }));
    save.mutate(p);
  };

  const coverage = stats.data
    ? Math.round(((stats.data.users_with_passkey ?? 0) / Math.max(1, stats.data.member_count ?? 0)) * 100)
    : null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Fingerprint className="h-4 w-4" /> Passkeys &amp; WebAuthn (FIDO2)
            {local.passkeys_required && <Badge variant="default" className="text-[10px]">Required</Badge>}
            {!local.passkeys_enabled && <Badge variant="secondary" className="text-[10px]">Disabled</Badge>}
          </CardTitle>
          <CardDescription>
            Phishing-resistant authentication for tenant members. Aligned with NIST 800-63B AAL3,
            PSD2 SCA dynamic-linking, and FIDO2 CTAP2. Every policy change is written to the tenant
            audit log.
          </CardDescription>
        </div>
        {stats.data && (
          <div className="text-right text-xs text-muted-foreground shrink-0">
            <div><strong className="text-foreground">{stats.data.users_with_passkey}</strong> / {stats.data.member_count} members enrolled</div>
            <div>{stats.data.credential_count} credential{stats.data.credential_count === 1 ? "" : "s"} registered</div>
            {coverage !== null && (
              <div className="mt-1">
                <Badge variant={coverage >= 80 ? "default" : coverage >= 40 ? "secondary" : "destructive"} className="text-[10px]">
                  {coverage}% coverage
                </Badge>
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {local.passkeys_required && stats.data && stats.data.users_with_passkey < stats.data.member_count && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle className="text-xs">Enforcement warning</AlertTitle>
            <AlertDescription className="text-xs">
              {stats.data.member_count - stats.data.users_with_passkey} member(s) do not yet have a passkey
              registered. Requiring passkeys will block their sign-in until they enroll one.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <PolicyRow
            icon={<KeyRound className="h-4 w-4" />}
            label="Allow passkey registration"
            hint="Members can enroll passkeys from their account settings. Turn off to freeze new enrollments (existing passkeys remain usable)."
            checked={local.passkeys_enabled}
            disabled={!canWrite || save.isPending}
            onChange={(v) => patch({ passkeys_enabled: v })}
          />
          <PolicyRow
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Require passkey for sign-in"
            hint="Enforce FIDO2 as the mandatory second factor. Password + TOTP alone will be rejected. Break-glass admins can still recover."
            checked={local.passkeys_required}
            disabled={!canWrite || save.isPending || !local.passkeys_enabled}
            onChange={(v) => patch({ passkeys_required: v })}
          />
          <PolicyRow
            icon={<Fingerprint className="h-4 w-4" />}
            label="Allow platform authenticators"
            hint="Touch ID, Face ID, Windows Hello, Android biometrics. Bound to the device."
            checked={local.passkeys_allow_platform_authenticators}
            disabled={!canWrite || save.isPending || !local.passkeys_enabled}
            onChange={(v) => patch({ passkeys_allow_platform_authenticators: v })}
          />
          <PolicyRow
            icon={<KeyRound className="h-4 w-4" />}
            label="Allow roaming authenticators"
            hint="Hardware security keys (YubiKey, SoloKey, Feitian). Portable across devices — recommended for admins."
            checked={local.passkeys_allow_roaming_authenticators}
            disabled={!canWrite || save.isPending || !local.passkeys_enabled}
            onChange={(v) => patch({ passkeys_allow_roaming_authenticators: v })}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">User verification requirement</Label>
            <Select
              value={local.passkeys_user_verification}
              onValueChange={(v) => patch({ passkeys_user_verification: v as Policy["passkeys_user_verification"] })}
              disabled={!canWrite || save.isPending || !local.passkeys_enabled}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="required">Required — biometric or PIN every time (AAL3)</SelectItem>
                <SelectItem value="preferred">Preferred — request UV, allow if unavailable</SelectItem>
                <SelectItem value="discouraged">Discouraged — presence only (least secure)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Applied to WebAuthn <code>userVerification</code> during registration &amp; assertion.
            </p>
          </div>

          {local.passkeys_policy_updated_at && (
            <div className="rounded-md border p-3 text-xs">
              <div className="font-medium mb-1">Last policy change</div>
              <div className="text-muted-foreground">
                {new Date(local.passkeys_policy_updated_at).toLocaleString()}
              </div>
              <div className="text-muted-foreground text-[11px] mt-1">
                Full history recorded in the tenant audit log under
                {" "}<code>security.passkey_policy.update</code>.
              </div>
            </div>
          )}
        </div>

        {canWrite && audit.data && audit.data.length > 0 && (
          <div className="rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium">
              <History className="h-3.5 w-3.5" /> Recent policy changes ({audit.data.length})
            </div>
            <div className="divide-y">
              {audit.data.map((row: any) => {
                const changed = Object.keys(row?.context?.after ?? {});
                return (
                  <div key={row.id} className="grid grid-cols-[auto_1fr] gap-3 px-3 py-2 text-xs">
                    <div className="text-muted-foreground shrink-0 w-40">
                      {new Date(row.created_at).toLocaleString()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-1">
                        {changed.map((k) => (
                          <Badge key={k} variant="outline" className="text-[10px] font-mono">
                            {k.replace(/^passkeys_/, "")}
                            {": "}
                            <span className="ml-1 text-muted-foreground line-through">
                              {String(row.context.before?.[k] ?? "—")}
                            </span>
                            <span className="ml-1 text-foreground">
                              → {String(row.context.after?.[k])}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyRow({
  icon, label, hint, checked, disabled, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          <span className="truncate">{label}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
