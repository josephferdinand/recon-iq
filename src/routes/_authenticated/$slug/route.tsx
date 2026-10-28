import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

// LL-042 (Pri1): the parent `/_authenticated/$slug` route's loader uses
// `getTenantBySlug` from `@/lib/tenants.functions`. That module sits on the
// router-1 <-> router-2 cyclic edge, and its `init_tenants_functions` thunk is
// `undefined` across the cycle at route-registration time (LL-016 / LL-039 /
// LL-040 / LL-041 all attempted to break the cycle without fully succeeding).
//
// `import()` instead of a static `import` defers the binding until after the
// router tree has finished registering. By that point, both router-1 and
// router-2 have evaluated and `getTenantBySlug` is reachable via the regular
// module graph (not via the cyclic `__esmMin`-wrapped `init_tenants_functions`
// binding that the static import produced).
//
// The dynamic import is resolved once per loader call (TanStack Start's loader
// runs on the server during SSR). It does not affect client-side behavior
// because the loader is server-only.

function TenantErrorComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div role="alert" className="max-w-md rounded-xl border border-warning/40 bg-warning/5 p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 h-7 w-7 text-warning" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Access information temporarily unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We could not verify access to this workspace right now. Your permissions have not necessarily changed.
          Please try again shortly or contact support if the issue continues.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium">Try again</button>
          <Link
            to="/home"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function TenantNotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto mb-3 h-7 w-7 text-warning" aria-hidden />
        <h1 className="text-xl font-semibold text-foreground">Workspace Unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We could not display this workspace. It may not exist, or your account may not have access.
          Check the address or contact your administrator if you believe this is incorrect.
        </p>
        <div className="mt-6">
          <Link
            to="/home"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/$slug")({
  loader: async ({ params }) => {
    try {
      // LL-042: dynamic import to defer resolution past the router-1 <->
      // router-2 cycle (see file header).
      const { getTenantBySlug } = await import("@/lib/tenants.functions");
      const tenant = await getTenantBySlug({ data: { slug: params.slug } });
      return { tenant };
    } catch (error) {
      if (error instanceof Error && (error.message === "Tenant not found" || error.message === "Forbidden")) {
        throw redirect({ to: "/home" });
      }
      throw error;
    }
  },
  errorComponent: TenantErrorComponent,
  notFoundComponent: TenantNotFoundComponent,
  component: () => <Outlet />,
});
