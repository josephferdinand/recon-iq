import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { myMktRoles } from "@/lib/mkt-admin.functions";

/**
 * Marketing site footer link to /mkt-admin.
 * Rendered only when the visitor holds the `super_admin` mkt role.
 * For anonymous visitors and non-admin signed-in users the query returns
 * `[]` (server function is auth-gated; on failure we treat as anonymous)
 * and nothing is rendered.
 */
export function SiteAdminFooterLink() {
  const rolesFn = useServerFn(myMktRoles);
  const q = useQuery({
    queryKey: ["mkt", "footer-roles"],
    queryFn: async () => {
      try { return await rolesFn({ data: undefined }); }
      catch { return [] as string[]; }
    },
    staleTime: 60_000,
    retry: false,
  });
  const roles = q.data ?? [];
  if (!roles.includes("super_admin")) return null;
  return (
    <Link
      to="/mkt-admin"
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition hover:brightness-110"
      style={{
        background: "color-mix(in oklab, var(--brand-cream) 4%, transparent)",
        border: "1px solid color-mix(in oklab, var(--brand-gold) 22%, transparent)",
        color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)",
      }}
      title="Marketing site admin — super_admin only"
    >
      <ShieldCheck className="h-3 w-3" /> Site admin
    </Link>
  );
}
