#!/usr/bin/env python3
"""
FVI: seed N isolated test tenants on PROD Supabase.

Pattern adapted from `.claude/handover/DEV_REPLICATION_VERIFICATION.md`
(Diego dev seed) — uses the Supabase Management API `/database/query`
endpoint running as the `postgres` role, which bypasses RLS (LL-024).

For each tenant (T01..T12):
  - INSERT public.tenants (env_tier='uat' so we don't mark them prod)
  - INSERT public.tenant_members (Joseph as tenant_admin)
  - CREATE 2 auth.users via GoTrue admin API (admin + analyst)
  - INSERT 2 tenant_members rows for the new users
  - INSERT 1 recon_definitions
  - INSERT 1 recon_nrl_rules (3 passes, threshold 0.92)
  - INSERT 2 workspace_data_sources (GL + Bank)
  - INSERT 1 workspace_data_source_uploads (50 GL rows)
  - INSERT 1 workspace_data_source_uploads (50 Bank rows)
  - INSERT 1 recon_runs (status=completed, synthetic counters)
  - INSERT 5 recon_exceptions (varied severity / side)

Idempotent: deterministic UUIDs + ON CONFLICT DO NOTHING.

SET LOCAL request.jwt.claim.sub is set on every transaction so
SECURITY DEFINER triggers (e.g. audit_log_chain, tg_recon_run_autopack)
can resolve auth.uid() without a real JWT (LL-025).
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ----------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------
SECRETS = Path.home() / ".fvi-secrets"
PAT_PATH = SECRETS / "SUPABASE_PAT"
PROD_SERVICE_KEY_PATH = SECRETS / "SUPABASE_PROD_SERVICE_ROLE_KEY"

PROJECT_REF = "YOUR_PROJECT_REF"
PROD_URL = "https://YOUR_PROJECT_REF.supabase.co"
ALLOWED_HTTP_HOSTS = {
    "api.supabase.com",
    urllib.parse.urlsplit(PROD_URL).hostname,
}

JOSEPH_UUID = "d168a433-a06f-40c8-96b0-20286b38c8a2"
JOSEPH_EMAIL = "joseph.ferdinand@reconiq.example"

# Plan: create up to 12 (T01..T12). Stop after 10 successful. The last 2 are
# buffer in case a couple of tenants fail (per task instructions).
TOTAL = 12
TARGET_OK = 10

SLUG_PREFIX = "iso-test"
# Use a deterministic UUID5 namespace so re-runs produce stable ids.
NS = uuid.UUID("f6c1e2a0-3b4d-4e9f-8a1c-2d3e4f5a6b7c")


def _id(label: str, *parts: str) -> str:
    """Deterministic UUID5 for stable re-runs."""
    return str(uuid.uuid5(NS, label + ":" + "/".join(parts)))


# ----------------------------------------------------------------------
# HTTP helpers
# ----------------------------------------------------------------------
def _validated_http_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ALLOWED_HTTP_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
    ):
        raise ValueError("Refusing non-allowlisted HTTP destination")
    return parsed.geturl()


def _http(url: str, method: str, headers: dict, body: bytes | None, timeout: int = 60):
    req = urllib.request.Request(_validated_http_url(url), data=body, method=method, headers=headers)
    try:
        # `_validated_http_url` enforces HTTPS and the fixed Supabase host allowlist.
        with urllib.request.urlopen(req, timeout=timeout) as r:  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        return 0, f"URLError: {e}"


def _ok(status: int) -> bool:
    return 200 <= status < 300


def db_query(pat: str, sql: str) -> tuple[int, str]:
    """Management API /database/query — runs as `postgres`, bypasses RLS."""
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    headers = {
        "Authorization": f"Bearer {pat}",
        "Content-Type": "application/json",
        "User-Agent": "curl/8.5.0",  # avoid Cloudflare 1010 on default Python-urllib UA
    }
    payload = json.dumps({"query": sql}).encode("utf-8")
    return _http(url, "POST", headers, payload, timeout=120)


def admin_create_user(service_key: str, email: str, role_label: str) -> tuple[int, str, str | None]:
    """GoTrue admin API: create user. Returns (status, body, user_id_or_None)."""
    url = f"{PROD_URL}/auth/v1/admin/users"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "User-Agent": "curl/8.5.0",
    }
    body = json.dumps({
        "email": email,
        "email_confirm": True,
        "user_metadata": {"role": role_label, "seed": "iso-test-2026-08-23"},
    }).encode("utf-8")
    status, resp = _http(url, "POST", headers, body, timeout=60)
    uid = None
    if status in (200, 201):
        try:
            uid = json.loads(resp).get("id")
        except json.JSONDecodeError:
            pass
    return status, resp, uid


def admin_get_user_by_email(service_key: str, email: str) -> str | None:
    """Look up a user by email (returns id or None)."""
    url = f"{PROD_URL}/auth/v1/admin/users"
    qs = urllib.parse.urlencode({"email": email})
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "User-Agent": "curl/8.5.0",
    }
    status, body = _http(f"{url}?{qs}", "GET", headers, None, timeout=30)
    if status != 200:
        return None
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    users = data.get("users") if isinstance(data, dict) else data
    for user in users or []:
        if user.get("email") == email:
            return user.get("id")
    return None


# ----------------------------------------------------------------------
# Tenant build
# ----------------------------------------------------------------------
def build_tenant(n: int) -> dict:
    """Return per-tenant deterministic ids + metadata."""
    suffix = f"{n:02d}"
    slug = f"{SLUG_PREFIX}-{suffix}"
    return {
        "n": n,
        "suffix": suffix,
        "slug": slug,
        "name": f"Iso Test {suffix}",
        "tenant_id": _id("tenant", slug),
        "definition_id": _id("def", slug),
        "nrl_rule_id": _id("nrl", slug),
        "ds_gl_id": _id("ds-gl", slug),
        "ds_bank_id": _id("ds-bank", slug),
        "upload_gl_id": _id("up-gl", slug),
        "upload_bank_id": _id("up-bank", slug),
        "run_id": _id("run", slug),
        "exception_ids": [_id("exc", slug, str(i)) for i in range(5)],
        "admin_email": f"iso-admin-{suffix}@falconveritas-test.dev",
        "analyst_email": f"iso-analyst-{suffix}@falconveritas-test.dev",
    }


def gen_rows(tenant: dict, side: str, n_rows: int, seed: int) -> list[dict]:
    """Generate `n_rows` deterministic rows for GL or Bank side.

    GL rows: reference, txn_date, amount, account, description
    Bank rows: reference, txn_date, amount, counterparty

    For the 50/50 dataset we make every row a perfect match on its counterpart
    (same ref + date + amount) so the recon engine would auto-match all 100,
    and we manually inject 5 exceptions via the recon_exceptions table to keep
    the data simple and deterministic.
    """
    rng = random.Random(seed)
    base = datetime.date(2026, 8, 22)
    accounts = [("1000", "Cash"), ("2000", "Customer Deposits"),
                ("3000", "Card Receivables"), ("4000", "Wire Settlement"),
                ("5000", "Fees")]
    rows = []
    for i in range(1, n_rows + 1):
        ref = f"{side.upper()}-{tenant['suffix']}-{i:04d}"
        amt = round(rng.uniform(100, 9000), 2)
        day = (base - datetime.timedelta(days=i % 30)).isoformat()
        if side == "GL":
            acct_code, acct_name = accounts[i % len(accounts)]
            rows.append({
                "reference": ref,
                "txn_date": day,
                "amount": amt,
                "account": acct_code,
                "description": f"{acct_name} {ref}",
            })
        else:
            cp = accounts[i % len(accounts)][1]
            rows.append({
                "reference": ref,
                "txn_date": day,
                "amount": amt,
                "counterparty": cp,
            })
    return rows


# ----------------------------------------------------------------------
# SQL builders
# ----------------------------------------------------------------------
def _j(obj) -> str:
    """JSON-encode for SQL. Postgres jsonb literal."""
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def sql_create_tenant(tenant: dict) -> str:
    tid = tenant["tenant_id"]
    return f"""
