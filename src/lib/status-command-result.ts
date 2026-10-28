import { z } from "zod";

export const statusCommandReceiptSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), workflow_state: z.string(), request_id: z.string().uuid(),
});
export const statusCommandRefusalSchema = z.object({
  outcome: z.literal("refused"), code: z.enum(["PT409", "42501", "P0001", "22023"]),
  request_id: z.string().uuid(), denial_id: z.string().regex(/^\d+$/),
});
export const statusCommandResultSchema = z.union([statusCommandRefusalSchema, statusCommandReceiptSchema]);
export function statusRefusalMessage(code: string) {
  if (code === "PT409") return "This incident changed. Refresh the queue and review its latest revision before submitting again.";
  if (code === "42501") return "This action requires current administrator access, verified MFA and an independent reviewer. Check your access and the review state.";
  return "The incident action was refused. Review the required fields, registered scope and workflow state before submitting again.";
}
