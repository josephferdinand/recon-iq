import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { TemplateMarketplace } from "@/components/template-marketplace";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/$slug/workspace/templates")({
  head: () => ({
    meta: [
      { title: "My Templates — Workspace | ReconIQ" },
      {
        name: "description",
        content:
          "My Templates — the workspace consumption surface for tenant-installed templates. Assign to teams and control permissions.",
      },
    ],
  }),
  component: WorkspaceTemplatesPage,
});

function WorkspaceTemplatesPage() {
  const { slug } = Route.useParams();
  const tenantFn = useServerFn(getTenantBySlug);
  const tenantQ = useQuery({
    queryKey: ["tenant", slug],
    queryFn: () => tenantFn({ data: { slug } }),
  });

  const workspaceQ = useQuery({
    enabled: !!tenantQ.data?.id,
    queryKey: ["default-workspace", tenantQ.data?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id,name")
        .eq("tenant_id", tenantQ.data!.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">
          Workspace
        </p>
        <h1 className="text-3xl font-semibold">My Templates</h1>
        <p className="text-muted-foreground mt-1">
          {workspaceQ.data?.id
            ? "Browse tenant templates. Use Assignments below to review or manage this workspace’s template access and permissions."
            : "Browse tenant templates. Workspace assignments become available when a workspace exists."}
        </p>
        {workspaceQ.data?.name ? (
          <p className="mt-2 text-sm font-medium">Workspace: {workspaceQ.data.name}</p>
        ) : null}
      </header>
      {tenantQ.data?.id ? (
        <TemplateMarketplace
          scope={{
            kind: "workspace",
            workspaceId: workspaceQ.data?.id,
            tenantId: tenantQ.data.id,
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {tenantQ.isPending
            ? "Loading tenant…"
            : tenantQ.isSuccess && !tenantQ.data?.id
              ? "Tenant information is unavailable."
            : null}
        </p>
      )}
      {tenantQ.data?.id && workspaceQ.isSuccess && !workspaceQ.data ? (
        <p className="mt-3 text-sm text-muted-foreground">No workspace found for this tenant. Tenant templates remain visible; assignments are unavailable.</p>
      ) : null}
      {tenantQ.isError ? (
        <div role="alert" className="mt-4 rounded-md border p-4">
          <p className="text-sm">Tenant information could not be loaded.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => tenantQ.refetch()} disabled={tenantQ.isFetching}>
            {tenantQ.isFetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      ) : null}
      {workspaceQ.isError ? (
        <div role="alert" className="mt-4 rounded-md border p-4">
          <p className="text-sm">Workspace information could not be loaded.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => workspaceQ.refetch()} disabled={workspaceQ.isFetching}>
            {workspaceQ.isFetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      ) : null}
    </main>
  );
}
