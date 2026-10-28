/**
 * Phase 1 Quick Win — Unified "Browse Templates" entry point at the tenant layer.
 *
 * Facets across every template surface installed on the tenant:
 *   - tenant_templates            (Marketplace-installed templates)
 *   - tenant_email_templates      (Transactional email templates)
 *   - tenant_report_definitions   (Reporting templates)
 *   - aidp_templates              (AIDP document templates)
 *   - copilot_personas            (Copilot personas / agent templates)
 *
 * Each facet card shows a live count and links to its owning surface.
 * This is the single, intuitive entry point users open when they want
 * to discover "what templates do we have here?" — replacing the previous
 * discovery scatter across 5+ nav locations.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import {
  Package, Mail, FileBarChart, FileText, Sparkles, Store, ArrowRight,
} from "lucide-react";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { getTemplateFacets } from "@/lib/template-facets.functions";

export const Route = createFileRoute("/_authenticated/$slug/tenant/browse-templates")({
  head: () => ({
    meta: [
      { title: "Browse Templates — Tenant | ReconIQ" },
      {
        name: "description",
        content:
          "The single entry point for every template installed on this tenant — recon, regulatory, email, reports, AIDP, and personas.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BrowseTemplatesPage,
});

type Facet = {
  key: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  to: string;
  chip?: string;
};

function BrowseTemplatesPage() {
  const { slug } = Route.useParams();
  const tenantFn = useServerFn(getTenantBySlug);
  const facetsFn = useServerFn(getTemplateFacets);

  const tenantQ = useQuery({
    queryKey: ["tenant", slug],
    queryFn: () => tenantFn({ data: { slug } }),
  });

  const facetsQ = useQuery({
    enabled: !!tenantQ.data?.id,
    queryKey: ["template-facets", tenantQ.data?.id],
    queryFn: () => facetsFn({ data: { tenant_id: tenantQ.data!.id } }),
  });

  const c = facetsQ.data;

  const facets: Facet[] = [
    {
      key: "installed",
      title: "Marketplace-installed",
      description: "Templates installed on this tenant from the platform Marketplace.",
      icon: Package,
      count: c?.tenant_templates ?? 0,
      to: `/${slug}/tenant/templates`,
      chip: "Template Gallery",
    },
    {
      key: "email",
      title: "Email templates",
      description: "Transactional and marketing email templates in use by the tenant.",
      icon: Mail,
      count: c?.email_templates ?? 0,
      to: `/${slug}/tenant`,
    },
    {
      key: "reports",
      title: "Report definitions",
      description: "Reusable reporting/analytics definitions tenant users can run.",
      icon: FileBarChart,
      count: c?.report_definitions ?? 0,
      to: `/${slug}/tenant`,
    },
    {
      key: "aidp",
      title: "AIDP templates",
      description: "Document AI templates for extraction, classification, and prediction.",
      icon: FileText,
      count: c?.aidp_templates ?? 0,
      to: `/${slug}/tenant`,
    },
    {
      key: "personas",
      title: "Copilot personas",
      description: "Persona / agent templates powering Copilot behaviour across the tenant.",
      icon: Sparkles,
      count: c?.copilot_personas ?? 0,
      to: `/${slug}/tenant`,
    },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">
          Tenant Administration
        </p>
        <h1 className="text-3xl font-semibold">Browse Templates</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          Every template surface installed on this tenant, in one place. This is the
          canonical discovery entry point — one clear source of truth for what your
          teams can consume today.
        </p>
        <div className="mt-4">
          <Link to="/$slug/tenant/templates" params={{ slug }}>
            <Button size="sm" variant="default" className="gap-2">
              <Store className="h-4 w-4" /> Open Template Gallery
            </Button>
          </Link>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {facets.map((f) => {
          const Icon = f.icon;
          return (
            <Card key={f.key} className="hover:border-primary/60 transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">{f.title}</CardTitle>
                  </div>
                  <Badge variant={f.count > 0 ? "default" : "outline"}>
                    {facetsQ.isLoading ? "…" : f.count}
                  </Badge>
                </div>
                <CardDescription className="mt-1">{f.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link to={f.to as "/$slug/tenant/templates"} params={{ slug }}>
                  <Button variant="ghost" size="sm" className="gap-1 px-2">
                    {f.chip ?? "Open"} <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
