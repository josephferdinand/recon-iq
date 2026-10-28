#!/usr/bin/env python3
"""LL-082 fix: pg_cron net.http_post() requires `body` cast as jsonb, not text.

Runs cron.unschedule(jobid) + cron.schedule(jobname, schedule, new_cmd) for each
broken job. The fix is a string replace of `::text` -> `::jsonb` in the stored
command. The URL and headers are preserved exactly as-is (the x-cron-secret
matches SLA_CRON_HMAC on the Pages projects).
"""
import json
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
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{project}/database/query",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"},
    )
    # URL is built from the closed PROJECTS mapping and fixed Supabase HTTPS origin.
    with urllib.request.urlopen(req, timeout=20) as r:  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        return json.loads(r.read())


def main(target: str) -> int:
    pat = PAT_FILE.read_text().strip()
    target_norm = target.upper()
    if target_norm == "ALL":
        projects = list(PROJECTS.items())
    elif target_norm in PROJECTS:
        projects = [(target_norm, PROJECTS[target_norm])]
    else:
        print(f"unknown target {target}; use prod, dev, or all")
        return 2

    summary = []
    for label, project in projects:
        rows = query(project, f"""
            SELECT jobid, jobname, schedule, command
            FROM cron.job
            WHERE jobname IN ({",".join(f"'{n}'" for n in BROKEN_JOBS)})
            ORDER BY jobname
        """, pat)
        print(f"\n[{label}] {project}: {len(rows)} broken jobs to fix")
        for row in rows:
            jid, name, sched, cmd = row["jobid"], row["jobname"], row["schedule"], row["command"]
            if "::text" not in cmd:
                print(f"  [{name}] no ::text cast — already fixed or different format, skipping")
                continue
            new_cmd = cmd.replace("::text", "::jsonb")
            # Unschedule then reschedule with fixed command.
            query(project, f"SELECT cron.unschedule({jid})", pat)
            # Use $fvi$ ... $fvi$ dollar quoting to safely embed the multi-line command.
            sql = f"SELECT cron.schedule('{name}', '{sched}', $fvi${new_cmd}$fvi$)"
            res = query(project, sql, pat)
            print(f"  [{name}] unscheduled old jobid={jid}, new jobid={res[0].get('schedule')}")
            summary.append((label, name, jid, res[0].get("schedule")))
    print("\n=== SUMMARY ===")
    for s in summary:
        print(f"  {s}")
    return 0


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "all"
    sys.exit(main(target))
