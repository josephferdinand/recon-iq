import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SOLUTION_SLUGS } from "@/lib/solutions-data";
// LL-016 follow-up: dynamic-import support-toc to keep this sitemap route off
// the cyclic edge between router chunks (see support.$category.$article.tsx).

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const hostname = new URL(request.url).hostname;
        const baseUrl = hostname === "app.reconiq.example"
          ? "https://app.reconiq.example"
          : hostname === "dev.app.reconiq.example"
            ? "https://dev.app.reconiq.example"
            : "https://reconiq.example";
        const { getSupportCategories } = await import("@/content/support-toc");
        const supportCategories = getSupportCategories();
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/solutions", changefreq: "weekly", priority: "0.9" },
          ...SOLUTION_SLUGS.map((slug) => ({
            path: `/solutions/${slug}`,
            changefreq: "monthly" as const,
            priority: "0.8",
          })),
          { path: "/pricing", changefreq: "monthly", priority: "0.8" },
          { path: "/security", changefreq: "monthly", priority: "0.8" },
          { path: "/roi", changefreq: "monthly", priority: "0.7" },
          { path: "/about", changefreq: "monthly", priority: "0.6" },
          { path: "/contact", changefreq: "monthly", priority: "0.6" },
          { path: "/book-demo", changefreq: "monthly", priority: "0.6" },
          { path: "/privacy", changefreq: "yearly", priority: "0.5" },
          { path: "/legal", changefreq: "yearly", priority: "0.5" },
          { path: "/due-diligence", changefreq: "monthly", priority: "0.5" },
          { path: "/support", changefreq: "weekly", priority: "0.9" },
          ...supportCategories.map((c) => ({
            path: `/support/${c.slug}`,
            changefreq: "weekly" as const,
            priority: "0.7",
          })),
          ...supportCategories.flatMap((c) =>
            c.articles.map((a) => ({
              path: `/support/${c.slug}/${a.slug}`,
              changefreq: "monthly" as const,
              priority: "0.6",
            })),
          ),
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${baseUrl}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ].filter(Boolean).join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
