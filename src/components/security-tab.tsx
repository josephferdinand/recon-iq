/**
 * @deprecated Security v1 — retired per APP_RATIONALIZATION_2026-07-17 QW#1.
 * New surface: `<SessionsSecurityTab />` + `/hub/vault` + `/hub/access`.
 * Kept in the tree only as a fallback for tenants still linking to the
 * legacy `page=security` route until they migrate. Do not extend.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getSecuritySettings, updateSecuritySettings,
  listIpAllowlist, addIpAllowlistEntry, removeIpAllowlistEntry,
  listSecurityEvents,
} from "@/lib/security.functions";
import { supabase } from "@/integrations/supabase/client";
import { DeprecatedBanner } from "@/components/deprecated-banner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { ShieldCheck, KeyRound, Globe, Trash2, Plus, LogOut, Activity } from "lucide-react";
import { toast } from "sonner";
import { PasskeyPolicyCard } from "@/components/passkey-policy-card";

function reportAuthEvent(event_type: string, context?: any) {
  try {
    fetch("/api/public/security-event", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type, context: context ?? {} }),
      keepalive: true,
    });
  } catch { /* best-effort */ }
}

export function SecurityTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  return (
    <div>
      <DeprecatedBanner
        successorLabel="Sessions & security / Vault / Access hubs"
        successorHref="/hub/vault"
        note="Security v1 is retired. Use Sessions & security, /hub/vault (secrets, keys, mTLS), and /hub/access (RBAC, entitlements)."
      />
      <div className="grid gap-6 lg:grid-cols-2">
      <SettingsCard tenantId={tenantId} canWrite={canWrite} />
      <MfaCard />
      <PasskeyPolicyCard tenantId={tenantId} canWrite={canWrite} />
      <IpAllowlistCard tenantId={tenantId} canWrite={canWrite} />
      <SessionsCard />
      <PrivacyCard tenantId={tenantId} />
      <div className="lg:col-span-2">
        <EventsCard tenantId={tenantId} />
      </div>
      </div>
    </div>
  );
}

