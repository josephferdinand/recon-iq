import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, FileText, Presentation, FileType } from "lucide-react";

import v3md from "@/assets/advisory/v3.md.asset.json";
import v3pdf from "@/assets/advisory/v3.pdf.asset.json";
import v3pptx from "@/assets/advisory/v3.pptx.asset.json";
import v4md from "@/assets/advisory/v4.md.asset.json";
import v4pdf from "@/assets/advisory/v4.pdf.asset.json";
import v4pptx from "@/assets/advisory/v4.pptx.asset.json";

export const Route = createFileRoute("/_authenticated/security-appendix/advisory")({
  head: () => ({
    meta: [
      { title: "ReconIQ Enterprise Scaling Advisory — v3 & v4 downloads" },
      { name: "description", content: "Download the ReconIQ Enterprise Scaling Advisory in PPTX, PDF, or Markdown. Choose v3 (Cloudflare Free / Supabase Free baseline) or v4 (Cloudflare Paid / Supabase Teams)." },
    ],
  }),
  component: AdvisoryDownloadsPage,
});

type Version = "v3" | "v4";
type Fmt = "pptx" | "pdf" | "md";

const VERSIONS: Record<Version, {
  label: string;
  tagline: string;
  chip: string;
  scope: string[];
  files: Record<Fmt, { url: string; size?: number; filename?: string }>;
}> = {
  v3: {
    label: "Version 3.0",
    tagline: "Baseline advisory — Cloudflare Free tier + Supabase Free/Pro assumptions",
    chip: "Legacy baseline",
    scope: [
      "Cost model, GTM, and roadmap sized for Cloudflare Free + Supabase Pro.",
      "18-vendor competitor grid with ReconIQ vs. incumbents.",
      "Executive summary, boardroom appendix, 8-agent assessment.",
    ],
    files: {
      pptx: { url: v3pptx.url, size: v3pptx.size, filename: v3pptx.original_filename },
      pdf: { url: v3pdf.url, size: v3pdf.size, filename: v3pdf.original_filename },
      md: { url: v3md.url, size: v3md.size, filename: v3md.original_filename },
    },
  },
  v4: {
    label: "Version 4.0",
    tagline: "Current advisory — Cloudflare Paid tier + Supabase Teams plan",
    chip: "Current",
    scope: [
      "Recomputed cost model reflecting paid-tier WAF, Log Push, PITR, and read replicas.",
      "Enterprise buyer FAQ + in-app appendix wiring.",
      "Priority build plans (API docs, APM/SIEM, pentest, ERP connectors, CS ops).",
    ],
    files: {
      pptx: { url: v4pptx.url, size: v4pptx.size, filename: v4pptx.original_filename },
      pdf: { url: v4pdf.url, size: v4pdf.size, filename: v4pdf.original_filename },
      md: { url: v4md.url, size: v4md.size, filename: v4md.original_filename },
    },
  },
};

const FMTS: { key: Fmt; label: string; icon: any; mime: string }[] = [
  { key: "pptx", label: "PowerPoint (30 slides)", icon: Presentation, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { key: "pdf", label: "PDF report", icon: FileType, mime: "application/pdf" },
  { key: "md", label: "Markdown source", icon: FileText, mime: "text/markdown" },
];

function fmtBytes(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function AdvisoryDownloadsPage() {
  const [version, setVersion] = useState<Version>("v4");
  const info = VERSIONS[version];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Advisory downloads</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">ReconIQ Enterprise Scaling Advisory</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted-foreground">
          Pick a version, then download the deck, PDF, or markdown source. Both versions remain available — v4 is the current
          recommendation; v3 is preserved for reference.
        </p>
      </header>

      <Tabs value={version} onValueChange={(v) => setVersion(v as Version)}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="v3">v3.0 — baseline</TabsTrigger>
          <TabsTrigger value="v4">v4.0 — current</TabsTrigger>
        </TabsList>

        {(Object.keys(VERSIONS) as Version[]).map((v) => {
          const cfg = VERSIONS[v];
          return (
            <TabsContent key={v} value={v} className="mt-6 space-y-6">
              <Card className={v === version ? "border-primary/40" : ""}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-2xl">{cfg.label}</CardTitle>
                    <Badge variant={v === "v4" ? "default" : "secondary"}>{cfg.chip}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{cfg.tagline}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
                    {cfg.scope.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {FMTS.map((f) => {
                      const file = cfg.files[f.key];
                      const Icon = f.icon;
                      return (
                        <a key={f.key} href={file.url} download={(file.filename ?? `ReconIQ_Advisory_${v}.${f.key}`).replace(/^(?:FVI|FV)_Advisory_/, "reconiq-advisory-")}
                          className="group rounded-lg border border-border p-4 transition-colors hover:border-primary/60 hover:bg-muted/40">
                          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Icon className="h-4 w-4 text-primary" aria-hidden />
                            {f.label}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{fmtBytes(file.size)}</span>
                            <span className="inline-flex items-center gap-1 text-primary group-hover:underline">
                              <Download className="h-3 w-3" aria-hidden />
                              Download
                            </span>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </main>
  );
}