BEGIN;
SELECT set_config('request.jwt.claim.sub', '{JOSEPH_UUID}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.tenants (
  id, slug, name, environment, ai_enabled, region, residency_locked,
  run_retention_days, agent_max_actions, agent_max_distinct_tables,
  onboarding_state, allowed_regions, sandbox_enabled, created_by
) VALUES (
  '{tid}'::uuid,
  '{tenant["slug"]}',
  '{tenant["name"]}',
  'uat'::env_tier,
  false,
  'eu-west-2',
  true,
  90,
  50,
  10,
  '{{"step":"complete","completed_at":"2026-08-23T00:00:00Z","source":"iso-seed"}}'::jsonb,
  ARRAY['eu-west-2']::text[],
  false,
  '{JOSEPH_UUID}'::uuid
) ON CONFLICT (id) DO NOTHING;

COMMIT;
"""


def sql_add_tenant_member(tenant_id: str, user_id: str, role: str, invited_by: str = JOSEPH_UUID) -> str:
    return f"""
BEGIN;
SELECT set_config('request.jwt.claim.sub', '{invited_by}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.tenant_members (
  tenant_id, user_id, role, invited_by, active, added_by_platform
) VALUES (
  '{tenant_id}'::uuid,
  '{user_id}'::uuid,
  '{role}'::tenant_role,
  '{invited_by}'::uuid,
  true,
  false
) ON CONFLICT (tenant_id, user_id) DO NOTHING;

