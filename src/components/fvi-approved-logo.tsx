import { cn } from "@/lib/utils";
import { FVMonogram } from "@/components/fv-monogram";

type FviApprovedLogoProps = {
  className?: string;
};

/** Renders the ReconIQ brand seal (RQ monogram) at the requested size. */
export function FviApprovedLogo({
  className,
}: FviApprovedLogoProps) {
  return (
    <span className={cn("block aspect-square h-16 w-16 shrink-0", className)}>
      <FVMonogram className="block h-full w-full" />
      <span className="sr-only">ReconIQ</span>
    </span>
  );
}
