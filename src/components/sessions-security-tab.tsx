import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { KeyRound, Fingerprint, Laptop, ShieldAlert, LogOut, RefreshCcw, Trash2, ShieldCheck } from "lucide-react";
import { MfaEnrollmentPanel } from "@/components/mfa-enrollment-panel";
import { toast } from "sonner";
import {
  listWebauthnCredentials,
  deleteWebauthnCredential,
  listTrustedDevices,
  revokeTrustedDevice,
  listSessionRevocations,
  revokeAllSessions,
  listRecoveryCodes,
  generateRecoveryCodes,
  listLoginAnomalies,
} from "@/lib/sessions.functions";

function fmt(ts?: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export function SessionsSecurityTab() {
  const qc = useQueryClient();
  const lwc = useServerFn(listWebauthnCredentials);
  const dwc = useServerFn(deleteWebauthnCredential);
  const ltd = useServerFn(listTrustedDevices);
  const rtd = useServerFn(revokeTrustedDevice);
  const lsr = useServerFn(listSessionRevocations);
  const ras = useServerFn(revokeAllSessions);
  const lrc = useServerFn(listRecoveryCodes);
  const grc = useServerFn(generateRecoveryCodes);
  const lla = useServerFn(listLoginAnomalies);

  const wa = useQuery({ queryKey: ["sec", "webauthn"], queryFn: () => lwc() });
  const td = useQuery({ queryKey: ["sec", "trusted"], queryFn: () => ltd() });
  const sr = useQuery({ queryKey: ["sec", "revocations"], queryFn: () => lsr() });
  const rc = useQuery({ queryKey: ["sec", "recovery"], queryFn: () => lrc() });
  const la = useQuery({ queryKey: ["sec", "anomalies"], queryFn: () => lla() });

  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const mDelWa = useMutation({
    mutationFn: (id: string) => dwc({ data: { id } }),
    onSuccess: () => { toast.success("Passkey removed"); qc.invalidateQueries({ queryKey: ["sec", "webauthn"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const mRevTd = useMutation({
    mutationFn: (id: string) => rtd({ data: { id } }),
    onSuccess: () => { toast.success("Device revoked"); qc.invalidateQueries({ queryKey: ["sec", "trusted"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const mRevAll = useMutation({
    mutationFn: () => ras({ data: { reason: "user_initiated_logout_all" } }),
    onSuccess: () => { toast.success("Sessions revoked across devices"); qc.invalidateQueries({ queryKey: ["sec", "revocations"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const mGenRc = useMutation({
    mutationFn: () => grc({ data: undefined }),
    onSuccess: (r: any) => { setNewCodes(r?.codes ?? []); qc.invalidateQueries({ queryKey: ["sec", "recovery"] }); toast.success("New recovery codes generated"); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Sessions &amp; account security</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="sessions">
          <TabsList>
            <TabsTrigger value="sessions"><LogOut className="mr-2 h-4 w-4" />Sessions</TabsTrigger>
            <TabsTrigger value="mfa"><ShieldCheck className="mr-2 h-4 w-4" />MFA</TabsTrigger>
            <TabsTrigger value="passkeys"><Fingerprint className="mr-2 h-4 w-4" />Passkeys</TabsTrigger>
            <TabsTrigger value="devices"><Laptop className="mr-2 h-4 w-4" />Trusted devices</TabsTrigger>
            <TabsTrigger value="recovery"><KeyRound className="mr-2 h-4 w-4" />Recovery codes</TabsTrigger>
            <TabsTrigger value="anomalies"><ShieldAlert className="mr-2 h-4 w-4" />Anomalies</TabsTrigger>
          </TabsList>

          <TabsContent value="mfa" className="space-y-4">
            <MfaEnrollmentPanel />
          </TabsContent>

          <TabsContent value="sessions" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sign out of all other devices. This records a revocation event and forces re-authentication elsewhere.</p>
              </div>
              <Button variant="destructive" onClick={() => mRevAll.mutate()} disabled={mRevAll.isPending}>
                <LogOut className="mr-2 h-4 w-4" /> Log out of all devices
              </Button>
            </div>
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left"><tr><th className="p-2">Revoked at</th><th className="p-2">Reason</th></tr></thead>
                <tbody>
                  {(sr.data ?? []).length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={2}>No revocations yet.</td></tr>}
                  {(sr.data ?? []).map((r: any) => (
                    <tr key={r.id} className="border-t"><td className="p-2 font-mono text-xs">{fmt(r.revoked_at)}</td><td className="p-2">{r.reason ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="passkeys" className="space-y-4">
            <p className="text-sm text-muted-foreground">Passkeys registered to this account (WebAuthn / FIDO2).</p>
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left"><tr><th className="p-2">Label</th><th className="p-2">Transports</th><th className="p-2">Last used</th><th className="p-2">Created</th><th className="p-2 text-right">Actions</th></tr></thead>
                <tbody>
                  {(wa.data ?? []).length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={5}>No passkeys registered.</td></tr>}
                  {(wa.data ?? []).map((c: any) => (
                    <tr key={c.id} className="border-t">
                      <td className="p-2">{c.device_label ?? "Unnamed"}</td>
                      <td className="p-2 text-xs">{(c.transports ?? []).join(", ") || "—"}</td>
                      <td className="p-2 text-xs">{fmt(c.last_used_at)}</td>
                      <td className="p-2 text-xs">{fmt(c.created_at)}</td>
                      <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => mDelWa.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="devices" className="space-y-4">
            <p className="text-sm text-muted-foreground">Browsers marked as trusted skip step-up MFA for {30} days.</p>
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left"><tr><th className="p-2">Device</th><th className="p-2">IP</th><th className="p-2">Last seen</th><th className="p-2">Expires</th><th className="p-2">Status</th><th className="p-2 text-right">Actions</th></tr></thead>
                <tbody>
                  {(td.data ?? []).length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={6}>No trusted devices registered.</td></tr>}
                  {(td.data ?? []).map((d: any) => (
                    <tr key={d.id} className="border-t">
                      <td className="p-2">{d.device_label ?? d.user_agent?.slice(0, 40) ?? "Unnamed"}</td>
                      <td className="p-2 font-mono text-xs">{d.ip_address ?? "—"}</td>
                      <td className="p-2 text-xs">{fmt(d.last_seen_at)}</td>
                      <td className="p-2 text-xs">{fmt(d.expires_at)}</td>
                      <td className="p-2">{d.revoked_at ? <Badge variant="destructive">Revoked</Badge> : <Badge variant="secondary">Active</Badge>}</td>
                      <td className="p-2 text-right">{!d.revoked_at && <Button size="sm" variant="ghost" onClick={() => mRevTd.mutate(d.id)}><Trash2 className="h-4 w-4" /></Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="recovery" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">One-time backup codes for TOTP recovery. Store securely — each can only be used once.</p>
              <Button onClick={() => mGenRc.mutate()} disabled={mGenRc.isPending}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Generate new set
              </Button>
            </div>
            {newCodes && (
              <Alert>
                <AlertTitle>Save these codes now</AlertTitle>
                <AlertDescription>
                  <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm md:grid-cols-5">
                    {newCodes.map((c) => <div key={c} className="rounded border bg-muted/30 p-2 text-center">{c}</div>)}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">These will not be shown again.</p>
                </AlertDescription>
              </Alert>
            )}
            <div className="text-sm text-muted-foreground">
              Existing codes: <span className="font-mono">{(rc.data ?? []).filter((r: any) => !r.used_at).length}</span> unused ·{" "}
              <span className="font-mono">{(rc.data ?? []).filter((r: any) => !!r.used_at).length}</span> used
            </div>
          </TabsContent>

          <TabsContent value="anomalies" className="space-y-4">
            <p className="text-sm text-muted-foreground">Login anomalies detected on this account. Platform admins see all events.</p>
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left"><tr><th className="p-2">When</th><th className="p-2">Event</th><th className="p-2">Severity</th><th className="p-2">IP</th><th className="p-2">Country</th><th className="p-2">Resolved</th></tr></thead>
                <tbody>
                  {(la.data ?? []).length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={6}>No anomalies recorded.</td></tr>}
                  {(la.data ?? []).map((a: any) => (
                    <tr key={a.id} className="border-t">
                      <td className="p-2 text-xs">{fmt(a.created_at)}</td>
                      <td className="p-2">{a.event_type}</td>
                      <td className="p-2"><Badge variant={a.severity === "high" ? "destructive" : a.severity === "medium" ? "default" : "secondary"}>{a.severity}</Badge></td>
                      <td className="p-2 font-mono text-xs">{a.ip_address ?? "—"}</td>
                      <td className="p-2 text-xs">{a.geo_country ?? "—"}</td>
                      <td className="p-2 text-xs">{fmt(a.resolved_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
