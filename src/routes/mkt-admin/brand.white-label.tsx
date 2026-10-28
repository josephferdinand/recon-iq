import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

export const Route = createFileRoute("/mkt-admin/brand/white-label")({
  component: WhiteLabelPage,
});

function WhiteLabelPage() {
  return (
    <Card className="p-6 space-y-4">
      <h2 className="font-semibold">White-label management</h2>
      <p className="text-sm text-muted-foreground">
        Per-tenant branding — logo, primary/accent colors, support links, custom domains — is managed on each tenant's page.
        Enable a white-label logo slot under Brand assets to make it available to tenants.
      </p>
      <ul className="list-disc pl-5 text-sm space-y-1">
        <li>Tenant-specific logo &amp; colors: Tenants → &lt;tenant&gt; → Branding</li>
        <li>Tenant-specific domain: Tenants → &lt;tenant&gt; → Custom domains</li>
        <li>Tenant theme overrides: Website themes → Tenant scope</li>
      </ul>
      <div className="flex gap-2">
        <Button asChild variant="outline"><Link to="/mkt-admin/themes"><ExternalLink className="mr-1.5 h-4 w-4" />Website themes</Link></Button>
      </div>
    </Card>
  );
}
