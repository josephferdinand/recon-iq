import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { safeFetch } from "@/lib/ssrf-guard.server";

type Ctx = {
  supabase: any;
  userId: string;
  claims: Record<string, unknown> | null;
};

async function assertPlatformAdmin(context: Ctx) {
  const { data, error } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: platform admin required");
}

function normalizeDocsPath(rawPath: string) {
  const trimmed = rawPath.trim().replace(/^\/+|\/+$/g, "");
  // Older deployments stored docs/research because the first sync feature only
  // tracked competitive research. The audit requirement is now the full docs
  // export, so keep legacy secrets working while always verifying /docs.
  if (!trimmed || trimmed === "docs/research") return "docs";
  return trimmed;
}

async function resolveRepoConfig(supabase: any) {
  // Prefer DB-managed settings (configurable in Platform → GitHub Sync), fall
  // back to environment variables for bootstrap / disaster recovery.
  let owner: string | null = null;
  let repoName: string | null = null;
  let branch = "main";
  let path = "docs";
  try {
    const { data } = await supabase
      .from("github_sync_settings")
      .select("owner, repo_name, branch, docs_path")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .maybeSingle();
    if (data) {
      owner = data.owner ?? null;
      repoName = data.repo_name ?? null;
      branch = data.branch ?? branch;
      path = data.docs_path ?? path;
    }
  } catch {
    // ignore — fall through to env
  }

  const envRepo = process.env.GITHUB_DOCS_REPO ?? "";
  const repo =
    owner && repoName ? `${owner}/${repoName}` : envRepo;
  if (!branch) branch = process.env.GITHUB_DOCS_BRANCH ?? "main";
  path = normalizeDocsPath(path || process.env.GITHUB_DOCS_PATH || "docs");
  const token = process.env.GITHUB_DOCS_TOKEN ?? "";
  if (!repo.includes("/")) {
    throw new Error(
      "GitHub sync repository is not configured. Set it in Platform → GitHub Sync → Repository configuration, or set GITHUB_DOCS_REPO.",
    );
  }
  return { repo, branch, path, token };
}

function ghHeaders(token: string) {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "FVI-docs-sync-verifier",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Verify that the configured docs path is pushed to GitHub. Reads the most
 * recent commit on the branch that touches docs, plus the current recursive
 * file list under that path, and records the verification in
 * `docs_sync_events` (append-only). Platform admins only.
 */
export const verifyDocsSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as Ctx);
    const { repo, branch, path, token } = await resolveRepoConfig(context.supabase);

    const eventBase = {
      actor_user_id: context.userId,
      actor_email: (context.claims as any)?.email ?? null,
      repo,
      branch,
      path,
    };

    try {
      // Latest commit on branch touching this path.
      const commitsUrl = `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=1`;
      const commitsRes = await safeFetch(commitsUrl, { headers: ghHeaders(token) });
      if (!commitsRes.ok) {
        const body = await commitsRes.text().catch(() => "");
        throw new Error(`GitHub commits API ${commitsRes.status}: ${body.slice(0, 200)}`);
      }
      const commits = (await commitsRes.json()) as Array<{
        sha: string;
        commit: { message: string; author?: { name?: string; date?: string }; committer?: { date?: string } };
        author?: { login?: string };
      }>;
      const latest = commits[0];

      // Recursive file listing under the path via the git tree API so that
      // nested folders (architecture/, research/, legal/, ...) are counted.
      let files: Array<{ name: string; path: string; sha: string; size: number }> = [];
      const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
      const treeRes = await safeFetch(treeUrl, { headers: ghHeaders(token) });
      if (treeRes.ok) {
        const body = (await treeRes.json()) as {
          tree?: Array<{ path: string; type: string; sha: string; size?: number }>;
          truncated?: boolean;
        };
        const prefix = path.endsWith("/") ? path : `${path}/`;
        files = (body.tree ?? [])
          .filter((i) => i.type === "blob" && (i.path === path || i.path.startsWith(prefix)))
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((i) => ({
            name: i.path.split("/").pop() ?? i.path,
            path: i.path,
            sha: i.sha,
            size: i.size ?? 0,
          }));
      } else if (treeRes.status !== 404) {
        const errBody = await treeRes.text().catch(() => "");
        throw new Error(`GitHub tree API ${treeRes.status}: ${errBody.slice(0, 200)}`);
      }

      const sha = latest?.sha ?? null;
      const event = {
        ...eventBase,
        commit_sha: sha,
        commit_short_sha: sha ? sha.slice(0, 7) : null,
        commit_message: latest?.commit?.message?.split("\n")[0] ?? null,
        commit_author: latest?.commit?.author?.name ?? latest?.author?.login ?? null,
        commit_committed_at:
          latest?.commit?.committer?.date ?? latest?.commit?.author?.date ?? null,
        file_count: files.length,
        files: files as any,
        status: "verified" as const,
        error_message: null,
        http_status: 200,
      };

      const { data: row, error } = await context.supabase
        .from("docs_sync_events")
        .insert(event)
        .select()
        .single();
      if (error) throw new Error(error.message);

      // Mirror into hash-chained audit_log for tamper-evident trail.
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId,
        actor_email: (context.claims as any)?.email ?? null,
        scope: "platform",
        action: "docs_sync.verified",
        resource_type: "github_repo",
        resource_id: `${repo}@${branch}:${path}`,
        context: {
          commit_sha: sha,
          file_count: files.length,
          docs_sync_event_id: row?.id,
        } as any,
      } as any);

      return { ok: true, event: row };
    } catch (err: any) {
      const msg = err?.message ?? "unknown error";
      const { data: row } = await context.supabase
        .from("docs_sync_events")
        .insert({
          ...eventBase,
          status: "error" as const,
          error_message: msg.slice(0, 1000),
        })
        .select()
        .single();
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId,
        actor_email: (context.claims as any)?.email ?? null,
        scope: "platform",
        action: "docs_sync.error",
        resource_type: "github_repo",
        resource_id: `${repo}@${branch}:${path}`,
        context: { error: msg.slice(0, 500), docs_sync_event_id: row?.id } as any,
      } as any);
      throw new Error(msg);
    }
  });