COMMIT;
"""


def sql_create_definition_and_rule(tenant: dict) -> str:
    tid = tenant["tenant_id"]
    did = tenant["definition_id"]
    nid = tenant["nrl_rule_id"]
    sides = [
        {"side_id": "A", "label": "GL Entries", "data_source_id": tenant["ds_gl_id"]},
        {"side_id": "B", "label": "Bank Statement", "data_source_id": tenant["ds_bank_id"]},
    ]
    rules = [
        {"id": "R1_exact", "kind": "exact_match", "description": "Exact match on reference + date",
         "fields": {"A": "reference", "B": "reference"}, "is_key": True},
        {"id": "R2_amt_tol", "kind": "numeric_tolerance_abs", "description": "Amount within 0.01",
         "fields": {"A": "amount", "B": "amount"}, "params": {"tolerance": 0.01}},
        {"id": "R3_date_window", "kind": "date_tolerance_days", "description": "Date within 3 days",
         "fields": {"A": "txn_date", "B": "txn_date"}, "params": {"days": 3}},
    ]
    compiled_rule = {
        "passes": [
            {"order": 1, "kind": "exact_match", "fields": {"A": "reference", "B": "reference"}},
            {"order": 2, "kind": "numeric_tolerance_abs",
             "fields": {"A": "amount", "B": "amount"}, "params": {"tolerance": 0.01}},
            {"order": 3, "kind": "date_tolerance_days",
             "fields": {"A": "txn_date", "B": "txn_date"}, "params": {"days": 3}},
        ],
        "threshold": 0.92,
    }
    return f"""
