/**
 * D1 — IP allowlist enforcement helper.
 * Reads the client IP from the current TanStack Start request.
 */
import { getRequest } from "@tanstack/react-start/server";

export function getCurrentIp(): string | null {
  try {
    const req = getRequest();
    if (!req) return null;
    const h = req.headers;
    return (
      h.get("cf-connecting-ip") ||
      h.get("x-real-ip") ||
      (h.get("x-forwarded-for") || "").split(",")[0]?.trim() ||
      null
    );
  } catch { return null; }
}

export async function assertTenantIpAllowed(
  supabase: any,
  tenantId: string,
  userId?: string,
): Promise<void> {
  const { data: s } = await supabase
    .from("tenant_security_settings")
    .select("ip_allowlist_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!s?.ip_allowlist_enabled) return;

  const ip = getCurrentIp();
  if (!ip) {
    await supabase.from("security_events").insert({
      tenant_id: tenantId, user_id: userId ?? null, ip: null,
      event_type: "ip_allowlist.blocked", severity: "warning",
      context: { reason: "no_client_ip" },
    });
    throw new Error("Access denied: client IP could not be determined.");
  }

  const { data: ok } = await supabase.rpc("ip_in_tenant_allowlist", {
    _tenant_id: tenantId, _ip: ip,
  });
  if (!ok) {
    await supabase.from("security_events").insert({
      tenant_id: tenantId, user_id: userId ?? null, ip,
      event_type: "ip_allowlist.blocked", severity: "warning",
      context: { ip },
    });
    throw new Error("Access denied: your IP is not on this tenant's allowlist.");
  }
}
