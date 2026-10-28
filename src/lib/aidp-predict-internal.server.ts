/**
 * Internal helper that lets the public AIDP API run a prediction without a
 * user session. It reproduces the predictDocument handler logic using the
 * service-role client — RLS is bypassed but every row is tagged with
 * `created_by = null` and the prediction is attributed to the API token's
 * tenant. Use ONLY from server-only entry points that have already verified
 * a tenant-scoped API token.
 */
import {
  resolveModelVersion, callPredictionModel, coerceValueColumns, decideForField,
  type EntityType,
} from "@/lib/aidp-predict.server";
import { checkBudget, recordUsage } from "@/lib/ai-metering.server";

export function readAidpPageDimensions(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number } {
  if (mime === "image/png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0) return { width, height };
  }
  if (mime === "image/jpeg" && bytes.length >= 4) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        if (width > 0 && height > 0) return { width, height };
      }
      offset += length + 2;
    }
  }
  if (mime === "application/pdf") {
    const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
    const mediaBox = header.match(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/);
    if (mediaBox) {
      const [, x1, y1, x2, y2] = mediaBox.map(Number);
      const width = Math.round(Math.abs(x2 - x1) * 150 / 72);
      const height = Math.round(Math.abs(y2 - y1) * 150 / 72);
      if (width > 0 && height > 0) return { width, height };
    }
  }
  throw new Error(`Unable to determine AIDP page dimensions for ${mime || "unknown MIME"}`);
}

