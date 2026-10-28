import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * `/mkt-admin/roles` is an alias for `/mkt-admin/users` (Users & Roles).
 * Client-side <Navigate/> avoids re-entering the parent `beforeLoad` guard
 * mid-redirect, which was rendering an empty layout.
 */
export const Route = createFileRoute("/mkt-admin/roles")({
  component: () => <Navigate to="/mkt-admin/users" replace />,
});
