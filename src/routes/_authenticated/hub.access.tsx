import { createFileRoute } from "@tanstack/react-router";
import { HubShell } from "@/components/hub-shell";
import { ShieldCheck, Users, KeyRound, GitBranch, ShieldAlert, Fingerprint } from "lucide-react";

export const Route = createFileRoute("/_authenticated/hub/access")({
  head: () => ({
    meta: [
      { title: "Access Control — Platform | ReconIQ" },
      { name: "description", content: "Roles, permissions, diagnostics, SoD rules, break-glass, and identity sync." },
    ],
  }),
  component: () => (
    <HubShell
      eyebrow="Platform"
      title="Access Control"
      intro="Single hub for identity, roles, permissions, SoD, and just-in-time elevation across every scope."
      entries={[
        { title: "Roles & permissions", description: "Role-permission matrix across scopes.", href: "/platform?page=role-matrix", icon: ShieldCheck },
        { title: "Members & role bundles", description: "Assign roles, review bundles.", href: "/platform?page=rbac", icon: Users },
        { title: "Access explorer", description: "Inspect any user's effective access.", href: "/platform?page=access-explorer", icon: Fingerprint },
        { title: "RBAC diagnostics", description: "Policy simulations, orphan grants, coverage.", href: "/platform?page=rbac-diagnostics", icon: GitBranch },
        { title: "Break-glass", description: "Emergency elevation grants and approvals.", href: "/platform?page=break-glass", icon: ShieldAlert },
        { title: "Identity sync (SCIM)", description: "SCIM tokens, provisioning, sync log.", href: "/platform?page=auth-providers", icon: KeyRound },
      ]}
    />
  ),
});