function PrivacyCard({ tenantId }: { tenantId: string }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const exportData = async () => {
    try {
      const { exportMyData } = await import("@/lib/gdpr.functions");
      const out = await exportMyData();
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `reconiq-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (e: any) { toast.error(e.message ?? "Export failed"); }
  };
  const submitErasure = async () => {
    if (reason.trim().length < 10) { toast.error("Reason must be at least 10 characters"); return; }
    try {
      const { requestErasure } = await import("@/lib/gdpr.functions");
      await requestErasure({ data: { reason, tenant_id: tenantId } });
      toast.success("Erasure request logged. Platform Admins will action it.");
      setOpen(false); setReason("");
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Privacy & data rights</CardTitle>
        <CardDescription>GDPR Article 15 (export) and Article 17 (erasure).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Download a JSON copy of your profile, memberships, Copilot threads, and recent audit events. Erasure requests are immutably logged and routed to Platform Admins.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportData}>Export my data</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" variant="destructive">Request erasure</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Request data erasure</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">Tell us why. Your request is hash-chained into the audit log.</p>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4}
                className="w-full rounded-md border bg-background p-2 text-sm" placeholder="e.g. I am leaving the organisation and want my personal data removed." />
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={submitErasure}>Submit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}


function SettingsCard({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const get = useServerFn(getSecuritySettings);
  const save = useServerFn(updateSecuritySettings);
  const q = useQuery({
    queryKey: ["sec-settings", tenantId],
    queryFn: () => get({ data: { tenant_id: tenantId } }),
  });
  const m = useMutation({
    mutationFn: (patch: any) => save({ data: { tenant_id: tenantId, ...patch } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["sec-settings", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const s = q.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Security policies</CardTitle>
        <CardDescription>Tenant-wide enforcement settings. Changes are audited.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading || !s ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Row label="Require MFA for all members" hint="Users without MFA enrolled will be required to set it up before continuing.">
              <Switch disabled={!canWrite} checked={s.mfa_required} onCheckedChange={(v) => m.mutate({ mfa_required: v })} />
            </Row>
            <Row label="Enforce IP allowlist" hint="When enabled, sign-ins from IPs outside the allowlist are blocked.">
              <Switch disabled={!canWrite} checked={s.ip_allowlist_enabled} onCheckedChange={(v) => m.mutate({ ip_allowlist_enabled: v })} />
            </Row>
            <NumRow label="Session max age (minutes)" value={s.session_max_age_minutes} disabled={!canWrite}
              onCommit={(n) => m.mutate({ session_max_age_minutes: n })} min={15} max={43200} />
            <NumRow label="Max uploads / hour / user" value={s.max_uploads_per_hour} disabled={!canWrite}
              onCommit={(n) => m.mutate({ max_uploads_per_hour: n })} min={1} max={10000} />
            <NumRow label="Max recon runs / hour / user" value={s.max_runs_per_hour} disabled={!canWrite}
              onCommit={(n) => m.mutate({ max_runs_per_hour: n })} min={1} max={10000} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumRow({ label, value, onCommit, min, max, disabled }: {
  label: string; value: number; onCommit: (n: number) => void; min: number; max: number; disabled?: boolean;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <Label className="text-sm">{label}</Label>
      <Input
        type="number" className="w-32" value={v} min={min} max={max} disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n);
          else setV(String(value));
        }}
      />
    </div>
  );
}

function IpAllowlistCard({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listIpAllowlist);
  const add = useServerFn(addIpAllowlistEntry);
  const rm = useServerFn(removeIpAllowlistEntry);
  const q = useQuery({ queryKey: ["ip-allow", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });

  const [open, setOpen] = useState(false);
  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");
  const mAdd = useMutation({
    mutationFn: () => add({ data: { tenant_id: tenantId, cidr, label: label || undefined } }),
    onSuccess: () => {
      toast.success("Added"); setOpen(false); setCidr(""); setLabel("");
      qc.invalidateQueries({ queryKey: ["ip-allow", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const mRm = useMutation({
    mutationFn: (id: string) => rm({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["ip-allow", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" /> IP allowlist</CardTitle>
          <CardDescription>CIDR ranges permitted to sign in. Enable enforcement in policies.</CardDescription>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Allow an IP range</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>CIDR</Label><Input value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="e.g. 10.20.0.0/16 (Demo Bank HQ VPN) or 2001:db8:demo::/48" /></div>
                <div><Label>Label (optional)</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Demo Bank London — Canary Wharf" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={!cidr.trim() || mAdd.isPending} onClick={() => mAdd.mutate()}>Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : (q.data ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No ranges yet. Example: 10.20.0.0/16 (Demo Bank HQ VPN), 203.0.113.0/24 (Demo Bank London office).</p>
          ) : (q.data ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border p-2">
              <div>
                <code className="text-sm">{r.cidr}</code>
                {r.label && <span className="ml-2 text-xs text-muted-foreground">— {r.label}</span>}
              </div>
              {canWrite && (
                <Button size="sm" variant="ghost" onClick={() => mRm.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              )}
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function MfaCard() {
  const [factors, setFactors] = useState<any[]>([]);
  const [enrolling, setEnrolling] = useState<null | { id: string; qr: string; secret: string }>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.all ?? []);
  }
  useEffect(() => { refresh(); }, []);

  async function startEnroll() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (e: any) {
      reportAuthEvent("auth.mfa_enroll_failed", { message: e.message });
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  async function verify() {
    if (!enrolling) return;
    setBusy(true);
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId: enrolling.id });
      if (ch.error) throw ch.error;
      const v = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: ch.data.id, code });
      if (v.error) throw v.error;
      toast.success("MFA enrolled");
      setEnrolling(null); setCode("");
      refresh();
    } catch (e: any) {
      reportAuthEvent("auth.mfa_failed", { message: e.message });
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  async function unenroll(id: string) {
    if (!confirm("Remove this authenticator?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) toast.error(error.message); else { toast.success("Removed"); refresh(); }
  }

  const verified = factors.filter((f) => f.status === "verified");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Your MFA</CardTitle>
        <CardDescription>TOTP via Authy, 1Password, Google Authenticator, etc.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {verified.length === 0 ? (
          <p className="text-sm text-muted-foreground">No MFA enrolled.</p>
        ) : verified.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
            <div>
              <Badge>Active</Badge>
              <span className="ml-2 font-mono text-xs text-muted-foreground">{f.friendly_name ?? f.factor_type}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => unenroll(f.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        {!enrolling ? (
          <Button disabled={busy} onClick={startEnroll}><Plus className="mr-1 h-3.5 w-3.5" /> Enroll authenticator</Button>
        ) : (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Scan the QR (or enter the secret) in your authenticator, then enter the 6-digit code.</p>
            <div className="flex justify-center bg-white p-2 rounded">
              <img
                alt="MFA QR code"
                width={192}
                height={192}
                src={
                  enrolling.qr.startsWith("data:")
                    ? enrolling.qr
                    : `data:image/svg+xml;base64,${typeof window !== "undefined" ? window.btoa(unescape(encodeURIComponent(enrolling.qr))) : ""}`
                }
              />
            </div>
            <code className="block break-all text-center text-xs">{enrolling.secret}</code>
            <Input placeholder="123456" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setEnrolling(null); setCode(""); }}>Cancel</Button>
              <Button size="sm" disabled={code.length !== 6 || busy} onClick={verify}>Verify</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const [sess, setSess] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setSess(null); return; }
      const { data: s } = await supabase.auth.getSession();
      setSess(s.session);
    })();
  }, []);
  async function signOutAll() {
    if (!confirm("Sign out from ALL devices?")) return;
    const { reportAuthEvent } = await import("@/lib/auth-audit");
    reportAuthEvent("auth.logout", { context: { scope: "global", source: "security_tab" } });
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) toast.error(error.message); else toast.success("Signed out everywhere");
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LogOut className="h-5 w-5" /> Sessions</CardTitle>
        <CardDescription>Your active session and global sign-out.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {sess ? (
          <>
            <div className="flex justify-between"><span className="text-muted-foreground">User</span><span>{sess.user?.email}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Token expires</span><span>{new Date(sess.expires_at * 1000).toLocaleString()}</span></div>
          </>
        ) : <p className="text-muted-foreground">No active session.</p>}
        <Button variant="destructive" size="sm" onClick={signOutAll}>Sign out everywhere</Button>
      </CardContent>
    </Card>
  );
}

function EventsCard({ tenantId }: { tenantId: string }) {
  const list = useServerFn(listSecurityEvents);
  const q = useQuery({ queryKey: ["sec-events", tenantId], queryFn: () => list({ data: { tenant_id: tenantId, limit: 100 } }) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Security events</CardTitle>
        <CardDescription>Rate-limit blocks, blocked uploads, suspicious sign-ins.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">Time</th><th className="px-4 py-2">Severity</th><th className="px-4 py-2">Event</th><th className="px-4 py-2">Context</th></tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r: any) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleString()}</td>
                <td className="px-4 py-2"><Badge variant={r.severity === "critical" ? "destructive" : r.severity === "warning" ? "secondary" : "outline"}>{r.severity}</Badge></td>
                <td className="px-4 py-2 font-mono text-xs">{r.event_type}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground truncate max-w-[420px]">{JSON.stringify(r.context)}</td>
              </tr>
            ))}
            {q.data && q.data.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No events yet. Example: jane.doe@demo-bank.example · recon.run.completed · Demo Bank Nostro USD · 2026-06-26 06:17 UTC.</td></tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