export async function runPredictAsTenant(args: {
  tenant_id: string; document_id: string; idempotency_key?: string;
}): Promise<{
  prediction_id: string; auto_accepted_count: number; pending_review_count: number;
  model_version_id: string; idempotent_replay?: boolean;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin;

  // Idempotency short-circuit — replay prior prediction unchanged.
  if (args.idempotency_key) {
    const { data: existing } = await sb.from("aidp_predictions")
      .select("id, model_version_id, status")
      .eq("tenant_id", args.tenant_id)
      .eq("idempotency_key", args.idempotency_key)
      .maybeSingle();
    if (existing?.status === "succeeded") {
      const { data: pfs } = await sb.from("aidp_prediction_fields")
        .select("id, accepted_at, rejected_at").eq("prediction_id", (existing as any).id);
      const rows = pfs ?? [];
      return {
        prediction_id: (existing as any).id,
        auto_accepted_count: rows.filter((r: any) => r.accepted_at).length,
        pending_review_count: rows.filter((r: any) => !r.accepted_at && !r.rejected_at).length,
        model_version_id: (existing as any).model_version_id ?? "",
        idempotent_replay: true,
      };
    }
    if (existing) {
      throw new Error(
        `Prediction attempt is ${String(existing.status || "incomplete")}; refusing false-success replay`,
      );
    }
  }

  const budget = await checkBudget(sb, args.tenant_id);
  if (!budget.allowed) throw new Error(budget.reason || "AI budget exceeded");

  const { data: doc } = await sb.from("aidp_documents")
    .select("id, tenant_id, document_type_id, mime, extraction")
    .eq("id", args.document_id).eq("tenant_id", args.tenant_id).maybeSingle();
  if (!doc) throw new Error("Document not found");

  const { data: ets } = await sb.from("aidp_entity_types")
    .select("id,key,label,datatype,extractor,required,confidence_threshold,review_policy,options")
    .eq("tenant_id", args.tenant_id)
    .eq("document_type_id", (doc as any).document_type_id);
  if (!ets?.length) throw new Error("No entity types defined for this document type");

  const resolved = await resolveModelVersion(sb, args.tenant_id, (doc as any).document_type_id, undefined);
  const { data: pages } = await sb.from("aidp_pages")
    .select("id,page_index,image_uri,purpose")
    .eq("tenant_id", args.tenant_id).eq("document_id", args.document_id)
    .eq("purpose", "inference").order("page_index", { ascending: true });
  if (!pages?.length) {
    // Public-API documents arrive as a single source file; lazy-register one page
    // pointing at the uploaded source so the model has at least one image.
    const sp = (doc as any)?.extraction?.storage_path;
    if (!sp) throw new Error("No inference pages and no source path");
    const { data: signed } = await sb.storage.from("aidp").createSignedUrl(sp, 600);
    if (!signed?.signedUrl) throw new Error("Failed to sign AIDP source for page registration");
    const source = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(15_000) });
    if (!source.ok) throw new Error(`AIDP source fetch failed with status ${source.status}`);
    const bytes = new Uint8Array(await source.arrayBuffer());
    const dimensions = readAidpPageDimensions(bytes, String((doc as any).mime || ""));
    const { error: pageInsertError } = await sb.from("aidp_pages").insert({
      tenant_id: args.tenant_id, document_id: args.document_id,
      page_index: 0, purpose: "inference", image_uri: sp, dpi: 150,
      width: dimensions.width, height: dimensions.height,
    } as any);
    if (pageInsertError) throw new Error(`Failed to register AIDP inference page: ${pageInsertError.message}`);
  }
  const { data: pages2 } = await sb.from("aidp_pages")
    .select("id,page_index,image_uri")
    .eq("tenant_id", args.tenant_id).eq("document_id", args.document_id)
    .eq("purpose", "inference").order("page_index", { ascending: true });
  if (!pages2?.length) throw new Error("No AIDP inference pages available after registration");

  const signFn = async (storagePath: string): Promise<string> => {
    const { data: signed } = await sb.storage.from("aidp").createSignedUrl(storagePath, 600);
    if (!signed?.signedUrl) throw new Error(`Failed to sign ${storagePath}`);
    return signed.signedUrl;
  };
  const pageInputs = (pages2 ?? []).map((p: any) => ({ image_uri: p.image_uri, page_index: p.page_index }));

  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const modelVersionFk = isUuid(resolved.model_version_id) ? resolved.model_version_id : null;

  const insertPayload: any = {
    tenant_id: args.tenant_id, document_id: args.document_id,
    model_version_id: modelVersionFk, status: "running", decision: "pending",
    expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    raw_response: { model_meta: { provider: resolved.provider, model: resolved.model, source: resolved.source } } as any,
  };
  if (args.idempotency_key) insertPayload.idempotency_key = args.idempotency_key;

  const { data: predRow, error: pErr } = await sb.from("aidp_predictions")
    .insert(insertPayload).select("id").single();
  if (pErr || !predRow) {
    if (args.idempotency_key && /duplicate key|unique/i.test(pErr?.message ?? "")) {
      const { data: dup } = await sb
        .from("aidp_predictions")
        .select("id, model_version_id, status")
        .eq("tenant_id", args.tenant_id)
        .eq("idempotency_key", args.idempotency_key)
        .maybeSingle();
      if (dup?.status === "succeeded")
        return {
          prediction_id: (dup as any).id,
          auto_accepted_count: 0,
          pending_review_count: 0,
          model_version_id: (dup as any).model_version_id ?? "",
          idempotent_replay: true,
        };
      if (dup)
        throw new Error(
          `Prediction attempt is ${String(dup.status || "incomplete")}; refusing false-success replay`,
        );
    }
    throw new Error(pErr?.message || "Failed to create prediction");
  }
  const prediction_id = (predRow as any).id as string;

  let modelOut;
  try {
    modelOut = await callPredictionModel(resolved, ets as unknown as EntityType[], pageInputs, signFn);
  } catch (e: any) {
    await sb.from("security_events").insert({
      tenant_id: args.tenant_id, severity: "error", event_type: "aidp.predict.failed",
      context: { document_id: args.document_id, prediction_id, error: String(e?.message || e), source: "public_api" } as any,
    });
    await sb.from("aidp_predictions").update({
      status: "failed", error: String(e?.message || e), completed_at: new Date().toISOString(),
    } as any).eq("id", prediction_id);
    throw e;
  }

  const usage = await recordUsage(sb, {
    tenant_id: args.tenant_id, user_id: null as any, scope: "aidp",
    model: resolved.model, tokens_in: modelOut.tokens_in, tokens_out: modelOut.tokens_out,
    meta: { document_id: args.document_id, prediction_id, via: "public_api" },
  });

  const confidences: number[] = [];
  let auto_accepted_count = 0, pending_review_count = 0;
  for (const et of ets as unknown as EntityType[]) {
    const r = (modelOut.results as any)[et.key];
    const conf = typeof r?.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0;
    confidences.push(conf);
    const coerced = coerceValueColumns(et.datatype, r?.value);
    const { data: pf } = await sb.from("aidp_prediction_fields").insert({
      tenant_id: args.tenant_id, prediction_id, entity_type_id: et.id,
      page_id: (pages2 ?? [])[0]?.id ?? null,
      value: coerced.value_text ?? (coerced.value_number != null ? String(coerced.value_number) : null),
      ...coerced, confidence: conf, bbox: r?.bbox ?? null,
    } as any).select("id").single();
    if (!pf) { pending_review_count++; continue; }

    const verdict = decideForField(et.review_policy, conf, Number(et.confidence_threshold ?? 0.85));
    if (verdict === "auto_accept" && r?.value != null) {
      const { data: prior } = await sb.from("aidp_outputs").select("id")
        .eq("tenant_id", args.tenant_id).eq("document_id", args.document_id)
        .eq("entity_type_id", et.id).is("superseded_at", null).maybeSingle();
      await sb.from("aidp_outputs").insert({
        tenant_id: args.tenant_id, document_id: args.document_id, entity_type_id: et.id,
        prediction_field_id: (pf as any).id, decision: "auto_accepted", origin: "model",
        confidence: conf, supersedes_id: prior?.id ?? null, ...coerced,
      } as any);
      if (prior?.id) {
        await sb.from("aidp_outputs").update({ superseded_at: new Date().toISOString() } as any).eq("id", prior.id);
        await sb.from("aidp_output_recon_invalidations").insert({
          tenant_id: args.tenant_id, output_id: prior.id, reason: "output_superseded", status: "pending",
        } as any);
      }
      auto_accepted_count++;
    } else pending_review_count++;
  }

  const overall = confidences.length ? Number((confidences.reduce((a,b)=>a+b,0)/confidences.length).toFixed(3)) : null;
  const finalDecision = pending_review_count === 0 && auto_accepted_count > 0 ? "auto_accepted" : "pending";
  await sb.from("aidp_predictions").update({
    status: "succeeded", overall_confidence: overall, latency_ms: modelOut.latency_ms,
    raw_response: { ...(modelOut.results as any), model_meta: { provider: resolved.provider, model: resolved.model, source: resolved.source } } as any,
    completed_at: new Date().toISOString(),
    decision: finalDecision as any,
    decided_at: finalDecision === "auto_accepted" ? new Date().toISOString() : null,
  } as any).eq("id", prediction_id);
  await sb.from("aidp_documents").update({
    status: pending_review_count > 0 ? "review" : "approved",
    confidence: overall,
    model: resolved.model,
    cost_usd: usage.cost_usd,
  } as any).eq("id", args.document_id);

  await sb.from("audit_log").insert({
    actor_user_id: null, tenant_id: args.tenant_id, scope: "tenant",
    action: "aidp.predict.public_api",
    resource_type: "aidp_predictions", resource_id: prediction_id,
    context: { document_id: args.document_id, auto_accepted_count, pending_review_count, model: resolved.model } as any,
  } as any);

  return { prediction_id, auto_accepted_count, pending_review_count, model_version_id: resolved.model_version_id };
}
