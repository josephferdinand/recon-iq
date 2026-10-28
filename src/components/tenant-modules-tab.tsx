import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Layers } from "lucide-react";
import { WorkspaceVisibilityTab } from "@/components/workspace-visibility-tab";
import { FeatureFlagsTab } from "@/components/feature-flags-tab";
import { TenantConfigAuditTab } from "@/components/tenant-config-audit-tab";

/**
 * Tenant-side unified Modules & Features landing.
 * Mirrors the platform admin experience: workspace page visibility,
 * feature-flag toggles, and the hash-chained audit trail of both.
 */
export function TenantModulesTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Modules & Features
          </CardTitle>
          <CardDescription>
            Enable or hide workspace pages and toggle feature flags for this tenant.
            Every change is written to a tamper-evident audit trail.
            {!canWrite && " Read-only for your role."}
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="pages">
        <TabsList>
          <TabsTrigger value="pages">Workspace pages</TabsTrigger>
          <TabsTrigger value="flags">Feature flags</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>
        <TabsContent value="pages" className="mt-4">
          <WorkspaceVisibilityTab tenantId={tenantId} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="flags" className="mt-4">
          <FeatureFlagsTab tenantId={tenantId} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <TenantConfigAuditTab tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
