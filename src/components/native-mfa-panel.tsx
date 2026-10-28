import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reportAuthEvent } from "@/lib/auth-audit";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Factor = { id: string; factor_type: string; friendly_name?: string; status: string };

export function NativeMfaPanel({ onChanged }: { onChanged?: () => void }) {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState<null | { id: string; qr: string; secret: string }>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    setFactors((data?.all ?? []) as Factor[]);
  }

  useEffect(() => {
    refresh().catch(() => setFactors([]));
  }, []);

  async function startEnroll() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "ReconIQ Authenticator",
      });
      if (error) throw error;
      setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Enrollment failed";
      reportAuthEvent("auth.mfa_enroll_failed", { context: { message } });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!enrolling) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrolling.id,
        code,
      });
      if (error) throw error;
      toast.success("Authenticator enrolled and login protection enabled");
      setEnrolling(null);
      setCode("");
      await refresh();
      onChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed";
      reportAuthEvent("auth.mfa_failed", { context: { message } });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function unenroll(id: string) {
    if (!window.confirm("Remove this login authenticator?")) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      toast.success("Authenticator removed");
      await refresh();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove authenticator");
    } finally {
      setBusy(false);
    }
  }

  const verified = factors.filter((factor) => factor.status === "verified");

  return (
    <div className="space-y-4">
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Login-enforced authenticator</AlertTitle>
        <AlertDescription>
          This uses Supabase Auth MFA and upgrades the signed-in session to AAL2. Legacy ReconIQ
          authenticator records do not satisfy this login gate.
        </AlertDescription>
      </Alert>

      {verified.length === 0 ? (
        <p className="text-sm text-muted-foreground">No login authenticator is enrolled.</p>
      ) : (
        <div className="space-y-2">
          {verified.map((factor) => (
            <div key={factor.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge>Login protected</Badge>
                <span>{factor.friendly_name ?? "Authenticator app"}</span>
              </div>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => unenroll(factor.id)} aria-label="Remove login authenticator">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {!enrolling ? (
        <Button type="button" onClick={startEnroll} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Enroll login authenticator
        </Button>
      ) : (
        <div className="space-y-4 rounded-lg border p-4">
          <p className="text-sm">Scan this QR code, then enter the current six-digit code.</p>
          <div className="flex justify-center rounded-md bg-white p-3">
            <img
              src={enrolling.qr.startsWith("data:") ? enrolling.qr : `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(enrolling.qr)))}`}
              alt="Authenticator enrollment QR code"
              width={220}
              height={220}
            />
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Cannot scan? Show manual key</summary>
            <code className="mt-2 block break-all rounded bg-muted p-2">{enrolling.secret}</code>
          </details>
          <div className="space-y-1.5">
            <Label htmlFor="native-mfa-enrollment-code">Six-digit code</Label>
            <Input
              id="native-mfa-enrollment-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setEnrolling(null); setCode(""); }} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={verify} disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Verify and enable
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
