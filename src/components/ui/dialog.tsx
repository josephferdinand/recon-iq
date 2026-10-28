"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// LL-046 (Felix): LL-016 cycle-break. `const X = React.forwardRef(...)`
// emits `var init_dialog = __esmMin(...)` in the bundle, which is `undefined`
// across the cyclic router-1 <-> router-2 edge at route-registration time,
// producing production 500 "init_dialog is not a function". A hoisted
// `function` declaration exists at parse time (no `__esmMin` thunk) and
// survives the cycle. Same pattern as card.tsx (LL-043).

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

function DialogOverlay(props: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  const { className, ref, ...rest } = props as React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & { ref?: React.Ref<React.ElementRef<typeof DialogPrimitive.Overlay>> };
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...rest}
    />
  );
}

function DialogContent(props: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  const { className, children, ref, ...rest } = props as React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { ref?: React.Ref<React.ElementRef<typeof DialogPrimitive.Content>> };
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-[calc(100vw-1.5rem)] sm:w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border/80 border-t-2 [border-top-color:var(--gold)] bg-popover p-6 text-popover-foreground shadow-[0_30px_80px_-28px_rgba(5,12,26,0.42)] ring-1 ring-border/50 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none motion-reduce:transition-none",
          className,
        )}
        {...rest}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-md bg-secondary/70 text-muted-foreground ring-offset-background cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 pr-10 text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-2 flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end sm:space-x-2", className)}
      {...props}
    />
  );
}

function DialogTitle(props: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  const { className, ref, ...rest } = props as React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & { ref?: React.Ref<React.ElementRef<typeof DialogPrimitive.Title>> };
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("font-display text-lg font-semibold leading-tight tracking-tight text-foreground sm:text-xl", className)}
      {...rest}
    />
  );
}

function DialogDescription(props: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  const { className, ref, ...rest } = props as React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & { ref?: React.Ref<React.ElementRef<typeof DialogPrimitive.Description>> };
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...rest}
    />
  );
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
