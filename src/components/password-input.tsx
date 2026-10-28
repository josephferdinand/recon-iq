import type { ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePasswordPeek } from "@/hooks/use-password-peek";

type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type"> & {
  revealLabel?: string;
};

export function PasswordInput({
  revealLabel = "password",
  className,
  ...props
}: PasswordInputProps) {
  const peek = usePasswordPeek();

  return (
    <div className="relative">
      <Input
        {...props}
        aria-label={props["aria-label"] ?? revealLabel}
        type={peek.type}
        className={[className, "pr-11"].filter(Boolean).join(" ")}
      />
      <button
        type="button"
        aria-label={`${peek.visible ? "Hide" : "Show"} ${revealLabel}`}
        aria-pressed={peek.visible}
        title={`${peek.visible ? "Hide" : "Show"} ${revealLabel}`}
        disabled={props.disabled}
        onClick={peek.toggle}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {peek.visible ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
