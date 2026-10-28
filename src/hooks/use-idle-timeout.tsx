import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { reportAuthEvent } from "@/lib/auth-audit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const IDLE_MS = 30 * 60 * 1000;
const WARN_MS = 60 * 1000;
const ACTIVITY = ["mousemove", "keydown", "click", "scroll", "touchstart"];

export function IdleTimeoutGuard() {
  const [warn, setWarn] = useState(false);
  const [count, setCount] = useState(60);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const signOut = async () => {
    reportAuthEvent("auth.logout", { context: { reason: "idle_timeout" } });
    await supabase.auth.signOut();
    if (typeof window !== "undefined") window.location.assign("/auth");
  };

  const reset = () => {
    if (warn) return;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (warnTimer.current) clearTimeout(warnTimer.current);
    idleTimer.current = setTimeout(() => {
      setWarn(true);
      setCount(60);
      warnTimer.current = setTimeout(signOut, WARN_MS);
      tickTimer.current = setInterval(() => setCount((c) => Math.max(0, c - 1)), 1000);
    }, IDLE_MS - WARN_MS);
  };

  const stayActive = () => {
    setWarn(false);
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    reset();
  };

  useEffect(() => {
    reset();
    ACTIVITY.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, reset));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (warnTimer.current) clearTimeout(warnTimer.current);
      if (tickTimer.current) clearInterval(tickTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AlertDialog open={warn}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still there?</AlertDialogTitle>
          <AlertDialogDescription>
            For your security, you'll be signed out in <span className="font-semibold text-foreground">{count}s</span> due to inactivity.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={signOut}>Sign out now</AlertDialogCancel>
          <AlertDialogAction onClick={stayActive}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