const ListInput = z.object({ limit: z.number().int().min(1).max(200).default(50) });

export const listDocsSyncEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as Ctx);
    const { data: rows, error } = await context.supabase
      .from("docs_sync_events")
      .select(
        "id, created_at, actor_email, repo, branch, path, commit_sha, commit_short_sha, commit_message, commit_author, commit_committed_at, file_count, files, status, error_message",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { events: rows ?? [] };
  });

export const getDocsSyncConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as Ctx);
    const resolved = await resolveRepoConfig(context.supabase);
    const tokenSet = Boolean(process.env.GITHUB_DOCS_TOKEN);
    const envFallback = !((await context.supabase
      .from("github_sync_settings")
      .select("owner, repo_name")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .maybeSingle()).data?.owner);
    return {
      repo: resolved.repo,
      branch: resolved.branch,
      path: resolved.path,
      rawPath: resolved.path,
      tokenSet,
      source: envFallback ? ("env" as const) : ("database" as const),
    };
  });

/**
 * Repository-wide health snapshot for the platform admin "Repository Health"
 * card. Returns HEAD SHA, branch protection summary, latest workflow runs and
 * open Dependabot alerts. Does NOT enumerate files (least disclosure).
 */
export const getRepoHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as Ctx);
    const { repo, branch, token } = await resolveRepoConfig(context.supabase);
    const headers = ghHeaders(token);

    const get = async (url: string) => {
      const r = await safeFetch(url, { headers });
      return { ok: r.ok, status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
    };

    // HEAD commit on default branch
    const headRes = await get(
      `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`,
    );
    if (!headRes.ok) {
      throw new Error(`GitHub commits API ${headRes.status} for ${repo}@${branch}`);
    }
    const head = headRes.body as any;

    // Repo metadata (visibility, default branch, pushed_at)
    const metaRes = await get(`https://api.github.com/repos/${repo}`);
    const meta = (metaRes.body ?? {}) as any;

    // Branch protection (requires admin token; degrade gracefully)
    const protRes = await get(
      `https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}/protection`,
    );
    const prot = (protRes.body ?? null) as any;
    const protection = protRes.ok
      ? {
          enabled: true,
          requiredReviews:
            prot?.required_pull_request_reviews?.required_approving_review_count ?? 0,
          requireCodeOwners:
            Boolean(prot?.required_pull_request_reviews?.require_code_owner_reviews),
          requiredStatusChecks: Array.isArray(prot?.required_status_checks?.contexts)
            ? prot.required_status_checks.contexts.length
            : 0,
          enforceAdmins: Boolean(prot?.enforce_admins?.enabled),
          requireSignedCommits: Boolean(prot?.required_signatures?.enabled),
          allowForcePushes: Boolean(prot?.allow_force_pushes?.enabled),
          allowDeletions: Boolean(prot?.allow_deletions?.enabled),
        }
      : { enabled: false, reason: protRes.status === 404 ? "no_protection" : `http_${protRes.status}` };

    // Latest 5 workflow runs on the branch
    const runsRes = await get(
      `https://api.github.com/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`,
    );
    const runs = ((runsRes.body as any)?.workflow_runs ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      html_url: r.html_url,
      run_number: r.run_number,
      event: r.event,
      head_sha: r.head_sha,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    // Open Dependabot alerts (best-effort; requires security_events scope)
    const depRes = await get(
      `https://api.github.com/repos/${repo}/dependabot/alerts?state=open&per_page=100`,
    );
    const dependabot = depRes.ok
      ? {
          available: true,
          open: Array.isArray(depRes.body) ? (depRes.body as any[]).length : 0,
          bySeverity: Array.isArray(depRes.body)
            ? (depRes.body as any[]).reduce(
                (acc: Record<string, number>, a: any) => {
                  const s = a?.security_advisory?.severity ?? "unknown";
                  acc[s] = (acc[s] ?? 0) + 1;
                  return acc;
                },
                {},
              )
            : {},
        }
      : { available: false, reason: `http_${depRes.status}` };

    const snapshot = {
      repo,
      branch,
      visibility: meta.visibility ?? (meta.private ? "private" : "public"),
      default_branch: meta.default_branch ?? branch,
      pushed_at: meta.pushed_at ?? null,
      head: {
        sha: head.sha,
        short_sha: String(head.sha).slice(0, 7),
        message: head.commit?.message?.split("\n")[0] ?? null,
        author:
          head.commit?.author?.name ?? head.author?.login ?? head.commit?.committer?.name ?? null,
        committed_at: head.commit?.committer?.date ?? head.commit?.author?.date ?? null,
        html_url: head.html_url ?? `https://github.com/${repo}/commit/${head.sha}`,
        verified: Boolean(head.commit?.verification?.verified),
      },
      protection,
      workflow_runs: runs,
      dependabot,
      generated_at: new Date().toISOString(),
    };

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      actor_email: (context.claims as any)?.email ?? null,
      scope: "platform",
      action: "repo_health.viewed",
      resource_type: "github_repo",
      resource_id: `${repo}@${branch}`,
      context: {
        head_sha: head.sha,
        protection_enabled: (protection as any).enabled === true,
        open_dependabot: (dependabot as any).open ?? null,
      } as any,
    } as any);

    return snapshot;
  });


