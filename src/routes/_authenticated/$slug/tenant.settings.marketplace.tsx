/**
 * Phase 5 — Tenant marketplace catalog UI.
 *
 * Lets a tenant admin browse the registered Copilot tool plugins,
 * install one with a zod-validated config form, toggle enable/disable,
 * and uninstall. All writes are scoped by RLS to tenant_admin members
 * of the current tenant.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import { Plug, ShieldCheck, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { getTenantBySlug } from "@/lib/tenants.functions";
import {
  listMarketplacePlugins,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  type CopilotMarketplaceItem,
} from "@/lib/copilot-marketplace.functions";

export const Route = createFileRoute("/_authenticated/$slug/tenant/settings/marketplace")({
  loader: async ({ params }) => {
    const tenant = await getTenantBySlug({ data: { slug: params.slug } });
    if (!tenant?.id) throw new Error("Tenant not found");
    const items = await listMarketplacePlugins({ data: { tenant_id: tenant.id } });
    return { tenant, items };
  },
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-10 text-sm">
        <p className="mb-3 text-destructive">{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
        <Button onClick={() => { router.invalidate(); reset(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-10">Not found</div>,
  head: () => ({
    meta: [
      { title: "Copilot Marketplace — Tenant Settings" },
      { name: "description", content: "Install and configure Copilot plugins for your tenant." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TenantMarketplacePage,
});

function TenantMarketplacePage() {
  const { tenant, items: initial } = Route.useLoaderData();
  const qc = useQueryClient();
  const list = useServerFn(listMarketplacePlugins);
  const install = useServerFn(installPlugin);
  const uninstall = useServerFn(uninstallPlugin);
  const enable = useServerFn(enablePlugin);
  const disable = useServerFn(disablePlugin);

  const { data } = useQuery<CopilotMarketplaceItem[]>({
    queryKey: ["copilot-marketplace", tenant.id],
    queryFn: () => list({ data: { tenant_id: tenant.id } }),
    initialData: initial,
  });

  const [installing, setInstalling] = useState<CopilotMarketplaceItem | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["copilot-marketplace", tenant.id] });
  };

  const installMutation = useMutation({
    mutationFn: async (vars: { plugin_id: string; config: Record<string, unknown> }) =>
      install({ data: { tenant_id: tenant.id, ...vars } }),
    onSuccess: async () => {
      await refresh();
      toast.success("Plugin installed");
      setInstalling(null);
      setConfigDraft({});
      setFormErrors({});
    },
    onError: (err: Error) => toast.error(err.message ?? "Install failed"),
  });

  const toggleMutation = useMutation({
    mutationFn: async (vars: { plugin_id: string; next: boolean }) =>
      vars.next
        ? enable({ data: { tenant_id: tenant.id, plugin_id: vars.plugin_id } })
        : disable({ data: { tenant_id: tenant.id, plugin_id: vars.plugin_id } }),
    onSuccess: async (_r, vars) => {
      await refresh();
      toast.success(vars.next ? "Plugin enabled" : "Plugin disabled");
    },
    onError: (err: Error) => toast.error(err.message ?? "Toggle failed"),
  });

  const uninstallMutation = useMutation({
    mutationFn: async (plugin_id: string) =>
      uninstall({ data: { tenant_id: tenant.id, plugin_id } }),
    onSuccess: async () => {
      await refresh();
      toast.success("Plugin uninstalled");
    },
    onError: (err: Error) => toast.error(err.message ?? "Uninstall failed"),
  });

  // Build a permissive client-side shape for the config form. Final
  // validation runs server-side against the plugin's zod schema.
  const configFields = useMemo(() => installing?.requires ?? [], [installing]);

  const onSubmitInstall = () => {
    const config: Record<string, unknown> = {};
    const errs: Record<string, string> = {};
    for (const key of configFields) {
      const val = (configDraft[key] ?? "").trim();
      if (!val) errs[key] = "Required";
      config[key] = val;
    }
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Fill all required fields");
      return;
    }
    installMutation.mutate({ plugin_id: installing!.plugin_id, config });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Tenant Admin · {tenant.name}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Copilot marketplace</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Install plugins to expand what the Copilot can do for your tenant. Each install is
          audited; mutating tools always return for 4-eyes approval before they execute.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {data.map((p) => (
          <Card key={p.plugin_id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Plug className="h-4 w-4" /> {p.label}
                  </CardTitle>
                  <CardDescription className="mt-1">{p.description}</CardDescription>
                </div>
                {p.installed ? (
                  p.enabled ? (
                    <Badge className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Enabled
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <AlertTriangle className="h-3 w-3" /> Disabled
                    </Badge>
                  )
                ) : (
                  <Badge variant="secondary">Not installed</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {p.requires.map((r) => (
                  <Badge key={r} variant="outline" className="font-mono text-[10px]">
                    {r}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {!p.installed && (
                  <Button
                    size="sm"
                    onClick={() => { setInstalling(p); setConfigDraft({}); setFormErrors({}); }}
                  >
                    Install
                  </Button>
                )}
                {p.installed && p.enabled && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleMutation.mutate({ plugin_id: p.plugin_id, next: false })}
                      disabled={toggleMutation.isPending}
                    >
                      Disable
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setInstalling(p); setConfigDraft({}); setFormErrors({}); }}
                    >
                      Configure
                    </Button>
                  </>
                )}
                {p.installed && !p.enabled && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => toggleMutation.mutate({ plugin_id: p.plugin_id, next: true })}
                      disabled={toggleMutation.isPending}
                    >
                      Enable
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Uninstall ${p.label}?`)) {
                          uninstallMutation.mutate(p.plugin_id);
                        }
                      }}
                      disabled={uninstallMutation.isPending}
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Uninstall
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={!!installing}
        onOpenChange={(o) => {
          if (!o) { setInstalling(null); setConfigDraft({}); setFormErrors({}); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{installing?.label}</DialogTitle>
            <DialogDescription>
              Provide the connection details for this plugin. Secrets are stored encrypted
              and never echoed back to the chat surface.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {configFields.map((key) => (
              <div key={key}>
                <Label htmlFor={`cfg-${key}`} className="font-mono text-xs">{key}</Label>
                <Input
                  id={`cfg-${key}`}
                  value={configDraft[key] ?? ""}
                  onChange={(e) =>
                    setConfigDraft((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  placeholder={key.endsWith("_url") ? "https://..." : ""}
                />
                {formErrors[key] && (
                  <p className="mt-1 text-xs text-destructive">{formErrors[key]}</p>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setInstalling(null); setConfigDraft({}); setFormErrors({}); }}
            >
              Cancel
            </Button>
            <Button onClick={onSubmitInstall} disabled={installMutation.isPending}>
              {installMutation.isPending ? "Installing…" : "Install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// keep zod import referenced for future schema-driven form generation
void z;
