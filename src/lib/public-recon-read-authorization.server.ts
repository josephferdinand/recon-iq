import { z } from "zod";
import { authorizeTenantApiRequest, workflowApiCors, workflowApiJson } from "@/lib/public-workflow-api.server";

const uuid = z.string().uuid();
const resultStatuses = ["all", "match", "partial", "missing", "duplicate", "invalid_key", "other", "unavailable"] as const;
const run = z.object({
  id: uuid, run_uid: z.string().nullable(), definition_id: uuid, status: z.string(),
  matched_count: z.number().int().nonnegative().safe().nullable(), exception_count: z.number().int().nonnegative().safe().nullable(), total_rows: z.number().int().nonnegative().safe().nullable(),
  started_at: z.string(), completed_at: z.string().nullable(), matched_input_memberships: z.number().int().nonnegative().safe().nullable(),
});
const receipt = z.string().regex(/^[1-9][0-9]{0,18}$/u).refine(value => /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9223372036854775807n);
const historyResponse = z.object({ rows: z.array(run).max(50), total: z.number().int().nonnegative().safe(), page: z.number().int().positive(), page_size: z.literal(50), has_next: z.boolean(), audit_id: receipt });
const resultsResponse = z.object({ run, results: z.array(z.unknown()).max(50), field_names: z.array(z.unknown()).nullable(), parent_count: z.number().int().nonnegative().safe().nullable(), page: z.number().int().positive(), page_size: z.literal(50), has_next: z.boolean(), status_counts: z.object({ match_groups: z.number().int().nonnegative().safe().nullable(), exception_items: z.number().int().nonnegative().safe().nullable(), exception_buckets: z.record(z.string(), z.number().int().nonnegative().safe()).nullable() }).nullable(), audit_id: receipt });

export function publicReconReadCors(request: Request) { return workflowApiCors(request, "GET"); }

export async function authorizePublicReconRead(request: Request, tenantSlug: string, reconId: string) {
  let auth;
  try { auth = await authorizeTenantApiRequest({ request, tenantSlug, requiredScope: "recons.read", methods: "GET" }); }
  catch { return { ok: false as const, response: workflowApiJson(503, { error: "authentication_unavailable" }, publicReconReadCors(request)) }; }
  if (!auth.ok) return auth;
  if (!uuid.safeParse(reconId).success) return { ok: false as const, response: workflowApiJson(400, { error: "invalid_recon_id" }, auth.cors) };
  // Legacy wildcard does not confer this new purpose contract.
  if (!auth.principal.scopes.includes("recons.read")) return { ok: false as const, response: workflowApiJson(403, { error: "missing_scope", required: "recons.read" }, auth.cors) };
  return auth;
}

function queryInput(request: Request, mode: "history" | "results") {
  const params = new URL(request.url).searchParams;
  const allowed = mode === "history" ? ["page", "days"] : ["page", "status"];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new Error("invalid_query");
  const integer = (key: string, fallback: number) => {
    const text = params.get(key);
    if (text !== null && !/^[1-9][0-9]{0,4}$/u.test(text)) throw new Error("invalid_query");
    return text === null ? fallback : Number(text);
  };
  const page = integer("page", 1);
  if (page > 10000) throw new Error("invalid_query");
  const days = mode === "history" ? integer("days", 30) : 30;
  if (![1, 7, 14, 30, 90].includes(days)) throw new Error("invalid_query");
  const status = mode === "results" ? params.get("status") ?? "all" : "all";
  if (!resultStatuses.includes(status as typeof resultStatuses[number])) throw new Error("invalid_query");
  return { page, days, status };
}

async function read(request: Request, tenantSlug: string, reconId: string, mode: "history" | "results", runId: string | null) {
  const auth = await authorizePublicReconRead(request, tenantSlug, reconId);
  if (!auth.ok) return auth.response;
  if (runId !== null && !uuid.safeParse(runId).success) return workflowApiJson(400, { error: "invalid_run_id" }, auth.cors);
  let query;
  try { query = queryInput(request, mode); } catch { return workflowApiJson(400, { error: "invalid_query" }, auth.cors); }
  const suppliedRequestId = request.headers.get("x-fvi-request-id");
  const requestId = uuid.safeParse(suppliedRequestId).success ? suppliedRequestId : null;
  // The SQL contract requires the immutable self-bound user_delegated subject,
  // current membership/view, exact run and audit atomically. JWTs stay unchanged.
  let result;
  try { result = await auth.admin.rpc("read_reconciliation_runs_for_api" as never, {
    _token_id: auth.principal.tokenId, _tenant_id: auth.principal.tenantId, _tenant_slug: tenantSlug,
    _recon_id: reconId, _mode: mode, _run_id: runId,
    _page: query.page, _days: query.days, _status: query.status, _request_id: requestId,
  } as never); } catch { return workflowApiJson(503, { error: "reconciliation_read_unavailable" }, auth.cors); }
  if (result.error) {
    if (result.error.code === "42501" || result.error.code === "P0002") return workflowApiJson(404, { error: "reconciliation_read_not_found" }, auth.cors);
    return workflowApiJson(503, { error: "reconciliation_read_unavailable" }, auth.cors);
  }
  const parsed = (mode === "history" ? historyResponse : resultsResponse).safeParse(result.data);
  if (!parsed.success) return workflowApiJson(503, { error: "reconciliation_read_unavailable" }, auth.cors);
  if (parsed.data.page !== query.page || (mode === "history"
    ? (parsed.data as z.infer<typeof historyResponse>).rows.some(row => row.definition_id !== reconId)
    : (parsed.data as z.infer<typeof resultsResponse>).run.id !== runId || (parsed.data as z.infer<typeof resultsResponse>).run.definition_id !== reconId)) {
    return workflowApiJson(503, { error: "reconciliation_read_unavailable" }, auth.cors);
  }
  return workflowApiJson(200, { api_version: "v1", ...parsed.data }, auth.cors);
}
export const listPublicReconRunHistory = (request: Request, tenantSlug: string, reconId: string) => read(request, tenantSlug, reconId, "history", null);
export const getPublicReconRunResults = (request: Request, tenantSlug: string, reconId: string, runId: string) => read(request, tenantSlug, reconId, "results", runId);
