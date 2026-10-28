import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

// LL-046 (Felix): LL-016 cycle-break. `const Switch = React.forwardRef(...)`
// emits `var init_switch = __esmMin(...)` in the bundle, which is `undefined`
// across the cyclic router-1 <-> router-2 edge at route-registration time,
// producing production 500 "init_switch is not a function". A hoisted
// `function` declaration exists at parse time (no `__esmMin` thunk) and
// survives the cycle. Same pattern as card.tsx (LL-043).

function Switch(props: React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>) {
  const { className, ref, ...rest } = props as React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & { ref?: React.Ref<React.ElementRef<typeof SwitchPrimitives.Root>> };
  return (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...rest}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitives.Root>
  );
}

export { Switch };
