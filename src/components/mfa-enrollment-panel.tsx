import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Smartphone, KeyRound, Trash2, RefreshCcw, Check, Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  listMyTotp, enrollTotp, verifyTotp, disableTotp,
  listMySms, enrollSms, disableSms, sendSmsCode, verifySmsCode,
} from "@/lib/platform-gap-batch2.functions";

function fmt(ts?: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export function MfaEnrollmentPanel() {
  const qc = useQueryClient();
  const lt = useServerFn(listMyTotp);
  const et = useServerFn(enrollTotp);
  const vt = useServerFn(verifyTotp);
  const dt = useServerFn(disableTotp);
  const ls = useServerFn(listMySms);
  const es = useServerFn(enrollSms);
  const ds = useServerFn(disableSms);
  const ss = useServerFn(sendSmsCode);
  const vs = useServerFn(verifySmsCode);

  const totp = useQuery({ queryKey: ["mfa", "totp"], queryFn: () => lt() });
  const sms = useQuery({ queryKey: ["mfa", "sms"], queryFn: () => ls() });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Multi-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="totp">
          <TabsList>
            <TabsTrigger value="totp"><KeyRound className="mr-2 h-4 w-4" />Authenticator (TOTP)</TabsTrigger>
            <TabsTrigger value="sms"><Smartphone className="mr-2 h-4 w-4" />SMS OTP</TabsTrigger>
          </TabsList>

          <TabsContent value="totp" className="space-y-4">
            <TotpSection
              rows={totp.data ?? []}
              onEnroll={async (label) => {
                const r = await et({ data: { label } });
                qc.invalidateQueries({ queryKey: ["mfa", "totp"] });
                return r;
              }}
              onVerify={async (id, code) => {
                await vt({ data: { id, code } });
                qc.invalidateQueries({ queryKey: ["mfa", "totp"] });
              }}
              onDisable={async (id) => {
                await dt({ data: { id } });
                qc.invalidateQueries({ queryKey: ["mfa", "totp"] });
              }}
            />
          </TabsContent>

          <TabsContent value="sms" className="space-y-4">
            <SmsSection
              rows={(sms.data as any)?.rows ?? []}
              onEnroll={async (phone_e164) => {
                await es({ data: { phone_e164 } });
                qc.invalidateQueries({ queryKey: ["mfa", "sms"] });
              }}
              onSend={async (id) => {
                const r = await ss({ data: { id } });
                qc.invalidateQueries({ queryKey: ["mfa", "sms"] });
                return r as { delivered: boolean; provider_reason: string | null };
              }}
              onVerify={async (id, code) => {
                await vs({ data: { id, code } });
                qc.invalidateQueries({ queryKey: ["mfa", "sms"] });
              }}
              onDisable={async (id) => {
                await ds({ data: { id } });
                qc.invalidateQueries({ queryKey: ["mfa", "sms"] });
              }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/* ── TOTP ─────────────────────────────────────────────────────────────── */
function TotpSection(props: {
  rows: any[];
  onEnroll: (label: string) => Promise<{ id: string; secret: string; otpauth_uri: string }>;
  onVerify: (id: string, code: string) => Promise<void>;
  onDisable: (id: string) => Promise<void>;
}) {
  const [label, setLabel] = useState("Authenticator");
  const [enrolled, setEnrolled] = useState<{ id: string; secret: string; otpauth_uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!enrolled) { setQr(null); return; }
    QRCode.toDataURL(enrolled.otpauth_uri, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [enrolled]);

  const mEnroll = useMutation({
    mutationFn: () => props.onEnroll(label.trim() || "Authenticator"),
    onSuccess: (r) => setEnrolled(r),
    onError: (e: any) => toast.error(e?.message ?? "Enrollment failed"),
  });
  const mVerify = useMutation({
    mutationFn: () => props.onVerify(enrolled!.id, code),
    onSuccess: () => { toast.success("TOTP verified"); setEnrolled(null); setCode(""); },
    onError: (e: any) => toast.error(e?.message ?? "Verify failed"),
  });
  const mDisable = useMutation({
    mutationFn: (id: string) => props.onDisable(id),
    onSuccess: () => toast.success("Authenticator removed"),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Time-based one-time passwords (RFC 6238). Scan the QR into any authenticator app (1Password, Authy, Google Authenticator, Microsoft Authenticator) and enter the 6-digit code to verify.
      </p>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="totp-label">Label</Label>
          <Input id="totp-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Work phone" />
        </div>
        <Button onClick={() => mEnroll.mutate()} disabled={mEnroll.isPending}>Enroll authenticator</Button>
      </div>

      {enrolled && (
        <Alert>
          <AlertTitle>Scan and verify</AlertTitle>
          <AlertDescription className="space-y-3">
            {qr && <img src={qr} alt="TOTP QR code" className="rounded border bg-background p-2" width={220} height={220} />}
            <div className="space-y-1">
              <Label className="text-xs">Manual entry secret</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted p-2 font-mono text-xs break-all">{enrolled.secret}</code>
                <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(enrolled.secret); toast.success("Copied"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="totp-code">6-digit code</Label>
                <Input id="totp-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} inputMode="numeric" placeholder="123456" />
              </div>
              <Button onClick={() => mVerify.mutate()} disabled={code.length !== 6 || mVerify.isPending}>
                <Check className="mr-2 h-4 w-4" /> Verify
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left"><tr><th className="p-2">Label</th><th className="p-2">Status</th><th className="p-2">Last used</th><th className="p-2">Created</th><th className="p-2 text-right">Actions</th></tr></thead>
          <tbody>
            {props.rows.length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={5}>No authenticators enrolled.</td></tr>}
            {props.rows.map((r: any) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.label}</td>
                <td className="p-2">{r.verified ? <Badge variant="secondary">Verified</Badge> : <Badge>Pending</Badge>}</td>
                <td className="p-2 text-xs">{fmt(r.last_used_at)}</td>
                <td className="p-2 text-xs">{fmt(r.created_at)}</td>
                <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => mDisable.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── SMS ──────────────────────────────────────────────────────────────── */
function SmsSection(props: {
  rows: any[];
  onEnroll: (phone_e164: string) => Promise<void>;
  onSend: (id: string) => Promise<{ delivered: boolean; provider_reason: string | null }>;
  onVerify: (id: string, code: string) => Promise<void>;
  onDisable: (id: string) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [providerNote, setProviderNote] = useState<string | null>(null);

  const mEnroll = useMutation({
    mutationFn: () => props.onEnroll(phone),
    onSuccess: () => { toast.success("Phone added"); setPhone(""); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const mSend = useMutation({
    mutationFn: (id: string) => props.onSend(id),
    onSuccess: (r) => {
      if (r.delivered) { toast.success("Code sent"); setProviderNote(null); }
      else { toast.warning("Code stored but not delivered"); setProviderNote(r.provider_reason); }
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const mVerify = useMutation({
    mutationFn: (v: { id: string; code: string }) => props.onVerify(v.id, v.code),
    onSuccess: (_v, args) => { toast.success("Phone verified"); setCodes((c) => ({ ...c, [args.id]: "" })); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const mDisable = useMutation({
    mutationFn: (id: string) => props.onDisable(id),
    onSuccess: () => toast.success("Phone removed"),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>Twilio credentials live in the in-app Vault</AlertTitle>
        <AlertDescription className="text-xs">
          Add <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, and <code>TWILIO_FROM_NUMBER</code> as platform-scope <em>integration_token</em> secrets in Platform → Vault. Delivery goes directly to <code>api.twilio.com</code> — no third-party AI gateway, no connector gateway, no environment variables.
        </AlertDescription>
      </Alert>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="sms-phone">Phone (E.164)</Label>
          <Input id="sms-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15558675310" maxLength={16} />
        </div>
        <Button onClick={() => mEnroll.mutate()} disabled={!/^\+[1-9]\d{6,14}$/.test(phone) || mEnroll.isPending}>Add phone</Button>
      </div>

      {providerNote && (
        <Alert variant="destructive">
          <AlertTitle>Twilio not delivering yet</AlertTitle>
          <AlertDescription className="text-xs">{providerNote}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left"><tr><th className="p-2">Phone</th><th className="p-2">Status</th><th className="p-2">Last sent</th><th className="p-2">Verify</th><th className="p-2 text-right">Actions</th></tr></thead>
          <tbody>
            {props.rows.length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={5}>No phones registered.</td></tr>}
            {props.rows.map((r: any) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 font-mono text-xs">{r.phone_e164}</td>
                <td className="p-2">{r.verified ? <Badge variant="secondary">Verified</Badge> : <Badge>Pending</Badge>}</td>
                <td className="p-2 text-xs">{fmt(r.last_sent_at)}</td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => mSend.mutate(r.id)} disabled={mSend.isPending}>
                      <RefreshCcw className="mr-1 h-3 w-3" /> Send
                    </Button>
                    <Input
                      value={codes[r.id] ?? ""}
                      onChange={(e) => setCodes((c) => ({ ...c, [r.id]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                      placeholder="6-digit"
                      className="w-24 font-mono"
                      maxLength={6}
                      inputMode="numeric"
                    />
                    <Button
                      size="sm"
                      onClick={() => mVerify.mutate({ id: r.id, code: codes[r.id] ?? "" })}
                      disabled={(codes[r.id] ?? "").length !== 6 || mVerify.isPending}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
                <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => mDisable.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