// ───────────────────────────────────────────────────────────────────────────
// 4-eyes change workflow for the repository owner/name/branch/docs path.
// All actions are mirrored into the hash-chained audit_log for evidence.
// ───────────────────────────────────────────────────────────────────────────

const OwnerRegex = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;
const RepoRegex = /^[A-Za-z0-9._-]{1,100}$/;
const BranchRegex = /^[A-Za-z0-9._/-]{1,200}$/;

const ProposeInput = z.object({
  owner: z.string().regex(OwnerRegex, "Invalid GitHub owner"),
  repo_name: z.string().regex(RepoRegex, "Invalid repo name"),
  branch: z.string().regex(BranchRegex, "Invalid branch"),
  docs_path: z.string().min(1).max(200),
  reason: z.string().min(10, "Justification (≥10 chars) is required").max(2000),
});

const IdInput = z.object({ request_id: z.string().uuid() });
const RejectInput = z.object({
  request_id: z.string().uuid(),
  reason: z.string().min(5).max(2000),
});

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function auditEvent(
  context: Ctx,
  action: string,
  resourceId: string,
  ctxObj: Record<string, unknown>,
) {
  await context.supabase.from("audit_log").insert({
    actor_user_id: context.userId,
    actor_email: (context.claims as any)?.email ?? null,
    scope: "platform",
    action,
    resource_type: "github_sync_change_request",
    resource_id: resourceId,
    context: ctxObj as any,
  } as any);
}

