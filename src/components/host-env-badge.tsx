import { useTenantHost } from "@/hooks/use-tenant-host";
import { Badge } from "@/components/ui/badge";

/** Small persistent badge identifying the current tenant + environment, driven by the Host header.
 *  Only renders on real tenant hosts ({slug}.reconiq.example / {slug}-dev.reconiq.example / ...).
 *  Hidden on localhost, preview, marketing apex, and platform host.
 */
export function HostEnvBadge() {
  const host = useTenantHost();
  if (!host || host.kind !== "tenant" || !host.slug) return null;

  const tone =
    host.env === "prod" ? "default"
    : host.env === "dev" ? "secondary"
    : "outline";

  return (
    <div className="fixed bottom-3 left-3 z-50 pointer-events-none">
      <Badge variant={tone as any} className="font-mono text-[10px] uppercase tracking-wide">
        {host.slug} · {String(host.env)}
      </Badge>
    </div>
  );
}
