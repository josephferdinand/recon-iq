import { createFileRoute } from "@tanstack/react-router";

const CONTENT: Record<string, { mime: string; body: string }> = {
  "soc2-control-map.md": {
    mime: "text/markdown; charset=utf-8",
    body: `# ReconIQ SOC 2 Control Map (CC-series)

| Ref | Requirement | ReconIQ implementation |
|---|---|---|
| CC6.1 | Logical access controls | Supabase Auth + user_roles + RLS + Cloudflare Access |
| CC6.2 | Provisioning / deprovisioning | SCIM-ready user_roles; audit on role delta |
| CC6.3 | Least privilege | Role matrix (viewer/analyst/admin/platform); RLS per role |
| CC6.6 | Boundary protection | Cloudflare WAF Managed + Bot Management + secret-leak rule |
| CC6.7 | Data in transit | TLS 1.3 edge-to-origin; HSTS preload |
| CC6.8 | Malware / integrity | Signed builds; dependency scan; hash-chained audit rows |
| CC7.2 | System monitoring | Log Push -> SIEM (Datadog/Splunk/S3); anomaly alerts |
| CC7.3 | Incident response | Runbook; 15-min P1 ack; post-mortem in 5 business days |
| CC7.4 | Recovery | PITR (paid tier) ≤5 min RPO; RTO ≤2 h; quarterly DR drill |
| CC8.1 | Change management | PR review; migration gate; staged rollout; rollback |
| A1.2  | Availability | 99.95% target with SLA credits |
| C1.1  | Confidentiality | Tenant RLS + BYOK vault + signed URLs |
`,
  },
  "tenant-isolation.md": {
    mime: "text/markdown; charset=utf-8",
    body: `# ReconIQ Tenant Isolation (six-layer defense)

Layer | Control | Enforcement point
---|---|---
Identity | auth.uid() bound to tenant_id | Supabase Auth + has_tenant_access()
Data | tenant_id on every domain table | Postgres RLS policies
Storage | Object path prefix tenant_id/ | Storage policies + signed URLs
Compute | Re-check tenant on every server fn | requireSupabaseAuth middleware
Secrets / BYOK | Per-tenant encrypted vault row | Envelope encryption; server-only unwrap
Telemetry | Rows tagged with tenant_id | SIEM RLS enforcement

Failure containment: any one layer failing (e.g. a server function missing a tenant filter) is still blocked by RLS at the database. Defense in depth.

Diagram: docs/diagrams/65_tenant_isolation.mmd
`,
  },
  "incident-response.md": {
    mime: "text/markdown; charset=utf-8",
    body: `# ReconIQ Incident Response — Abridged Runbook

Phase | SLA | Action | Owner
---|---|---|---
Detect | ≤5 min | SIEM alert paged to on-call | Platform on-call
Triage | ≤15 min | Severity assigned; war room opened | Incident commander
Contain | ≤60 min | Isolate tenant / rotate keys / add WAF rule | On-call + security
Eradicate | ≤4 h | Patch; redeploy; verify | Engineering
Recover | ≤4 h RTO | Restore service; notify tenant | IC + CSM
Learn | ≤5 business d | Post-mortem; control update; audit entry | IC + security

Notification commitments
- Tenant notification ≤60 min of confirmed material impact
- Regulator notification per DPDP (72 h), GDPR (72 h), SAMA (as required)
- Written post-mortem within 5 business days to affected tenants

Diagram: docs/diagrams/66_ir_playbook.mmd
`,
  },
  "backups-dr.md": {
    mime: "text/markdown; charset=utf-8",
    body: `# ReconIQ Backups & Disaster Recovery

Tier | Detail | Metric
---|---|---
PITR | Continuous WAL, ≥14-day window (Supabase Teams) | RPO ≤5 min
Daily snapshot | Encrypted, cross-region copy | 30-day retention
Weekly full | Offsite object storage (R2 / S3) | 180-day retention
Quarterly DR drill | Full restore into staging; signed evidence artifact | RTO ≤2 h

Restore runbook (abridged)
1. Declare DR — on-call authorizes; page executive sponsor
2. Provision recovery project (IaC) — 15 min
3. Restore PITR to target timestamp — 30-90 min
4. Re-attach Cloudflare route + WAF policy — 10 min
5. Smoke test + tenant sign-off — 30 min
6. Cutover DNS + post-incident audit entry
`,
  },
  "audit-coverage.md": {
    mime: "text/markdown; charset=utf-8",
    body: `# ReconIQ Audit Log Coverage Matrix

Event class | Fields captured | Retention | Immutable
---|---|---|---
Authentication | user, ip, ua, mfa, outcome | 400 d | Yes (append-only)
Data access (read) | user, tenant, table, row_ids, purpose | 400 d | Yes
Data mutation | user, tenant, table, before/after hash | 7 y | Yes
Admin actions | user, tenant, action, target, justification | 7 y | Yes
Permission changes | actor, subject, role_delta, tenant | 7 y | Yes
Copilot / AI calls | user, tenant, model, prompt_hash, tokens | 400 d | Yes
Ticket lifecycle | actor, ticket_id, transition, sla_state | 7 y | Yes
Export / download | user, tenant, dataset, bytes, purpose | 7 y | Yes

Append-only enforced by revoking UPDATE / DELETE on audit_log from all roles; INSERTs go through a security-definer function. Rows are hash-chained for tamper-evidence.
`,
  },
  "apm-siem-setup.md": {
    mime: "text/markdown; charset=utf-8",
    body: `# ReconIQ APM + SIEM Setup Runbook

## Environment variables
| Name | Purpose | Example |
|---|---|---|
| \`APM_ENDPOINT\` | OTLP/HTTP or vendor HTTP ingest URL | \`https://http-intake.logs.datadoghq.com/api/v2/logs\` |
| \`APM_API_KEY\` | Bearer / DD-API-KEY | (secret) |
| \`APM_SERVICE_NAME\` | Service tag | \`fvi\` |
| \`SIEM_ENDPOINT\` | Splunk HEC / Elastic / vendor HTTPS ingest | \`https://<splunk>/services/collector/event\` |
| \`SIEM_API_KEY\` | HEC token / bearer | (secret) |

Set via project Secrets — never commit. Missing endpoints are safe: the pipeline silently no-ops.

## What we emit
- **APM spans** — one per server-fn invocation, cron run, and manual test emit. Fields: name, duration_ms, status, trace_id, span_id, tenant.id, user.id, custom attributes.
- **SIEM events** — auth successes/failures, admin actions, break-glass, RLS violations, cron failures, error spans.

## Dashboards to build
1. **Golden signals** — RED (rate, errors, duration) by server-fn name; p50/p95/p99 latency.
2. **Tenant hotspot** — top 10 tenants by request volume and error rate.
3. **Copilot AI** — tokens_in/out, latency, error rate by model+provider.
4. **Cron health** — success rate and duration for backup-verify, DR drill, evidence anchoring.
5. **Security posture** — auth failures, break-glass grants, RLS denials, WAF events.

## Alerts
| Signal | Threshold | Route |
|---|---|---|
| p95 latency (server-fn) | > 2 s for 10 min | PagerDuty P2 |
| Error rate | > 2% for 5 min | PagerDuty P1 |
| Cron failure | any \`cron.*.failed\` | Slack #ops + PagerDuty P2 |
| Auth failure spike | > 20/min per user | Slack #security |
| Break-glass grant | any event | Slack #security + email CISO |
| RLS violation | any event | PagerDuty P1 |

## Validation
Visit **Platform → Observability** and click "Emit synthetic span + event". Confirm the trace appears in your APM within ~60 s and the event in your SIEM. If either is missing, re-check the endpoint URL and API key.
`,
  },
  "erp-connector-output-schemas.md": {
    mime: "text/markdown; charset=utf-8",
    body: `# ReconIQ ERP Connector Output Schemas (v1.0)

Every connector (SAP, Oracle, Tally, Finacle, Flexcube) normalizes source rows into a single canonical shape before feeding the recon engine. This guarantees the same rules, tolerance ladders, and match algorithms work across all sources.

## Common columns
| Column | Type | Required | Notes |
|---|---|---|---|
| external_id | string | ✓ | Native record id in source |
| posted_date | date | ✓ | |
| value_date | date | | |
| account_code | string | ✓ | |
| account_name | string | | |
| counterparty_code | string | | |
| reference | string | | |
| narrative | string | | |
| currency | string | ✓ | ISO 4217 |
| amount | decimal(20,4) | ✓ | Signed |
| amount_base | decimal(20,4) | | In reporting currency |
| debit_credit | enum(D,C) | ✓ | |
| batch_id | string | | |
| source_hash | string | ✓ | SHA-256 of normalized payload — idempotency key |
| raw_payload | jsonb | ✓ | Full source record for audit replay |

## Connector-specific columns
- **SAP**: gl_account, cost_center, profit_center, document_type, company_code
- **Oracle**: ledger_id, je_source, je_category, org_id
- **Tally**: voucher_type, voucher_number, ledger_group
- **Finacle**: sol_id, part_tran_type, gl_sub_head_code, cust_id
- **Flexcube**: branch_code, product_code, module_code, account_class

## Credential handling
| Connector | Recommended auth | Notes |
|---|---|---|
| SAP S/4HANA OData | OAuth 2.0 | Client credentials grant against SAP BTP |
| Oracle Fusion / EBS | OAuth 2.0 | \`urn:opc:resource:consumer::all\` scope |
| Tally Prime | Basic (via ODBC / XML gateway) | LAN gateway; usually behind VPN |
| Finacle Connect24 | Service account | Bank issues per-tenant service creds |
| Flexcube UBS | Service account | Message-source id required |

Raw secrets never touch this UI. Store in the app vault; only the vault reference (\`credential_vault_secret_id\`) is persisted on \`erp_connector_configs\`.

## Idempotency
Every ingested row carries \`source_hash\`. Duplicate ingestion is a no-op: the recon staging table has a unique constraint on \`(tenant_id, connector_kind, source_hash)\`.
`,
  },
};


export const Route = createFileRoute("/api/appendix/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const doc = CONTENT[params.file];
        if (!doc) return new Response("Not Found", { status: 404 });
        return new Response(doc.body, {
          status: 200,
          headers: {
            "content-type": doc.mime,
            "cache-control": "public, max-age=300",
            "content-disposition": `attachment; filename="${params.file}"`,
          },
        });
      },
    },
  },
});
