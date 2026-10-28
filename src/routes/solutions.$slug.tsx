import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SolutionPage } from "@/components/solution-page";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
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
    const url = `https://reconintelligence.app/solutions/${params.slug}`;
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
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />
      <main className="mx-auto max-w-2xl px-6 py-32 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">Solutions</p>
        <h1 className="mt-4 font-display text-3xl font-medium tracking-tight">Nothing To Display Yet</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#a1a1a6]">
          We couldn&apos;t find that solution page — it may have moved. Browse the overview to
          find the workflow closest to yours.
        </p>
        <div className="mt-8">
          <Link
            to="/solutions"
            className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
          >
            View all solutions
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}

function SolutionErrorComponent() {
  return (
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />
      <main className="mx-auto max-w-2xl px-6 py-32 text-center">
        <h1 className="font-display text-3xl font-medium tracking-tight">Something Didn&apos;t Go As Planned</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#a1a1a6]">
          We couldn&apos;t load this page just now. Please try again in a few moments, or browse the
          solutions overview in the meantime.
        </p>
        <div className="mt-8">
          <Link
            to="/solutions"
            className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
          >
            View all solutions
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
