import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.object({
  redirect: z.string().optional(),
  tenant: z.string().trim().min(1).max(80).optional(),
  reset: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/auth", search, replace: true });
  },
});
