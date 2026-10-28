import { createFileRoute, redirect } from "@tanstack/react-router";
import { assertMktRolesFn } from "@/lib/mkt-admin.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listSiteLogosAdmin,
  upsertSiteLogo,
  deleteSiteLogo,
  type SiteLogo,
} from "@/lib/mkt-site-logos.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Trash2, Pencil, Plus, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/mkt-admin/site-logos")({
  beforeLoad: async () => {
    try {
      await assertMktRolesFn({ data: { allowed: MKT_TAB_ROLES.site_logos } });
    } catch {
      throw redirect({ to: "/mkt-admin" });
    }
  },
  component: SiteLogosPage,
});


type FormState = {
  id?: string;
  name: string;
  category: SiteLogo["category"];
  logo_url: string;
  website_url: string;
  display_order: number;
  published: boolean;
};

const EMPTY: FormState = {
  name: "",
  category: "customer",
  logo_url: "",
  website_url: "",
  display_order: 100,
  published: true,
};

function SiteLogosPage() {
  const listFn = useServerFn(listSiteLogosAdmin);
  const upsertFn = useServerFn(upsertSiteLogo);
  const deleteFn = useServerFn(deleteSiteLogo);
  const qc = useQueryClient();

  const logosQ = useQuery({
    queryKey: ["mkt", "site-logos"],
    queryFn: () => listFn({ data: undefined }),
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<boolean>(false);

  const save = useMutation({
    mutationFn: async () => {
      return upsertFn({
        data: {
          id: form.id,
          name: form.name.trim(),
          category: form.category,
          logo_url: form.logo_url.trim() || null,
          website_url: form.website_url.trim() || null,
          display_order: form.display_order,
          published: form.published,
        },
      });
    },
    onSuccess: () => {
      setForm(EMPTY);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["mkt", "site-logos"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "site-logos"] }),
  });

  const startEdit = (l: SiteLogo) => {
    setForm({
      id: l.id,
      name: l.name,
      category: l.category as FormState["category"],
      logo_url: l.logo_url ?? "",
      website_url: l.website_url ?? "",
      display_order: l.display_order,
      published: l.published,
    });
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancel = () => {
    setForm(EMPTY);
    setEditing(false);
  };

  const logos = logosQ.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Trusted-by logos</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Manage the customer, partner, and self-brand logos that appear in the
          landing page "Trusted by" strip. Only entries marked <b>published</b>{" "}
          are visible on the public site. Lower <b>display order</b> shows first.
        </p>
      </div>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          {editing ? <Pencil className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4 text-primary" />}
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
            {editing ? "Edit logo" : "Add new logo"}
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Display name *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Meridian Bank"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setForm({ ...form, category: v as FormState["category"] })}
            >
              <SelectTrigger id="category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="partner">Partner</SelectItem>
                <SelectItem value="regulator">Regulator</SelectItem>
                <SelectItem value="auditor">Auditor</SelectItem>
                <SelectItem value="self">Self / brand</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="logo_url">Logo URL (SVG or PNG, transparent preferred)</Label>
            <Input
              id="logo_url"
              value={form.logo_url}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              placeholder="https://cdn.example.com/logos/meridian.svg"
            />
            <p className="text-xs text-muted-foreground">
              If left blank the strip will render the display name as a stylised wordmark.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website_url">Website URL (optional)</Label>
            <Input
              id="website_url"
              value={form.website_url}
              onChange={(e) => setForm({ ...form, website_url: e.target.value })}
              placeholder="https://meridianbank.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="display_order">Display order</Label>
            <Input
              id="display_order"
              type="number"
              min={0}
              max={9999}
              value={form.display_order}
              onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) || 0 })}
            />
          </div>

          <div className="flex items-center gap-3 pt-2 md:col-span-2">
            <Switch
              id="published"
              checked={form.published}
              onCheckedChange={(v) => setForm({ ...form, published: v })}
            />
            <Label htmlFor="published" className="cursor-pointer">
              Published (visible on the public landing page)
            </Label>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <Button
            onClick={() => save.mutate()}
            disabled={!form.name.trim() || save.isPending}
          >
            {save.isPending ? "Saving…" : editing ? "Save changes" : "Add logo"}
          </Button>
          {editing && (
            <Button variant="outline" onClick={cancel}>Cancel</Button>
          )}
        </div>

        {save.isError && (
          <p className="mt-3 text-sm text-destructive">
            {(save.error as Error)?.message ?? "Save failed"}
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
            All logos ({logos.length})
          </h2>
        </div>

        {logosQ.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : logos.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No logos yet — add your first entry above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Website</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {logos.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      {l.logo_url ? (
                        <img
                          src={l.logo_url}
                          alt={l.name}
                          className="h-6 w-16 object-contain opacity-80"
                        />
                      ) : (
                        <span className="inline-flex h-6 w-16 items-center justify-center rounded bg-muted text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                          wordmark
                        </span>
                      )}
                      <span className="font-medium">{l.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{l.category}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.display_order}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                        (l.published
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground")
                      }
                    >
                      {l.published ? "Published" : "Hidden"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {l.website_url ? (
                      <a
                        href={l.website_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> Visit
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button aria-label={`Edit ${l.name}`} variant="ghost" size="sm" onClick={() => startEdit(l)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        aria-label={`Delete ${l.name}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete "${l.name}"?`)) remove.mutate(l.id);
                        }}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
