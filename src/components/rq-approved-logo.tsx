import { cn } from "@/lib/utils";
import { RQSeal } from "@/components/rq-seal";

type RQApprovedLogoProps = {
  className?: string;
};

/** Renders the ReconIQ brand seal (RQ monogram) at the requested size. */
export function RQApprovedLogo({
  className,
}: RQApprovedLogoProps) {
  return (
    <span className={cn("block aspect-square h-16 w-16 shrink-0", className)}>
      <RQSeal className="block h-full w-full" />
      <span className="sr-only">ReconIQ</span>
    </span>
  );
}