export const listGithubSyncChangeRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as Ctx);
    const { data, error } = await context.supabase
      .from("github_sync_change_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { requests: data ?? [] };
  });

export const proposeGithubSyncChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ProposeInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as Ctx);
    const email = (context.claims as any)?.email ?? null;

    // Snapshot current settings for evidence
    const { data: cur } = await context.supabase
      .from("github_sync_settings")
      .select("owner, repo_name, branch, docs_path")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .maybeSingle();

    const docsPath = normalizeDocsPath(data.docs_path);

    const { data: inserted, error } = await context.supabase
      .from("github_sync_change_requests")
      .insert({
        proposed_owner: data.owner,
        proposed_repo_name: data.repo_name,
        proposed_branch: data.branch,
        proposed_docs_path: docsPath,
        previous_owner: cur?.owner ?? null,
        previous_repo_name: cur?.repo_name ?? null,
        previous_branch: cur?.branch ?? null,
        previous_docs_path: cur?.docs_path ?? null,
        reason: data.reason,
        requested_by: context.userId,
        requested_by_email: email,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const evidence = await sha256Hex(
      JSON.stringify({
        id: inserted.id,
        proposed: {
          owner: data.owner,
          repo_name: data.repo_name,
          branch: data.branch,
          docs_path: docsPath,
        },
        previous: {
          owner: cur?.owner ?? null,
          repo_name: cur?.repo_name ?? null,
          branch: cur?.branch ?? null,
          docs_path: cur?.docs_path ?? null,
        },
        requested_by: context.userId,
        requested_at: inserted.created_at,
      }),
    );
    await context.supabase
      .from("github_sync_change_requests")
      .update({ evidence_sha256: evidence })
      .eq("id", inserted.id);

    await auditEvent(context as Ctx, "github_sync.change_requested", inserted.id, {
      proposed: { owner: data.owner, repo_name: data.repo_name, branch: data.branch, docs_path: docsPath },
      evidence_sha256: evidence,
    });

    return { ok: true, id: inserted.id, evidence_sha256: evidence };
  });

export const approveGithubSyncChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as Ctx);
    const email = (context.claims as any)?.email ?? null;

    const { data: cr, error } = await context.supabase
      .from("github_sync_change_requests")
      .select("*")
      .eq("id", data.request_id)
      .single();
    if (error) throw new Error(error.message);
    if (cr.status !== "pending") {
      throw new Error(`Cannot approve — current status is ${cr.status}`);
    }
    if (cr.requested_by === context.userId) {
      throw new Error("You cannot approve your own change request (4-eyes).");
    }
    if (cr.approver_1 === context.userId || cr.approver_2 === context.userId) {
      throw new Error("You have already approved this request.");
    }

    let patch: any = {};
    let nextStatus: string = cr.status;
    if (!cr.approver_1) {
      patch = { approver_1: context.userId, approver_1_email: email, approver_1_at: new Date().toISOString() };
    } else if (!cr.approver_2) {
      patch = {
        approver_2: context.userId,
        approver_2_email: email,
        approver_2_at: new Date().toISOString(),
        status: "approved",
      };
      nextStatus = "approved";
    } else {
      throw new Error("Already has two approvers.");
    }

    const { error: upErr } = await context.supabase
      .from("github_sync_change_requests")
      .update(patch)
      .eq("id", data.request_id);
    if (upErr) throw new Error(upErr.message);

    await auditEvent(context as Ctx, "github_sync.change_approved", data.request_id, {
      approver_slot: cr.approver_1 ? 2 : 1,
      new_status: nextStatus,
    });

    return { ok: true, status: nextStatus };
  });

export const rejectGithubSyncChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => RejectInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as Ctx);
    const email = (context.claims as any)?.email ?? null;

    const { data: cr, error } = await context.supabase
      .from("github_sync_change_requests")
      .select("status, requested_by")
      .eq("id", data.request_id)
      .single();
    if (error) throw new Error(error.message);
    if (!["pending", "approved"].includes(cr.status)) {
      throw new Error(`Cannot reject — current status is ${cr.status}`);
    }

    const { error: upErr } = await context.supabase
      .from("github_sync_change_requests")
      .update({
        status: "rejected",
        rejected_by: context.userId,
        rejected_by_email: email,
        rejected_at: new Date().toISOString(),
        rejection_reason: data.reason,
      })
      .eq("id", data.request_id);
    if (upErr) throw new Error(upErr.message);

    await auditEvent(context as Ctx, "github_sync.change_rejected", data.request_id, {
      reason: data.reason,
    });
    return { ok: true };
  });

