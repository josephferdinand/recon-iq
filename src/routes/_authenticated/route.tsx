import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { requiresMfaChallenge } from "@/lib/mfa-assurance";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (
      assurance.error ||
      !assurance.data ||
      !["aal1", "aal2"].includes(assurance.data.currentLevel ?? "") ||
      !["aal1", "aal2"].includes(assurance.data.nextLevel ?? "")
    ) {
      throw new Error("Security check temporarily unavailable. Please retry.");
    }
    if (
      requiresMfaChallenge(assurance.data) &&
      location.pathname !== "/profile/security"
    ) {
      throw redirect({
        to: "/mfa-challenge",
        search: { redirect: `${location.pathname}${location.searchStr || ""}` },
      });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
