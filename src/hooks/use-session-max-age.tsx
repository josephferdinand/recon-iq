import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { reportAuthEvent } from "@/lib/auth-audit";

/**
 * D1 — Client-side session max-age enforcement.
 * Polls every 60s; if the current session is older than `maxAgeMinutes`,
 * signs the user out globally.
 */
export function useSessionMaxAge(maxAgeMinutes?: number | null) {
  useEffect(() => {
    if (!maxAgeMinutes || maxAgeMinutes <= 0) return;
    let cancelled = false;
    const maxMs = maxAgeMinutes * 60 * 1000;

    async function check() {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (!s) return;
      // Supabase tokens encode iat; we approximate session start with
      // expires_at - expires_in (seconds).
      const issuedAtSec =
        (s.expires_at ?? 0) - (s.expires_in ?? 3600);
      const ageMs = Date.now() - issuedAtSec * 1000;
      if (ageMs > maxMs) {
        if (cancelled) return;
        toast.warning("Session expired — please sign in again.");
        reportAuthEvent("auth.logout", { context: { reason: "max_age", maxAgeMinutes } });
        await supabase.auth.signOut({ scope: "global" });
        if (typeof window !== "undefined") window.location.assign("/auth");
      }
    }
    check();
    const id = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [maxAgeMinutes]);
}
