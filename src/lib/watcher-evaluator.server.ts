import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateWatcherInput, type WatcherType, type WatcherUpload } from "@/lib/watcher-engine";

type SerializableDetail = Record<string, string | number | boolean | null | string[] | number[]>;

export async function evaluateWatcherById(args: {
  admin: SupabaseClient;
  tenantId: string;
  watcherId: string;
  actorUserId: string | null;
  trigger: "browser" | "api" | "schedule";
  now?: Date;
}) {
  const { data: watcher, error: watcherError } = await args.admin
    .from("data_watchers")
    .select(
      "id,tenant_id,data_source_id,name,watch_type,config,severity,enabled,last_state,last_alerted_at,created_by",
    )
    .eq("id", args.watcherId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (watcherError) throw new Error("Watcher lookup unavailable");
  if (!watcher) throw new Error("Watcher not found");
  if (!watcher.enabled) throw new Error("Watcher is disabled");

  const requestedUploadLimit =
    watcher.watch_type === "duplicate_file"
      ? Math.min(
          100,
          Math.max(
            2,
            Number((watcher.config as { lookback_uploads?: unknown })?.lookback_uploads ?? 20),
          ),
        )
      : 2;
  const { data: uploads, error: uploadError } = await args.admin
    .from("workspace_data_source_uploads")
    .select("id,created_at,filename,row_count,size_bytes,content_sha256,columns,rows")
    .eq("tenant_id", args.tenantId)
    .eq("data_source_id", watcher.data_source_id)
    .order("created_at", { ascending: false })
    .limit(requestedUploadLimit);
  if (uploadError) throw new Error("Watcher upload lookup unavailable");

  let dqRuns: Array<{ status: string; started_at: string }> = [];
  if (watcher.watch_type === "dq_failure") {
    const { data: pipelines, error: pipelineError } = await args.admin
      .from("data_prep_pipelines")
      .select("id")
      .eq("tenant_id", args.tenantId)
      .eq("source_data_source_id", watcher.data_source_id)
      .limit(100);
    if (pipelineError) throw new Error("Watcher pipeline lookup unavailable");
    const pipelineIds = (pipelines ?? []).map((pipeline) => pipeline.id);
    if (pipelineIds.length) {
      const { data: runs, error: runError } = await args.admin
        .from("data_prep_runs")
        .select("status,started_at")
        .eq("tenant_id", args.tenantId)
        .in("pipeline_id", pipelineIds)
        .order("started_at", { ascending: false })
        .limit(100);
      if (runError) throw new Error("Watcher DQ lookup unavailable");
      dqRuns = runs ?? [];
    }
  }

  const evaluation = evaluateWatcherInput({
    type: watcher.watch_type as WatcherType,
    config: watcher.config,
    uploads: (uploads ?? []) as WatcherUpload[],
    dqRuns,
    now: args.now,
  });
  const detail = JSON.parse(JSON.stringify(evaluation.detail)) as SerializableDetail;
  const quarantineOnAlert =
    (watcher.config as { quarantine_on_alert?: unknown })?.quarantine_on_alert === true;
  const { data: recorded, error: recordError } = await args.admin.rpc(
    "record_data_watcher_evaluation",
    {
      _tenant_id: args.tenantId,
      _watcher_id: args.watcherId,
      _new_state: evaluation.state,
      _outcome_code: evaluation.code,
      _detail: detail,
      _trigger: args.trigger,
      _actor_user_id: args.actorUserId,
      _reminder_hours: evaluation.reminderHours,
      _quarantine_on_alert: quarantineOnAlert,
      _checked_at: (args.now ?? new Date()).toISOString(),
    },
  );
  if (recordError || !recorded?.[0]) throw new Error("Watcher evidence persistence unavailable");
  return {
    ...evaluation,
    detail,
    event_id: recorded[0].event_id,
    previous_state: recorded[0].previous_state,
    notification_created: recorded[0].notification_created,
    source_quarantined: recorded[0].source_quarantined,
  };
}
