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
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommit,
  Github,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { getRepoHealth } from "@/lib/github-sync.functions";

type Health = Awaited<ReturnType<typeof getRepoHealth>>;

function copy(v: string) {
  navigator.clipboard.writeText(v);
  toast.success("Copied");
}

function runBadge(r: Health["workflow_runs"][number]) {
  if (r.status !== "completed") {
    return (
      <Badge variant="outline" className="gap-1">
        <RefreshCw className="h-3 w-3 animate-spin" /> {r.status}
      </Badge>
    );
  }
  if (r.conclusion === "success") {
    return (
      <Badge variant="default" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> success
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="h-3 w-3" /> {r.conclusion ?? "failed"}
    </Badge>
  );
}

export function RepositoryHealthCard() {
  const qc = useQueryClient();
  const fn = useServerFn(getRepoHealth);
  const q = useQuery({
    queryKey: ["repo-health"],
    queryFn: () => fn({ data: {} }) as Promise<Health>,
    staleTime: 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => fn({ data: {} }) as Promise<Health>,
    onSuccess: () => {
      toast.success("Repository health refreshed");
      qc.invalidateQueries({ queryKey: ["repo-health"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const h = q.data;
  const repoUrl = h ? `https://github.com/${h.repo}` : "";
  const protEnabled = (h?.protection as any)?.enabled === true;
  const sev = (h?.dependabot as any)?.bySeverity ?? {};
  const openAlerts = (h?.dependabot as any)?.open ?? 0;
  const critical = (sev.critical ?? 0) + (sev.high ?? 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" /> Repository health
            </CardTitle>
            <CardDescription>
              Read-only snapshot of <code>{h?.repo ?? "the repository"}</code>:
              HEAD commit, branch protection, latest CI runs, and open
              Dependabot alerts. Source code itself is governed by the platform ↔
              GitHub bidirectional sync — this card surfaces assurance signals,
              not a file count.
            </CardDescription>
          </div>
          <Badge
            variant={critical > 0 ? "destructive" : openAlerts > 0 ? "outline" : "default"}
            className="gap-1"
          >
            {critical > 0 ? (
              <>
                <ShieldAlert className="h-3 w-3" /> {critical} high/critical
              </>
            ) : openAlerts > 0 ? (
              <>
                <Shield className="h-3 w-3" /> {openAlerts} alerts
              </>
            ) : (
              <>
                <ShieldCheck className="h-3 w-3" /> Healthy
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Repository" icon={Github}>
            {h ? (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {h.repo} <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <Skeleton />
            )}
            {h ? (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {h.visibility} · default {h.default_branch}
              </p>
            ) : null}
          </Field>

          <Field label="HEAD commit" icon={GitCommit}>
            {h ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {h.head.short_sha}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => copy(h.head.sha)}
                    aria-label="Copy commit SHA"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <a
                    href={h.head.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    view <ExternalLink className="h-3 w-3" />
                  </a>
                  {h.head.verified ? (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <ShieldCheck className="h-3 w-3" /> signed
                    </Badge>
                  ) : null}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {h.head.message ?? "—"}
                </p>
                {h.head.author ? (
                  <p className="text-[10px] text-muted-foreground">
                    by {h.head.author}
                    {h.head.committed_at
                      ? ` · ${new Date(h.head.committed_at).toLocaleString()}`
                      : ""}
                  </p>
                ) : null}
              </div>
            ) : (
              <Skeleton />
            )}
          </Field>

          <Field label={`Branch protection (${h?.branch ?? "—"})`} icon={GitBranch}>
            {h ? (
              protEnabled ? (
                <ul className="space-y-0.5 text-xs">
                  <li>
                    <CheckBullet ok={(h.protection as any).requiredReviews > 0}>
                      Required reviews: {(h.protection as any).requiredReviews}
                    </CheckBullet>
                  </li>
                  <li>
                    <CheckBullet ok={(h.protection as any).requireCodeOwners}>
                      Code owner review
                    </CheckBullet>
                  </li>
                  <li>
                    <CheckBullet ok={(h.protection as any).requiredStatusChecks > 0}>
                      Required checks: {(h.protection as any).requiredStatusChecks}
                    </CheckBullet>
                  </li>
                  <li>
                    <CheckBullet ok={(h.protection as any).requireSignedCommits}>
                      Signed commits
                    </CheckBullet>
                  </li>
                  <li>
                    <CheckBullet ok={!(h.protection as any).allowForcePushes}>
                      Force-push disabled
                    </CheckBullet>
                  </li>
                  <li>
                    <CheckBullet ok={(h.protection as any).enforceAdmins}>
                      Enforced on admins
                    </CheckBullet>
                  </li>
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No protection rules detected
                  {(h.protection as any).reason
                    ? ` (${(h.protection as any).reason})`
                    : ""}
                  . Configure branch protection in GitHub for SOC 2 evidence.
                </p>
              )
            ) : (
              <Skeleton />
            )}
          </Field>

          <Field label="Dependabot alerts" icon={Shield}>
            {h ? (
              (h.dependabot as any).available ? (
                openAlerts === 0 ? (
                  <p className="text-sm">
                    <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
                    No open alerts
                  </p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{openAlerts} open</p>
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {(["critical", "high", "medium", "low"] as const).map((s) =>
                        sev[s] ? (
                          <Badge
                            key={s}
                            variant={
                              s === "critical" || s === "high" ? "destructive" : "outline"
                            }
                          >
                            {s}: {sev[s]}
                          </Badge>
                        ) : null,
                      )}
                    </div>
                  </div>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  Dependabot data unavailable
                  {(h.dependabot as any).reason
                    ? ` (${(h.dependabot as any).reason})`
                    : ""}
                  . Grant the token <code>security_events: read</code>.
                </p>
              )
            ) : (
              <Skeleton />
            )}
          </Field>
        </div>

        <div className="rounded-md border">
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Latest CI runs on {h?.branch ?? "—"}
          </div>
          <div className="divide-y">
            {!h ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">Loading…</div>
            ) : h.workflow_runs.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                No workflow runs found.
              </div>
            ) : (
              h.workflow_runs.map((r: Health["workflow_runs"][number]) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="text-muted-foreground">#{r.run_number}</span>
                    <span className="text-muted-foreground">· {r.event}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {runBadge(r)}
                    <span className="text-muted-foreground">
                      {new Date(r.updated_at).toLocaleString()}
                    </span>
                    <a
                      href={r.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      view <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || q.isLoading}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`}
            />
            {refresh.isPending ? "Refreshing…" : "Refresh snapshot"}
          </Button>
          {h ? (
            <a href={repoUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <Github className="mr-1.5 h-3.5 w-3.5" /> Open repository
              </Button>
            </a>
          ) : null}
          {h?.pushed_at ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Last push to repo: {new Date(h.pushed_at).toLocaleString()}
            </span>
          ) : null}
        </div>

        {q.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {(q.error as Error).message}
          </p>
        ) : null}
      </CardContent>
    </Card>
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

function CheckBullet({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {ok ? (
        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
      ) : (
        <AlertTriangle className="h-3 w-3 text-amber-600" />
      )}
      <span className={ok ? "" : "text-muted-foreground"}>{children}</span>
    </span>
  );
}

function Skeleton() {
  return <div className="h-4 w-full animate-pulse rounded bg-muted" />;
}