export const cancelGithubSyncChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as Ctx);
    const { data: cr, error } = await context.supabase
      .from("github_sync_change_requests")
      .select("status, requested_by")
      .eq("id", data.request_id)
      .single();
    if (error) throw new Error(error.message);
    if (cr.requested_by !== context.userId) {
      throw new Error("Only the requester may cancel this request.");
    }
    if (cr.status !== "pending") {
      throw new Error(`Cannot cancel — status is ${cr.status}`);
    }
    const { error: upErr } = await context.supabase
      .from("github_sync_change_requests")
      .update({ status: "cancelled" })
      .eq("id", data.request_id);
    if (upErr) throw new Error(upErr.message);
    await auditEvent(context as Ctx, "github_sync.change_cancelled", data.request_id, {});
    return { ok: true };
  });

/**
 * Apply an approved change request. Validates the proposed repository with
 * GitHub (HEAD on the proposed branch) and retries with exponential backoff
 * when GitHub returns a transient 5xx / 403 rate-limit. The settings row is
 * only updated after a successful probe.
 */
export const applyGithubSyncChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as Ctx);
    const email = (context.claims as any)?.email ?? null;

    const { data: cr, error } = await context.supabase
      .from("github_sync_change_requests")
      .select("*")
      .eq("id", data.request_id)
      .single();
    if (error) throw new Error(error.message);
    if (cr.status !== "approved") {
      throw new Error(`Cannot apply — status is ${cr.status}. Need two approvals first.`);
    }
    if (cr.requested_by === context.userId && (cr.approver_1 === context.userId || cr.approver_2 === context.userId)) {
      throw new Error("Applier cannot also be requester+approver (segregation of duties).");
    }

    const token = process.env.GITHUB_DOCS_TOKEN ?? "";
    const headers = ghHeaders(token);
    const repo = `${cr.proposed_owner}/${cr.proposed_repo_name}`;
    const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(cr.proposed_branch)}`;

    // Retry loop: 3 attempts, 500ms → 1500ms → 4500ms backoff for transient errors.
    const MAX_ATTEMPTS = 3;
    let lastErr: string | null = null;
    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await safeFetch(url, { headers });
        if (res.ok) { ok = true; break; }
        const body = await res.text().catch(() => "");
        lastErr = `GitHub ${res.status}: ${body.slice(0, 240)}`;
        // Permanent failures — don't retry
        if (res.status === 401 || res.status === 404 || res.status === 422) break;
      } catch (e: any) {
        lastErr = e?.message ?? "network error";
      }
      await context.supabase
        .from("github_sync_change_requests")
        .update({
          apply_attempts: attempt,
          last_attempt_at: new Date().toISOString(),
          last_error: lastErr,
        })
        .eq("id", data.request_id);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(3, attempt - 1)));
      }
    }

    if (!ok) {
      await context.supabase
        .from("github_sync_change_requests")
        .update({
          status: "failed",
          apply_attempts: MAX_ATTEMPTS,
          last_attempt_at: new Date().toISOString(),
          last_error: lastErr,
        })
        .eq("id", data.request_id);
      await auditEvent(context as Ctx, "github_sync.apply_failed", data.request_id, {
        error: lastErr,
        repo,
        branch: cr.proposed_branch,
      });
      throw new Error(`Apply failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
    }

    // Probe succeeded — persist new settings
    const docsPath = normalizeDocsPath(cr.proposed_docs_path);
    const { error: setErr } = await context.supabase
      .from("github_sync_settings")
      .update({
        owner: cr.proposed_owner,
        repo_name: cr.proposed_repo_name,
        branch: cr.proposed_branch,
        docs_path: docsPath,
        updated_by: context.userId,
        applied_request_id: cr.id,
      })
      .eq("id", "00000000-0000-0000-0000-000000000001");
    if (setErr) {
      await context.supabase
        .from("github_sync_change_requests")
        .update({ status: "failed", last_error: setErr.message })
        .eq("id", data.request_id);
      throw new Error(`Settings write failed: ${setErr.message}`);
    }

    await context.supabase
      .from("github_sync_change_requests")
      .update({
        status: "applied",
        applied_at: new Date().toISOString(),
        applied_by: context.userId,
        last_error: null,
      })
      .eq("id", data.request_id);

    await auditEvent(context as Ctx, "github_sync.change_applied", data.request_id, {
      repo,
      branch: cr.proposed_branch,
      docs_path: docsPath,
      applied_by_email: email,
      evidence_sha256: cr.evidence_sha256,
    });

    // ── Automatic post-apply audit-chain verification ──────────────────────
    let postApplyOk: boolean | null = null;
    type PostApplySummary = {
      evidence_ok?: boolean;
      chain_ok?: boolean;
      all_evidence_links_ok?: boolean;
      first_bad_audit_id?: number | null;
      audit_entry_count?: number;
      recomputed_evidence_sha256?: string;
      error?: string;
    };
    let postApplySummary: PostApplySummary = {};
    try {
      const v = await runChainVerification(context.supabase, data.request_id);
      postApplyOk = v.ok;
      postApplySummary = {
        evidence_ok: v.request.evidence_ok,
        chain_ok: v.audit_chain.ok,
        all_evidence_links_ok: v.audit_chain.all_evidence_links_ok,
        first_bad_audit_id: v.audit_chain.first_bad_id,
        audit_entry_count: v.audit_chain.entries.length,
        recomputed_evidence_sha256: v.request.recomputed_evidence_sha256,
      };
    } catch (e: any) {
      postApplyOk = false;
      postApplySummary = { error: String(e?.message ?? "verification failed") };
    }

    await context.supabase
      .from("github_sync_change_requests")
      .update({
        post_apply_verified: postApplyOk,
        post_apply_verified_at: new Date().toISOString(),
        post_apply_verification: postApplySummary,
      })
      .eq("id", data.request_id);

    await auditEvent(
      context as Ctx,
      postApplyOk ? "github_sync.post_apply_verified" : "github_sync.post_apply_verification_failed",
      data.request_id,
      { summary: postApplySummary, evidence_sha256: cr.evidence_sha256 },
    );

    return {
      ok: true as const,
      repo,
      branch: cr.proposed_branch,
      docs_path: docsPath,
      post_apply_verified: postApplyOk,
      post_apply_verification: postApplySummary,
    };
  });



