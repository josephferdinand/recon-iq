import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Github,
  GitBranch,
  GitCommit,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Copy,
  AlertTriangle,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import {
  verifyDocsSync,
  listDocsSyncEvents,
  getDocsSyncConfig,
} from "@/lib/github-sync.functions";
import { RepositoryHealthCard } from "@/components/repository-health-card";
import { GithubSyncConfigPanel } from "@/components/github-sync-config-panel";

type DocsEvent = {
  id: string;
  created_at: string;
  actor_email: string | null;
  repo: string;
  branch: string;
  path: string;
  commit_sha: string | null;
  commit_short_sha: string | null;
  commit_message: string | null;
  commit_author: string | null;
  commit_committed_at: string | null;
  file_count: number;
  files: Array<{ name: string; path: string; sha: string; size: number }>;
  status: "verified" | "error";
  error_message: string | null;
};

function copy(v: string) {
  navigator.clipboard.writeText(v);
  toast.success("Copied");
}

export function GithubSyncTab() {
  const qc = useQueryClient();
  const verifyFn = useServerFn(verifyDocsSync);
  const listFn = useServerFn(listDocsSyncEvents);
  const cfgFn = useServerFn(getDocsSyncConfig);

  const cfgQ = useQuery({
    queryKey: ["docs-sync-config"],
    queryFn: () => cfgFn({ data: {} }),
  });
  const eventsQ = useQuery({
    queryKey: ["docs-sync-events"],
    queryFn: () => listFn({ data: { limit: 50 } }),
  });

  const verify = useMutation({
    mutationFn: () => verifyFn({ data: {} }) as unknown as Promise<{ ok: true; event: DocsEvent }>,
    onSuccess: () => {
      toast.success("Verified docs against GitHub");
      qc.invalidateQueries({ queryKey: ["docs-sync-events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cfg = cfgQ.data;
  const events = (eventsQ.data?.events ?? []) as DocsEvent[];
  const currentDocsPath = cfg?.path ?? "docs";
  const latest = useMemo(
    () => events.find((e) => e.status === "verified" && e.path === currentDocsPath) ?? null,
    [events, currentDocsPath],
  );
  const repoUrl = cfg?.repo ? `https://github.com/${cfg.repo}` : "";
  const branchUrl = cfg?.repo
    ? `https://github.com/${cfg.repo}/tree/${cfg.branch}/${cfg.path}`
    : "";
  const commitUrl =
    cfg?.repo && latest?.commit_sha
      ? `https://github.com/${cfg.repo}/commit/${latest.commit_sha}`
      : "";

  return (
    <div className="space-y-4">
      <GithubSyncConfigPanel
        currentRepo={cfg?.repo ?? ""}
        currentBranch={cfg?.branch ?? ""}
        currentPath={cfg?.path ?? ""}
        source={(cfg as any)?.source}
      />
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Github className="h-4 w-4" /> docs GitHub sync status
              </CardTitle>
              <CardDescription>
                One-click verification that the full <code className="rounded bg-muted px-1 py-0.5 text-xs">docs</code>{" "}
                folder is pushed to GitHub, including architecture, research,
                legal, schema, OpenAPI, and manifest files. Every verification is recorded in
                the audit log below with the actor, timestamp, commit hash, and
                file list returned by the GitHub API.
              </CardDescription>
            </div>
            <Badge
              variant={
                cfg?.tokenSet && cfg?.repo
                  ? latest
                    ? "default"
                    : "outline"
                  : "destructive"
              }
              className="gap-1"
            >
              {cfg?.tokenSet && cfg?.repo ? (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  {latest ? "Verified" : "Not verified yet"}
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3" />
                  Configure secrets
                </>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Repository" icon={Github}>
              {cfg?.repo ? (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  {cfg.repo} <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Set GITHUB_DOCS_REPO
                </span>
              )}
            </Field>
            <Field label="Branch / path" icon={GitBranch}>
              {cfg?.repo ? (
                <a
                  href={branchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  {cfg.branch} · {cfg.path}{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </Field>
            <Field label="Last verified commit" icon={GitCommit}>
              {latest?.commit_sha ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {latest.commit_short_sha}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => copy(latest.commit_sha!)}
                      aria-label="Copy commit SHA"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    {commitUrl ? (
                      <a
                        href={commitUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        view <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {latest.commit_message ?? "—"}
                  </p>
                  {latest.commit_author ? (
                    <p className="text-[10px] text-muted-foreground">
                      by {latest.commit_author}
                      {latest.commit_committed_at
                        ? ` · ${new Date(latest.commit_committed_at).toLocaleString()}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Run a verification to populate
                </span>
              )}
            </Field>
            <Field label="Files in docs" icon={FileText}>
              <span className="text-sm">
                {latest ? `${latest.file_count} file${latest.file_count === 1 ? "" : "s"}` : "—"}
              </span>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              size="sm"
              onClick={() => verify.mutate()}
              disabled={verify.isPending || !cfg?.repo}
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${verify.isPending ? "animate-spin" : ""}`}
              />
              {verify.isPending ? "Verifying…" : "Verify & log sync now"}
            </Button>
            {cfg?.repo ? (
              <a href={branchUrl} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline">
                  <Github className="mr-1.5 h-3.5 w-3.5" /> Open docs on GitHub
                </Button>
              </a>
            ) : null}
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Hash-chained mirror written to platform audit log.
            </span>
          </div>

          {!cfg?.tokenSet ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
              Private repos require <code>GITHUB_DOCS_TOKEN</code> (fine-grained
              PAT, Contents: Read). Until it's set, verification will fail with
              401/404 and the failure is still audited.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <RepositoryHealthCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Sync audit log
          </CardTitle>
          <CardDescription>
            Append-only record of every <code>{currentDocsPath}</code> verification.
            Visible to platform admins only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Commit</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventsQ.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : events.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No verifications recorded yet. Click <strong>Verify &amp; log sync now</strong> above to write the first audit entry.
                    </TableCell>
                  </TableRow>
                ) : (
                  events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(e.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">{e.actor_email ?? "—"}</TableCell>
                      <TableCell>
                        {e.status === "verified" ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> verified
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> error
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.commit_short_sha ? (
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                            {e.commit_short_sha}
                          </code>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {e.file_count}
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        {e.status === "error" ? (
                          <span className="text-xs text-destructive">
                            {e.error_message}
                          </span>
                        ) : (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help truncate text-xs text-muted-foreground">
                                  {e.commit_message ?? "—"}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md">
                                <div className="space-y-1">
                                  <p className="font-medium text-xs">
                                    {e.commit_message ?? "(no message)"}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {e.repo}@{e.branch} · {e.path}
                                  </p>
                                  {e.files?.length ? (
                                    <ul className="mt-1 max-h-48 overflow-auto text-[10px]">
                                      {e.files.map((f) => (
                                        <li key={f.sha} className="font-mono">
                                          {f.path}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      {children}
    </div>
  );
}
