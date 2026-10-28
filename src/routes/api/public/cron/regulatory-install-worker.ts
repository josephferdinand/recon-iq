/**
 * D2 — Regulatory install worker.
 *
 * Materializes a `regulatory_pack_installs` row into:
 *   - 1 logical folder (recorded as `extension.folder` on artefacts).
 *   - N data_prep_pipelines (one per template).
 *   - 1 recon_definitions row pre-wired with the pack's field dictionary.
 *
 * Concurrency: the row is claimed atomically via `claim_regulatory_install`
 * (UPDATE … RETURNING). If a sibling worker has already claimed the row,
 * we return `{ ok: true, processed: 0 }` without doing any work.
 *
 * Idempotency: pipelines and recons are upserted by (tenant, name), so a
 * crash mid-materialisation followed by a retry completes correctly.
 *
 * Auth: `apikey: <SUPABASE_ANON_KEY>` header required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { safeErrorResponse, safeSupabaseError } from "@/lib/safe-error.server";

const PATH = "/api/public/cron/regulatory-install-worker";

export const Route = createFileRoute("/api/public/cron/regulatory-install-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret } = await import("@/lib/cron-auth.server");
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        let body: { install_id?: string } = {};
        try {
          body = (await request.json()) as { install_id?: string };
        } catch {
          /* empty body — pick oldest pending */
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Resolve target install id. When none is supplied, scan for the
        // oldest pending/installing row and try to claim it.
        let installId = body.install_id;
        if (!installId) {
          const { data: oldest, error: oErr } = await supabaseAdmin
            .from("regulatory_pack_installs")
            .select("id")
            .in("status", ["installing", "pending"])
            .order("installed_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (oErr)
            return safeErrorResponse(safeSupabaseError(oErr, { path: PATH }));
          if (!oldest) return Response.json({ ok: true, processed: 0 });
          installId = oldest.id as string;
        }

        // Atomic claim — returns claimed=false if another worker already owns it.
        const { data: claimRows, error: claimErr } = await supabaseAdmin.rpc(
          "claim_regulatory_install",
          { _install_id: installId },
        );
        if (claimErr)
          return safeErrorResponse(safeSupabaseError(claimErr, { path: PATH }));
        const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
        if (!claim?.claimed) {
          return Response.json({ ok: true, processed: 0, reason: "not_claimed" });
        }
        const installRow = claim.install_row as any;

        try {
          const { data: pack, error: packErr } = await supabaseAdmin
            .from("regulatory_template_packs")
            .select(
              "id, code, pack_code, title, version, field_dictionary, default_process_template",
            )
            .eq("id", installRow.pack_id)
            .single();
          if (packErr || !pack) throw new Error(packErr?.message ?? "pack not found");

          const tpl = (pack as any).default_process_template ?? {};
          const dict = (pack as any).field_dictionary ?? {};
          const folderName: string = tpl.folder?.name ?? (pack as any).title;
          const pipelinesBp: any[] = Array.isArray(tpl.data_prep_pipelines)
            ? tpl.data_prep_pipelines
            : [];
          const reconBp = (tpl.recon_processes ?? [])[0] ?? {};
          const tenantId = installRow.tenant_id;
          const userId = installRow.installed_by;

          // Data prep pipelines — idempotent by (tenant, name).
          const pipelineIds: string[] = [];
          for (const pl of pipelinesBp) {
            const { data: existing } = await supabaseAdmin
              .from("data_prep_pipelines")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("name", pl.name)
              .maybeSingle();
            if (existing?.id) {
              pipelineIds.push(existing.id);
              continue;
            }
            const { data: created, error: plErr } = await supabaseAdmin
              .from("data_prep_pipelines")
              .insert({
                tenant_id: tenantId,
                name: pl.name,
                description: `Generated from ${pack.pack_code ?? pack.code} v${pack.version}. Purpose: ${pl.purpose ?? "—"}`,
                steps: (pl.transformation_steps ?? []).map((s: string) => ({ op: s })),
                dq_rules: [],
                on_failure: "warn",
                enabled: true,
                created_by: userId,
                status: "draft",
              })
              .select("id")
              .single();
            if (plErr) throw new Error(`pipeline "${pl.name}": ${plErr.message}`);
            pipelineIds.push(created.id);
          }

          // Root recon — idempotent by (tenant, name).
          const matchFields = Object.entries(dict.trade ?? {}).map(([k, v]: any) => ({
            field: k,
            ...v,
          }));
          const tolerance = reconBp.tolerance ?? dict.match?.tolerance ?? {};
          const reconName = reconBp.name ?? `${folderName} — Root`;

          let reconId: string;
          const { data: existingRecon } = await supabaseAdmin
            .from("recon_definitions")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("name", reconName)
            .maybeSingle();
          if (existingRecon?.id) {
            reconId = existingRecon.id;
          } else {
            // recon_code is system-managed (`assign_reconciliation_code`):
            // FVI-<BU code|GEN>-<1WAY|2WAY|3WAY>-<6-digit per-tenant sequence>.
            // This insert sets no bu_id and is two_sided, so the trigger would
            // mint FVI-GEN-2WAY-…; as service_role this worker may supply that
            // exact code explicitly. Retry only the (tenant_id, recon_code)
            // unique violation a concurrent same-tenant install can cause
            // between reading the current sequence and inserting.
            let rd: { id: string } | null = null;
            let lastRdErr: { code?: string; message: string } | null = null;
            for (let attempt = 0; attempt < 5 && !rd; attempt++) {
              const { data: existingCodes, error: codesErr } = await supabaseAdmin
                .from("recon_definitions")
                .select("recon_code")
                .eq("tenant_id", tenantId)
                .like("recon_code", "FVI-GEN-2WAY-%");
              if (codesErr) throw new Error(`recon: ${codesErr.message}`);
              let maxSequence = 0;
              for (const row of existingCodes ?? []) {
                const sequence = Number(row.recon_code.split("-")[3]);
                if (Number.isInteger(sequence) && sequence > maxSequence) {
                  maxSequence = sequence;
                }
              }
              const reconCode = `FVI-GEN-2WAY-${String(maxSequence + 1).padStart(6, "0")}`;
              const { data: created, error: rdErr } = await supabaseAdmin
                .from("recon_definitions")
                .insert({
                  tenant_id: tenantId,
                  recon_code: reconCode,
                  name: reconName,
                  description: `Auto-generated from ${pack.pack_code ?? pack.code} v${pack.version}. Edit data sources and mappings for your environment.`,
                  recon_type: "two_sided",
                  sides: [
                    { name: "Internal", schema_ref: "trade" },
                    { name: "Counterparty (TR)", schema_ref: "trade" },
                  ],
                  rules: [
                    {
                      primary_key: reconBp.match_key ?? dict.match?.primary_key ?? "uti",
                      secondary_keys:
                        reconBp.match_keys_secondary ?? dict.match?.secondary_keys ?? [],
                      tolerance,
                      nrl: "MATCH internal.uti = counterparty.uti WITHIN TOLERANCE(notional, value_date)",
                    },
                  ],
                  status: "draft",
                  created_by: userId,
                  extension: {
                    source: "regulatory_pack",
                    folder: folderName,
                    pack_code: pack.pack_code ?? pack.code,
                    pack_version: pack.version,
                    install_id: installRow.id,
                    field_dictionary_fields: matchFields.length,
                    sla_policy: reconBp.sla_policy ?? null,
                  },
                })
                .select("id")
                .single();
              if (!rdErr && created) {
                rd = created;
              } else if (rdErr?.code === "23505") {
                lastRdErr = rdErr;
              } else if (rdErr) {
                throw new Error(`recon: ${rdErr.message}`);
              }
            }
            if (!rd) {
              throw new Error(
                `recon: ${lastRdErr?.message ?? "could not allocate recon_code"}`,
              );
            }
            reconId = rd.id;
          }

          // Atomic completion: single RPC flips status + writes artefacts.
          const { error: compErr } = await supabaseAdmin.rpc("complete_regulatory_install", {
            _install_id: installRow.id,
            _recon_id: reconId,
            _pipeline_ids: pipelineIds,
            _folder_name: folderName,
            _field_count: matchFields.length,
          });
          if (compErr) throw new Error(`complete: ${compErr.message}`);

          const generatedCount = pipelineIds.length + 1;

          await supabaseAdmin.from("security_events").insert({
            event_type: "regulatory.install.complete",
            severity: "info",
            context: {
              tenant_id: tenantId,
              pack_code: pack.pack_code ?? pack.code,
              install_id: installRow.id,
              generated_process_count: generatedCount,
            },
          } as any);

          await supabaseAdmin.from("audit_log").insert({
            actor_user_id: userId,
            tenant_id: tenantId,
            scope: "tenant",
            action: "regulatory.install.complete",
            resource_type: "regulatory_pack_installs",
            resource_id: installRow.id,
            context: {
              pack_code: pack.pack_code ?? pack.code,
              folder: folderName,
              pipeline_ids: pipelineIds,
              recon_id: reconId,
            },
          } as any);

          return Response.json({
            ok: true,
            install_id: installRow.id,
            generated_process_count: generatedCount,
            recon_id: reconId,
          });
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          // Atomic + hash-chained audit of the failed transition.
          await supabaseAdmin.rpc("fail_regulatory_install", {
            _install_id: installRow.id,
            _error: msg,
          });
          await supabaseAdmin.from("security_events").insert({
            event_type: "regulatory.install.failed",
            severity: "error",
            context: {
              tenant_id: installRow.tenant_id,
              install_id: installRow.id,
              error: msg,
            },
          } as any);
          const safe = safeSupabaseError({ message: msg, code: "P0001" }, { tenantId: installRow.tenant_id, path: PATH });
          return safeErrorResponse(safe);
        }
      },
    },
  },
});
