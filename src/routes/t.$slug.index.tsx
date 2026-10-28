import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/t/$slug/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/t/$slug/auth", params: { slug: params.slug } });
  },
});
