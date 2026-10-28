import { createFileRoute, Navigate, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/$slug/hub/exceptions")({
  head: () => ({
    meta: [
      { title: "Exception Workbench — Workspace | ReconIQ" },
      { name: "description", content: "One workbench around the four exception surfaces: triage, comments, assignments, resolution." },
    ],
  }),
  component: ExceptionWorkbench,
});

function ExceptionWorkbench() {
  const { slug } = useParams({ from: "/_authenticated/$slug/hub/exceptions" });
  return <Navigate to="/$slug/workspace" params={{ slug }} search={{ page: "exceptions" }} replace />;
}
