import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { useMemo, useState } from "react";
import { z } from "zod";
import {
  DEFAULT_SDK_VERSION,
  QUICKSTART_SNIPPETS,
  SDK_PACKAGES,
  SDK_VERSIONS,
  type SdkFile,
  type SdkVersion,
} from "@/lib/sdk-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Check, Copy, Download, FileCode2, PackageOpen, Terminal } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({
  v: fallback(z.enum(SDK_VERSIONS), DEFAULT_SDK_VERSION).default(DEFAULT_SDK_VERSION),
});

export const Route = createFileRoute("/_authenticated/docs/sdk")({
  head: () => ({
    meta: [
      { title: "TypeScript SDK — ReconIQ Developer Portal" },
      { name: "description", content: "Versioned TypeScript SDKs for the ReconIQ reconciliation platform with quickstart examples, install snippets, and downloadable source." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: SdkPage,
});

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: (id: string, text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(id);
        toast.success("Copied to clipboard");
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400);
      });
    },
  };
}

function downloadFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CodeBlock({ code, language = "ts", id, filename }: { code: string; language?: string; id: string; filename?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="group relative rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{filename ?? language}</span>
        <div className="flex gap-1">
          {filename ? (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => downloadFile(filename, code)} aria-label="Download">
              <Download className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(id, code)} aria-label="Copy">
            {copied === id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      <ScrollArea className="max-h-[420px]">
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed"><code>{code}</code></pre>
      </ScrollArea>
    </div>
  );
}

function SdkPage() {
  const { v } = Route.useSearch();
  const navigate = Route.useNavigate();
  const version = v as SdkVersion;
  const pkg = SDK_PACKAGES[version];
  const [activeFile, setActiveFile] = useState<string>("src/index.ts");
  const [installer, setInstaller] = useState<string>("npm");
  const snippets = useMemo(() => QUICKSTART_SNIPPETS.filter((s) => s.versions.includes(version)), [version]);
  const currentFile: SdkFile | undefined = pkg.files.find((f) => f.path === activeFile) ?? pkg.files[0];
  const installCmd = pkg.installCommands.find((c) => c.label === installer)?.cmd ?? pkg.installCommands[0].cmd;
  const { copied, copy } = useCopy();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <PackageOpen className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">TypeScript SDK</h1>
          <Badge variant={pkg.status === "latest" ? "default" : "secondary"}>{pkg.status === "latest" ? "Latest" : "Archived"}</Badge>
          <Badge variant="outline" className="font-mono">{pkg.npmName}@{pkg.npmVersion}</Badge>
        </div>
        <p className="max-w-3xl text-muted-foreground">
          Auto-generated from <span className="font-mono text-foreground">docs/openapi/</span> on every release. One method per operation, zero runtime dependencies, works in Node 18+, Bun, Deno, and modern browsers. {pkg.tagCount} tag namespaces · {pkg.operationCount} operations.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-muted-foreground">SDK version</label>
          <Select value={version} onValueChange={(next) => navigate({ search: { v: next as SdkVersion } })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SDK_VERSIONS.map((sv) => (
                <SelectItem key={sv} value={sv}>{sv} · {sv === "v4.0" ? "Current" : "Archived"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">Released {pkg.releaseDate}</span>
        </div>
        {pkg.status === "archived" ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="font-medium">Archived release.</span> {pkg.supportPolicy}
            <Button size="sm" variant="link" className="ml-2 h-auto p-0" onClick={() => navigate({ search: { v: "v4.0" } })}>Switch to v4.0 →</Button>
          </div>
        ) : null}
      </header>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Terminal className="h-4 w-4" /> Install</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1" role="group" aria-label="Package manager">
            {pkg.installCommands.map((command) => (
              <Button
                key={command.label}
                type="button"
                size="sm"
                variant={installer === command.label ? "secondary" : "ghost"}
                aria-pressed={installer === command.label}
                onClick={() => setInstaller(command.label)}
              >
                {command.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
            <span className="text-muted-foreground">$</span>
            <span className="flex-1 truncate">{installCmd}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Copy install command" onClick={() => copy("install", installCmd)}>
              {copied === "install" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Private registry — request access from <span className="font-mono">developer-relations@reconiq.example</span>. Bearer tokens are issued by Meta Cloud auth and scoped by RLS.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quickstart</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={snippets[0]?.id}>
            <TabsList className="flex-wrap">
              {snippets.map((s) => <TabsTrigger key={s.id} value={s.id}>{s.title}</TabsTrigger>)}
            </TabsList>
            {snippets.map((s) => (
              <TabsContent key={s.id} value={s.id} className="space-y-2">
                <p className="text-sm text-muted-foreground">{s.description}</p>
                <CodeBlock id={`snippet-${s.id}`} code={s.code} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><FileCode2 className="h-4 w-4" /> Package contents</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <ScrollArea className="max-h-[420px] rounded-md border">
            <div className="p-2 text-sm">
              {pkg.files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setActiveFile(f.path)}
                  className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted ${activeFile === f.path ? "bg-muted font-semibold" : ""}`}
                >{f.path}</button>
              ))}
            </div>
          </ScrollArea>
          {currentFile ? (
            <CodeBlock id={`file-${currentFile.path}`} code={currentFile.content} language={currentFile.language} filename={currentFile.path} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">README</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-xs leading-relaxed">{pkg.readme}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
