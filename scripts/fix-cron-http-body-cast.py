#!/usr/bin/env python3
"""
Fix pg_cron jobs that use `body := '{}'::text` which doesn't match the
net.http_post() signature (needs jsonb). Compare with `secret-rotation-executor`
which succeeds using `body := '{}'::jsonb`.

LL-082: pg_cron net.http_post() requires `body` cast as jsonb, not text.

This script:
1. Reads each broken job's URL + headers from cron.job
2. Cancels them via cron.unschedule(jobid)
3. Re-registers them with the corrected body cast via cron.schedule(jobname, schedule, command)

Idempotent: running it twice is a no-op on the second run (the broken signature
won't match, so the second pass will be a no-op SELECT).
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

SECRETS = Path.home() / ".fvi-secrets"
PAT_FILE = SECRETS / "SUPABASE_PAT"
PROJECTS = {
    "PROD": "YOUR_PROJECT_REF",
    "DEV":  "YOUR_PROJECT_REF",
}
BROKEN_JOBS = ["doc-refresh", "audit-anchor", "backup-verify", "email-digest", "anomaly-detection"]


def query(project: str, sql: str, pat: str) -> list[dict]:
    url = f"https://api.supabase.com/v1/projects/{project}/database/query"
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"},
    )
    # URL is built from the closed PROJECTS mapping and fixed Supabase HTTPS origin.
    with urllib.request.urlopen(req, timeout=20) as r:  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        return json.loads(r.read())


def main() -> int:
    pat = PAT_FILE.read_text().strip()
    summary = []
    for label, project in PROJECTS.items():
        rows = query(project, f"""
            SELECT jobid, jobname, schedule
            FROM cron.job
            WHERE jobname IN ({",".join(f"'{n}'" for n in BROKEN_JOBS)})
            ORDER BY jobname
        """, pat)
        if not rows:
            print(f"[{label}] no broken jobs found")
            continue
        for row in rows:
            jid, name, sched = row["jobid"], row["jobname"], row["schedule"]
            # Fetch the original headers to preserve x-cron-secret
            cmds = query(project, f"""
                SELECT command FROM cron.job WHERE jobid = {jid}
            """, pat)
            cmd_text = cmds[0]["command"] if cmds else ""
            # Surgically fix the body cast: '...body := '...'::text,' -> '...body := '...'::jsonb,'
            if "::text" in cmd_text:
                new_cmd = cmd_text.replace("::text", "::jsonb")
            else:
                print(f"[{label}] {name}: no ::text cast in command, skipping")
                continue
            print(f"[{label}] {name} (jobid={jid}, schedule='{sched}')")
            print(f"  old: {cmd_text[:200]}")
            print(f"  new: {new_cmd[:200]}")
            # Unschedule the old job then schedule the new one
            try:
                query(project, f"SELECT cron.unschedule({jid})", pat)
            except Exception as e:
                print(f"  unschedule failed (continuing): {e}")
            # Schedule the new job — wrap the new_cmd in a $$ ... $$ dollar-quoted literal
            # The command string from cron.job is already valid SQL so we can just
            # SELECT cron.schedule(name, schedule, <the sql command>) but since the
            # command already has its own SELECT, we can re-use the dollar quoting by
            # re-wrapping it.
            # Strategy: cron.schedule takes a string; the existing command is a single
            # SELECT statement. We can pass it directly as $$ ... $$.
            sql = f"SELECT cron.schedule('{name}', '{sched}', $cmd${new_cmd}$cmd$)"
            result = query(project, sql, pat)
            print(f"  scheduled new jobid: {result}")
            summary.append((label, name, jid, sched, result))
    print()
    print("SUMMARY:")
    for s in summary:
        print(f"  {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