// ───────────────────────────────────────────────────────────────────────────
// Shared chain-verification routine. Used by both the on-demand
// `verifyGithubSyncChain` server fn and the automatic post-apply step inside
// `applyGithubSyncChange`. Caller supplies a Supabase client already scoped
// to the executing user/role.
// ───────────────────────────────────────────────────────────────────────────
async function runChainVerification(
  supabase: any,
  requestId: string,
): Promise<{
  ok: boolean;
  request: {
    id: string;
    status: string;
    stored_evidence_sha256: string | null;
    recomputed_evidence_sha256: string;
    evidence_ok: boolean;
    proposed: { owner: string; repo_name: string; branch: string; docs_path: string };
    previous: { owner: string | null; repo_name: string | null; branch: string | null; docs_path: string | null };
    requested_at: string;
    requested_by_email: string | null;
  };
  audit_chain: {
    ok: boolean;
    first_bad_id: number | null;
    fork_count: number;
    orphan_count: number;
    head_matches_latest: boolean;
    entries: Array<{
      id: number;
      occurred_at: string;
      action: string;
      actor_email: string | null;
      actor_user_id: string | null;
      row_hash: string | null;
      prev_hash: string | null;
      context_evidence_sha256: string | null;
      evidence_link_ok: boolean;
    }>;
    all_evidence_links_ok: boolean;
  };
}> {
  const { data: cr, error: crErr } = await supabase
    .from("github_sync_change_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (crErr) throw new Error(crErr.message);
  if (!cr) throw new Error("Change request not found");

  const recomputedEvidence = await sha256Hex(
    JSON.stringify({
      id: cr.id,
      proposed: {
        owner: cr.proposed_owner,
        repo_name: cr.proposed_repo_name,
        branch: cr.proposed_branch,
        docs_path: cr.proposed_docs_path,
      },
      previous: {
        owner: cr.previous_owner ?? null,
        repo_name: cr.previous_repo_name ?? null,
        branch: cr.previous_branch ?? null,
        docs_path: cr.previous_docs_path ?? null,
      },
      requested_by: cr.requested_by,
      requested_at: cr.created_at,
    }),
  );
  const evidenceOk =
    typeof cr.evidence_sha256 === "string" &&
    cr.evidence_sha256.toLowerCase() === recomputedEvidence.toLowerCase();

  const { data: rawEntries, error: aErr } = await supabase
    .from("audit_log")
    .select(
      "id, occurred_at, actor_user_id, actor_email, scope, action, resource_type, resource_id, context, prev_hash, row_hash",
    )
    .eq("resource_type", "github_sync_change_request")
    .eq("resource_id", requestId)
    .order("id", { ascending: true });
  if (aErr) throw new Error(aErr.message);

  const toHex = (val: unknown): string | null => {
    if (val == null) return null;
    if (typeof val === "string") {
      return val.startsWith("\\x") ? val.slice(2).toLowerCase() : val.toLowerCase();
    }
    return null;
  };

  const entries = (rawEntries ?? []).map((e: any) => {
    const ctxEvidence =
      typeof e.context === "object" && e.context && "evidence_sha256" in e.context
        ? String((e.context as any).evidence_sha256)
        : null;
    const evidenceLinkOk =
      ctxEvidence == null
        ? true
        : ctxEvidence.toLowerCase() === recomputedEvidence.toLowerCase();
    return {
      id: e.id as number,
      occurred_at: e.occurred_at as string,
      action: e.action as string,
      actor_email: (e.actor_email as string | null) ?? null,
      actor_user_id: (e.actor_user_id as string | null) ?? null,
      row_hash: toHex(e.row_hash),
      prev_hash: toHex(e.prev_hash),
      context_evidence_sha256: ctxEvidence,
      evidence_link_ok: evidenceLinkOk,
    };
  });

  const { data: vc, error: vcErr } = await supabase.rpc(
    "audit_chain_integrity_status",
    { _limit: 100000 },
  );
  if (vcErr) throw new Error(vcErr.message);
  const chainRow = Array.isArray(vc) ? vc[0] : vc;
  const chainOk: boolean = !!chainRow?.ok;
  const firstBadId: number | null = chainRow?.first_bad_id ?? null;
  const forkCount = Number(chainRow?.fork_count ?? 0);
  const orphanCount = Number(chainRow?.orphan_count ?? 0);
  const headMatchesLatest = !!chainRow?.head_matches_latest;

  const allEvidenceLinksOk = entries.every((e: { evidence_link_ok: boolean }) => e.evidence_link_ok);
  const overallOk = evidenceOk && chainOk && orphanCount === 0 && headMatchesLatest && allEvidenceLinksOk;

  return {
    ok: overallOk,
    request: {
      id: cr.id,
      status: cr.status,
      stored_evidence_sha256: cr.evidence_sha256 ?? null,
      recomputed_evidence_sha256: recomputedEvidence,
      evidence_ok: evidenceOk,
      proposed: {
        owner: cr.proposed_owner,
        repo_name: cr.proposed_repo_name,
        branch: cr.proposed_branch,
        docs_path: cr.proposed_docs_path,
      },
      previous: {
        owner: cr.previous_owner,
        repo_name: cr.previous_repo_name,
        branch: cr.previous_branch,
        docs_path: cr.previous_docs_path,
      },
      requested_at: cr.created_at,
      requested_by_email: cr.requested_by_email ?? null,
    },
    audit_chain: {
      ok: chainOk,
      first_bad_id: firstBadId,
      fork_count: forkCount,
      orphan_count: orphanCount,
      head_matches_latest: headMatchesLatest,
      entries,
      all_evidence_links_ok: allEvidenceLinksOk,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// End-to-end evidence chain verifier for a single GitHub-sync change request.
// ───────────────────────────────────────────────────────────────────────────
export const verifyGithubSyncChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ request_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as Ctx);
    return runChainVerification(context.supabase, data.request_id);
  });

export { runChainVerification };

