import * as React from "react";

// LL-046 (Felix): see LL-016, LL-043 cycle-fix lineage.
//
// This file MUST have zero module-top-level side effects so that rolldown
// emits no `init_card = __esmMin(...)` thunk at all. Even an
// `init_utils();` call inside the card module body (because of the `cn`
// import from `@/lib/utils`) triggers the cyclic TDZ binding.
//
// Inline a minimal cn() here to drop the dependency on `@/lib/utils`,
// which itself sits on the router cycle.

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}

function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ref, ...rest } = props as React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
  return <div ref={ref} data-slot="card" className={cn("rounded-xl border bg-card text-card-foreground shadow", className)} {...rest} />;
}

function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ref, ...rest } = props as React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
  return <div ref={ref} data-slot="card-header" className={cn("flex flex-col space-y-1.5 p-6", className)} {...rest} />;
}

function CardTitle(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ref, ...rest } = props as React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
  return <div ref={ref} data-slot="card-title" className={cn("font-semibold leading-none tracking-tight", className)} {...rest} />;
}

function CardDescription(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ref, ...rest } = props as React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
  return <div ref={ref} data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...rest} />;
}

function CardContent(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ref, ...rest } = props as React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
  return <div ref={ref} data-slot="card-content" className={cn("p-6", className)} {...rest} />;
}

function CardFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ref, ...rest } = props as React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
  return <div ref={ref} data-slot="card-footer" className={cn("flex items-center p-6", className)} {...rest} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
