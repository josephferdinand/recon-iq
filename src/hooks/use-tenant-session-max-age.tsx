import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSecuritySettings } from "@/lib/security.functions";
import { useSessionMaxAge } from "@/hooks/use-session-max-age";

/**
 * D1 — Reads the tenant's session_max_age_minutes and enforces it client-side.
 */
export function useTenantSessionMaxAge(tenantId: string | undefined) {
  const get = useServerFn(getSecuritySettings);
  const q = useQuery({
    queryKey: ["sec-settings-min", tenantId],
    queryFn: () => get({ data: { tenant_id: tenantId! } }),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });
  useSessionMaxAge(q.data?.session_max_age_minutes);
}
