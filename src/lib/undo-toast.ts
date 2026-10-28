import { toast } from "sonner";

export function withUndo(opts: {
  message: string;
  description?: string;
  onUndo: () => void | Promise<void>;
  durationMs?: number;
}) {
  let undone = false;
  toast(opts.message, {
    description: opts.description,
    duration: opts.durationMs ?? 6000,
    action: {
      label: "Undo",
      onClick: async () => {
        if (undone) return;
        undone = true;
        try { await opts.onUndo(); toast.success("Undone"); }
        catch (e: any) { toast.error(e?.message ?? "Failed to undo"); }
      },
    },
  });
}
