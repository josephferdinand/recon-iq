import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { grantStepUp, type StepUpAction } from "@/lib/step-up.functions";

interface StepUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The action key you'll pass through to the server-fn. */
  actionKey: StepUpAction;
  /** Human label describing what the caller is about to do. */
  actionLabel: string;
  /** Called after step-up succeeds. Return a promise so we can spin. */
  onGranted: () => Promise<void> | void;
}

/**
 * Step-up MFA prompt. Re-verifies the current user's password, mints a
 * 5-minute grant on the server (public.step_up_grants), then invokes
 * onGranted() which should immediately call the privileged server-fn.
 *
 * If the user already holds an active break-glass grant covering the action,
 * the server accepts the call without a fresh step-up — this dialog is skipped
 * by using useStepUpFlow() which tries the call first and only opens on 401.
 */
export function StepUpDialog({
  open, onOpenChange, actionKey, actionLabel, onGranted,
}: StepUpDialogProps) {
  const grantFn = useServerFn(grantStepUp);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await grantFn({ data: { actionKey, password } });
      setPassword("");
      onOpenChange(false);
      await onGranted();
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "Invalid password";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Step-up authentication required
          </DialogTitle>
          <DialogDescription>
            Confirm your identity to <strong className="text-foreground">{actionLabel}</strong>.
            Every privileged action is recorded in the tamper-evident audit log.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Alert variant="default">
            <KeyRound className="h-4 w-4" />
            <AlertTitle className="text-xs">Grant valid for 5 minutes</AlertTitle>
            <AlertDescription className="text-xs">
              Action key <code className="rounded bg-muted px-1">{actionKey}</code>.
              Use Break-glass for pre-approved incident bypass.
            </AlertDescription>
          </Alert>
          <div className="space-y-2">
            <Label htmlFor="stepup-password">Current password</Label>
            <PasswordInput
              id="stepup-password"
              revealLabel="current password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || password.length === 0}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify &amp; continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook that wraps a privileged mutation: attempts the call first, and if the
 * server responds 401 "Step-up authentication required" opens the dialog,
 * then retries. Also short-circuits when a break-glass grant is already active
 * (server handles that transparently).
 */
export function useStepUpFlow<Args>(opts: {
  actionKey: StepUpAction;
  actionLabel: string;
  run: (args: Args) => Promise<unknown>;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Args | null>(null);
  const [busy, setBusy] = useState(false);

  async function attempt(args: Args) {
    setBusy(true);
    try {
      await opts.run(args);
      opts.onSuccess?.();
    } catch (ex: any) {
      const msg = ex?.message ?? String(ex);
      const status = ex?.status ?? ex?.response?.status;
      if (status === 401 || /step[- ]up/i.test(msg)) {
        setPending(args);
        setOpen(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <StepUpDialog
      open={open}
      onOpenChange={setOpen}
      actionKey={opts.actionKey}
      actionLabel={opts.actionLabel}
      onGranted={async () => {
        if (!pending) return;
        await attempt(pending);
        setPending(null);
      }}
    />
  );

  return { trigger: attempt, dialog, busy };
}
