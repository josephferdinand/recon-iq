// LL-039: pure helpers, no server-side dependencies, no cyclic imports.
// Kept in its own file so rolldown doesn't merge this with route-tree chunks.

export function mergeTenantsForUser(input: {
  memberships: Array<{ role: string; tenant: any } | any>;
  isPlatformAdmin: boolean;
  isPlatformMember: boolean;
  allTenants: any[];
}) {
  const memberTenants = (input.memberships ?? []).map((r: any) =>
    r.tenant ? { ...r.tenant, role: r.role } : r,
  );
  if (!input.isPlatformAdmin && !input.isPlatformMember) return memberTenants;
  const extraRole = input.isPlatformAdmin ? "platform_admin" : "platform_member";
  const seen = new Set(memberTenants.map((t: any) => t.id));
  const extras = (input.allTenants ?? [])
    .filter((t: any) => !seen.has(t.id))
    .map((t: any) => ({ ...t, role: extraRole }));
  return [...memberTenants, ...extras];
}