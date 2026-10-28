import { useEffect, useState } from "react";
import { parseHost, type HostInfo } from "@/lib/tenant-host.functions";

/** Client-side hook: parse window.location.host into { kind, slug, env }. */
export function useTenantHost(): HostInfo | null {
  const [info, setInfo] = useState<HostInfo | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setInfo(parseHost(window.location.host));
  }, []);
  return info;
}