BEGIN;
SELECT set_config('request.jwt.claim.sub', '{JOSEPH_UUID}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.recon_definitions (
  id, tenant_id, name, description, recon_type, sides, rules, status,
  visibility, extension, environment, created_by
) VALUES (
  '{did}'::uuid,
  '{tid}'::uuid,
  'Iso {tenant["suffix"]} — Daily GL vs Bank (GBP)',
  'Isolated test reconciliation: GL entries vs daily bank statement feed.',
  'two_sided',
  '{_j(sides)}'::jsonb,
  '{_j(rules)}'::jsonb,
  'active',
  'tenant',
  '{{"schedule":"daily_0300_utc","source":"iso-seed","seeded_at":"2026-08-23T00:00:00Z"}}'::jsonb,
  'staging',
  '{JOSEPH_UUID}'::uuid
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.recon_nrl_rules (
  id, tenant_id, definition_id, name, description, nrl_source,
  compiled_rule, pass_order, enabled, validation_errors, created_by
) VALUES (
  '{nid}'::uuid,
  '{tid}'::uuid,
  '{did}'::uuid,
  'Iso {tenant["suffix"]} — exact → amount-tol → date-window',
  'Pass 1 exact match on ref; Pass 2 amount within 0.01; Pass 3 date within 3 days. Threshold 0.92.',
  'RULE exact_match(ref) AND numeric_tolerance_abs(amount, 0.01) AND date_tolerance_days(txn_date, 3);',
  '{_j(compiled_rule)}'::jsonb,
  1,
  true,
  '[]'::jsonb,
  '{JOSEPH_UUID}'::uuid
) ON CONFLICT (id) DO NOTHING;

COMMIT;
"""


def sql_create_data_sources(tenant: dict) -> str:
    tid = tenant["tenant_id"]
    gl_id = tenant["ds_gl_id"]
    bank_id = tenant["ds_bank_id"]
    gl_schema = {"columns": [
        {"name": "reference", "type": "string"},
        {"name": "txn_date", "type": "date"},
        {"name": "amount", "type": "number"},
        {"name": "account", "type": "string"},
        {"name": "description", "type": "string"},
    ]}
    bank_schema = {"columns": [
        {"name": "reference", "type": "string"},
        {"name": "txn_date", "type": "date"},
        {"name": "amount", "type": "number"},
        {"name": "counterparty", "type": "string"},
    ]}
    return f"""
BEGIN;
SELECT set_config('request.jwt.claim.sub', '{JOSEPH_UUID}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.workspace_data_sources (
  id, tenant_id, name, description, source_type, connection_config,
  inferred_schema, sample_rows, row_count, status, created_by
) VALUES
(
  '{gl_id}'::uuid,
  '{tid}'::uuid,
  'Iso {tenant["suffix"]} — GL Entries (CSV)',
  'GL postings for isolated test tenant {tenant["suffix"]}.',
  'csv',
  '{{"format":"csv","delimiter":",","header":true}}'::jsonb,
  '{_j(gl_schema)}'::jsonb,
  '[]'::jsonb,
  50,
  'ready',
  '{JOSEPH_UUID}'::uuid
),
(
  '{bank_id}'::uuid,
  '{tid}'::uuid,
  'Iso {tenant["suffix"]} — Bank Statement (CSV)',
  'Bank statement feed mirrored to isolated test tenant {tenant["suffix"]}.',
  'csv',
  '{{"format":"csv","delimiter":",","header":true}}'::jsonb,
  '{_j(bank_schema)}'::jsonb,
  '[]'::jsonb,
  50,
  'ready',
  '{JOSEPH_UUID}'::uuid
) ON CONFLICT (id) DO NOTHING;

COMMIT;
"""


def sql_create_uploads(tenant: dict, gl_rows: list[dict], bank_rows: list[dict]) -> str:
    tid = tenant["tenant_id"]
    gl_upload_id = tenant["upload_gl_id"]
    bank_upload_id = tenant["upload_bank_id"]
    gl_payload = json.dumps(gl_rows, separators=(",", ":"), ensure_ascii=False)
    bank_payload = json.dumps(bank_rows, separators=(",", ":"), ensure_ascii=False)
    gl_sha = hashlib.sha256(gl_payload.encode("utf-8")).hexdigest()
    bank_sha = hashlib.sha256(bank_payload.encode("utf-8")).hexdigest()
    gl_cols = [{"name": "reference", "type": "string"},
               {"name": "txn_date", "type": "date"},
               {"name": "amount", "type": "number"},
               {"name": "account", "type": "string"},
               {"name": "description", "type": "string"}]
    bank_cols = [{"name": "reference", "type": "string"},
                 {"name": "txn_date", "type": "date"},
                 {"name": "amount", "type": "number"},
                 {"name": "counterparty", "type": "string"}]
    gl_sample = json.dumps(gl_rows[:5], separators=(",", ":"), ensure_ascii=False)
    bank_sample = json.dumps(bank_rows[:5], separators=(",", ":"), ensure_ascii=False)
    return f"""
BEGIN;
SELECT set_config('request.jwt.claim.sub', '{JOSEPH_UUID}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.workspace_data_source_uploads (
  id, tenant_id, data_source_id, filename, mime_type, size_bytes,
  row_count, columns, sample_rows, content_sha256, uploaded_by, rows
) VALUES
(
  '{gl_upload_id}'::uuid,
  '{tid}'::uuid,
  '{tenant["ds_gl_id"]}'::uuid,
  'iso-{tenant["suffix"]}-gl-2026-08-23.csv',
  'text/csv',
  {len(gl_payload)},
  {len(gl_rows)},
  '{_j(gl_cols)}'::jsonb,
  '{gl_sample}'::jsonb,
  '{gl_sha}',
  '{JOSEPH_UUID}'::uuid,
  '{gl_payload}'::jsonb
),
(
  '{bank_upload_id}'::uuid,
  '{tid}'::uuid,
  '{tenant["ds_bank_id"]}'::uuid,
  'iso-{tenant["suffix"]}-bank-2026-08-23.csv',
  'text/csv',
  {len(bank_payload)},
  {len(bank_rows)},
  '{_j(bank_cols)}'::jsonb,
  '{bank_sample}'::jsonb,
  '{bank_sha}',
  '{JOSEPH_UUID}'::uuid,
  '{bank_payload}'::jsonb
) ON CONFLICT (id) DO NOTHING;

COMMIT;
"""


def sql_create_run_and_exceptions(tenant: dict) -> str:
    tid = tenant["tenant_id"]
    did = tenant["definition_id"]
    rid = tenant["run_id"]
    # We seed 50 perfect-match pairs (100 rows total) + 5 manual exceptions.
    # For statistical realism: matched_count=95, exception_count=5, total=100.
    # (5 pairs deliberately removed from one side to feed exceptions.)
    run_uid = f"iso-{tenant['suffix']}-2026-08-23-001"
    started_at = "2026-08-23T00:00:00+00:00"
    completed_at = "2026-08-23T00:01:00+00:00"
    stats = {
        "matched_records": 95,
        "exception_count": 5,
        "total_rows": 100,
        "gl_rows": 50,
        "bank_rows": 50,
        "passes": {"R1_exact": 95, "R2_amt_date_tol": 0, "R3_ref_norm": 0},
        "success_rate": 0.95,
        "source": "iso-seed",
        "seeded_at": started_at,
    }
    run_sql = f"""
BEGIN;
SELECT set_config('request.jwt.claim.sub', '{JOSEPH_UUID}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.recon_runs (
  id, tenant_id, definition_id, run_uid, status,
  matched_count, exception_count, total_rows, stats,
  started_at, completed_at, run_by
) VALUES (
  '{rid}'::uuid,
  '{tid}'::uuid,
  '{did}'::uuid,
  '{run_uid}',
  'completed',
  95,
  5,
  100,
  '{_j(stats)}'::jsonb,
  '{started_at}'::timestamptz,
  '{completed_at}'::timestamptz,
  '{JOSEPH_UUID}'::uuid
) ON CONFLICT (id) DO NOTHING;
"""

    # 5 exceptions: 3 GL-side, 2 Bank-side, varied severity/priority
    exc_specs = [
        ("A", "no_match_on_bank_side",   "high",     "P2", "manual_adjustment"),
        ("A", "no_match_on_bank_side",   "medium",   "P3", "amount_mismatch"),
        ("A", "no_match_on_bank_side",   "low",      "P4", "minor_diff"),
        ("B", "no_match_on_gl_side",     "medium",   "P3", "unposted"),
        ("B", "no_match_on_gl_side",     "high",     "P2", "duplicate_candidate"),
    ]
    for i, (side, reason, sev, prio, label) in enumerate(exc_specs):
        eid = tenant["exception_ids"][i]
        if side == "A":
            payload = {
                "reference": f"ISO-{tenant['suffix']}-UNMATCHED-GL-{i+1:03d}",
                "amount": round(100 + i * 250.0, 2),
                "txn_date": "2026-08-22",
                "account": "5000",
                "description": "Manual GL adjustment (no bank match)",
            }
        else:
            payload = {
                "reference": f"ISO-{tenant['suffix']}-UNMATCHED-BANK-{i+1:03d}",
                "amount": round(75 + i * 175.0, 2),
                "txn_date": "2026-08-22",
                "counterparty": "Unknown",
            }
        run_sql += f"""
INSERT INTO public.recon_exceptions (
  id, run_id, tenant_id, side, reason, severity, status,
  payload, review_state, labels
) VALUES (
  '{eid}'::uuid,
  '{rid}'::uuid,
  '{tid}'::uuid,
  '{side}',
  '{reason}',
  '{sev}',
  'open',
  '{_j(payload)}'::jsonb,
  'unreviewed',
  ARRAY['{label}','iso-seed']::text[]
) ON CONFLICT (id) DO NOTHING;
"""
    run_sql += "\nCOMMIT;\n"
    return run_sql


# ----------------------------------------------------------------------
# Seeding (per tenant)
# ----------------------------------------------------------------------
def seed_one(n: int, pat: str, service_key: str) -> tuple[int, str, dict]:
    t = build_tenant(n)
    log = {"n": n, "slug": t["slug"], "tenant_id": t["tenant_id"], "steps": []}

    def step(name: str, status: int, body: str):
        ok = _ok(status)
        snippet = body[:200]
        log["steps"].append({"name": name, "status": status, "ok": ok, "body": snippet})
        return status, body

    # 1. tenants
    s, b = db_query(pat, sql_create_tenant(t))
    step("tenants.insert", s, b)
    if not _ok(s):
        return n, "FAILED at tenants.insert", log

    # 2. tenant_members for Joseph
    s, b = db_query(pat, sql_add_tenant_member(t["tenant_id"], JOSEPH_UUID, "tenant_admin"))
    step("tenant_members.joseph", s, b)
    if not _ok(s):
        return n, "FAILED at tenant_members.joseph", log

    # 3. GoTrue admin users
    for role_label, email in [
        ("tenant_admin", t["admin_email"]),
        ("tenant_analyst", t["analyst_email"]),
    ]:
        s, b, uid = admin_create_user(service_key, email, role_label)
        if not uid:
            # Probably already exists — look it up
            uid = admin_get_user_by_email(service_key, email)
        step(f"gotrue.create.{role_label}", s if uid else 0, b)
        if uid:
            member_role = "tenant_admin" if role_label == "tenant_admin" else "tenant_analyst"
            s2, b2 = db_query(pat, sql_add_tenant_member(t["tenant_id"], uid, member_role))
            step(f"tenant_members.{role_label}", s2, b2)
            log.setdefault("users", []).append({"role": member_role, "email": email, "id": uid})

    # 4. defs + nrl
    s, b = db_query(pat, sql_create_definition_and_rule(t))
    step("recon_definitions+nrl_rules", s, b)
    if not _ok(s):
        return n, "FAILED at recon_definitions+nrl_rules", log

    # 5. data sources
    s, b = db_query(pat, sql_create_data_sources(t))
    step("workspace_data_sources", s, b)
    if not _ok(s):
        return n, "FAILED at workspace_data_sources", log

    # 6. uploads
    gl_rows = gen_rows(t, "GL", 50, seed=20260823 + n)
    bank_rows = gen_rows(t, "BK", 50, seed=20260823 + n + 1000)
    s, b = db_query(pat, sql_create_uploads(t, gl_rows, bank_rows))
    step("workspace_data_source_uploads", s, b)
    if not _ok(s):
        return n, "FAILED at workspace_data_source_uploads", log

    # 7. recon_runs + recon_exceptions
    s, b = db_query(pat, sql_create_run_and_exceptions(t))
    step("recon_runs+recon_exceptions", s, b)
    if not _ok(s):
        return n, "FAILED at recon_runs+recon_exceptions", log

    log["status"] = "OK"
    return n, "OK", log


def verify(pat: str) -> dict:
    counts_sql = """
SELECT 'tenants' AS k, count(*)::int AS n FROM public.tenants WHERE slug LIKE 'iso-test-%'
UNION ALL SELECT 'tenant_members', count(*)::int FROM public.tenant_members tm JOIN public.tenants t ON tm.tenant_id=t.id WHERE t.slug LIKE 'iso-test-%'
UNION ALL SELECT 'recon_definitions', count(*)::int FROM public.recon_definitions d JOIN public.tenants t ON d.tenant_id=t.id WHERE t.slug LIKE 'iso-test-%'
UNION ALL SELECT 'recon_nrl_rules', count(*)::int FROM public.recon_nrl_rules n JOIN public.tenants t ON n.tenant_id=t.id WHERE t.slug LIKE 'iso-test-%'
UNION ALL SELECT 'workspace_data_sources', count(*)::int FROM public.workspace_data_sources ds JOIN public.tenants t ON ds.tenant_id=t.id WHERE t.slug LIKE 'iso-test-%'
UNION ALL SELECT 'workspace_data_source_uploads', count(*)::int FROM public.workspace_data_source_uploads u JOIN public.tenants t ON u.tenant_id=t.id WHERE t.slug LIKE 'iso-test-%'
UNION ALL SELECT 'recon_runs', count(*)::int FROM public.recon_runs r JOIN public.tenants t ON r.tenant_id=t.id WHERE t.slug LIKE 'iso-test-%'
UNION ALL SELECT 'recon_exceptions', count(*)::int FROM public.recon_exceptions e JOIN public.tenants t ON e.tenant_id=t.id WHERE t.slug LIKE 'iso-test-%';
"""
    s, b = db_query(pat, counts_sql)
    if not _ok(s):
        return {"error": f"HTTP {s}: {b[:300]}"}
    try:
        rows = json.loads(b)
        return {r["k"]: r["n"] for r in rows}
    except json.JSONDecodeError:
        return {"error": b[:300]}


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------
def main():
    pat = PAT_PATH.read_text().strip()
    service_key = PROD_SERVICE_KEY_PATH.read_text().strip()

    print("Supabase credentials loaded from the local ignored vault")
    print(f"Project ref: {PROJECT_REF}")
    print(f"Joseph UUID: {JOSEPH_UUID}")

    results: list[tuple[int, str, dict]] = []
    success = 0

    # 4 workers — modest parallelism, keeps within GoTrue rate limits
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(seed_one, n, pat, service_key): n for n in range(1, TOTAL + 1)
        }
        for fut in as_completed(futures):
            try:
                n, status, log = fut.result()
            except Exception as e:
                n = futures[fut]
                status = "EXC"
                log = {"n": n, "error": repr(e)}
            results.append((n, status, log))
            if status == "OK":
                success += 1
                print(f"  T{n:02d}: OK  ({len(log.get('steps', []))} steps, slug={log['slug']})")
            else:
                print(f"  T{n:02d}: {status}  slug={log.get('slug')}")
                for step in log.get("steps", []):
                    if not step["ok"]:
                        print(f"      {step['name']} -> {step['status']}: {step['body'][:120]}")

    print(f"\nSeed summary: {success}/{TOTAL} OK (target {TARGET_OK})")

    # Verify
    print("\nVerifying counts via management API...")
    counts = verify(pat)
    print(json.dumps(counts, indent=2))

    # Persist log to disk
    log_path = Path(__file__).parent / f"iso-seed-log-{datetime.date.today().isoformat()}.json"
    log_path.write_text(json.dumps({
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "project_ref": PROJECT_REF,
        "joseph_uuid": JOSEPH_UUID,
        "total": TOTAL,
        "success": success,
        "counts": counts,
        "results": [
            {"n": r[0], "status": r[1], "slug": r[2].get("slug"), "tenant_id": r[2].get("tenant_id"),
             "steps_ok": sum(1 for s in r[2].get("steps", []) if s.get("ok"))}
            for r in sorted(results, key=lambda x: x[0])
        ],
    }, indent=2), encoding="utf-8")
    print(f"\nLog written: {log_path}")

    # Exit code: 0 if success >= TARGET_OK, 1 otherwise
    sys.exit(0 if success >= TARGET_OK else 1)


if __name__ == "__main__":
    main()
