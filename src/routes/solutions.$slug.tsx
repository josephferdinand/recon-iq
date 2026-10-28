import { createFileRoute, Link, notFound, type ErrorComponentProps } from "@tanstack/react-router";
import { SolutionPage } from "@/components/solution-page";
import { SOLUTIONS } from "@/lib/solutions-data";

export const Route = createFileRoute("/solutions/$slug")({
  loader: ({ params }) => {
    const spec = SOLUTIONS[params.slug];
    if (!spec) throw notFound();
    // Keep loader data serializable. Solution specifications include icon
    // components and must not be placed in the SSR hydration payload.
    return { slug: params.slug };
  },
  head: ({ params }) => {
    const spec = SOLUTIONS[params.slug];
    if (!spec) {
      return {
        meta: [
          { title: "Solution not found — ReconIQ" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const url = `https://app-fvi.reconiq.example/solutions/${params.slug}`;
    const title = `${spec.eyebrow} — ReconIQ`;
    return {
      meta: [
        { title },
        { name: "description", content: spec.subtitle },
        { property: "og:title", content: title },
        { property: "og:description", content: spec.subtitle },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: SolutionRoute,
  notFoundComponent: SolutionNotFound,
  errorComponent: SolutionErrorComponent,
});

function SolutionRoute() {
  const { slug } = Route.useLoaderData();
  const spec = SOLUTIONS[slug]!;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: spec.faq.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  }).replaceAll("<", "\\u003c");
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: structuredData }}
      />
      <SolutionPage spec={spec} />
    </>
  );
}

function SolutionNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-32 text-center">
      <h1 className="font-display text-3xl font-medium">Solution not found</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Browse all reconciliation solutions on the{" "}
        <a href="/solutions" className="underline">
          solutions overview
        </a>
        .
      </p>
    </div>
  );
}

function SolutionErrorComponent({ error }: ErrorComponentProps) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-32 text-center">
      <h1 className="font-display text-3xl font-medium">Failed to load solution</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "An unexpected error occurred."}
      </p>
      <div className="mt-6">
        <Link
          to="/solutions"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          View all solutions
        </Link>
      </div>
    </div>
  );
}
