import * as React from "react";

import { cn } from "@/lib/utils";

// LL-046 (Felix): LL-016 cycle-break. `const Input = React.forwardRef(...)`
// emits `var init_input = __esmMin(...)` in the bundle, which is `undefined`
// across the cyclic router-1 <-> router-2 edge at route-registration time,
// producing production 500 "init_input is not a function". A hoisted
// `function` declaration exists at parse time (no `__esmMin` thunk) and
// survives the cycle. Same pattern as card.tsx (LL-043).

function Input(props: React.ComponentProps<"input">) {
  const { className, type, ref, ...rest } = props as React.ComponentProps<"input"> & { ref?: React.Ref<HTMLInputElement> };
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={ref}
      {...rest}
    />
  );
}

export { Input };
