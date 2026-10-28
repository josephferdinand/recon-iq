"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// LL-046 (Felix): LL-016 cycle-break. `const Label = React.forwardRef(...)`
// emits `var init_label = __esmMin(...)` in the bundle, which is `undefined`
// across the cyclic router-1 <-> router-2 edge at route-registration time,
// producing production 500 "init_label is not a function". A hoisted
// `function` declaration exists at parse time (no `__esmMin` thunk) and
// survives the cycle. Same pattern as card.tsx (LL-043).

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
);

function Label(props: React.ComponentPropsWithRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>) {
  const { className, ref, ...rest } = props;
  return <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...rest} />;
}

export { Label };
