
CREATE OR REPLACE FUNCTION public.kb_build_body(_scope text, _slug text, _title text, _cat_slug text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  img text;
  topic text;
  scope_label text;
  body text;
BEGIN
  -- Map category slug to a hero image filename
  img := CASE
    WHEN _cat_slug IN ('workspace-getting-started','workspace-overview') THEN 'hero-workspace.jpg'
    WHEN _cat_slug IN ('workspace-dashboard','workspace-reports','tenant-reporting') THEN 'hero-reports.jpg'
    WHEN _cat_slug IN ('workspace-ingestion-hub','workspace-file-uploads','workspace-file-watchers','workspace-data-prep','workspace-reference-data','workspace-data-lineage') THEN 'hero-data.jpg'
    WHEN _cat_slug IN ('workspace-connections','tenant-channels','tenant-connectors','tenant-api-migration-chat','plat-github-sync') THEN 'hero-integrations.jpg'
    WHEN _cat_slug IN ('workspace-aidp','workspace-agent','tenant-ai-governance','tenant-ai-llm','tenant-ai-usage','plat-ai-gov','plat-llm') THEN 'hero-ai.jpg'
    WHEN _cat_slug IN ('workspace-rekon-studio','workspace-rekon-orchestrator','workspace-run-history','workspace-template-gallery','workspace-collateral-csa') THEN 'hero-rekon.jpg'
    WHEN _cat_slug IN ('workspace-exceptions','workspace-break-manager','workspace-proposed-matches','workspace-ageing') THEN 'hero-exceptions.jpg'
    WHEN _cat_slug IN ('workspace-regulatory-packs','workspace-manual-match-approvals','workspace-eod-sign-off','tenant-governance','plat-entitlements','plat-promotion') THEN 'hero-governance.jpg'
    WHEN _cat_slug IN ('workspace-audit','tenant-sso','tenant-scim','plat-rbac','plat-audit','plat-break-glass','plat-secrets') THEN 'hero-security.jpg'
    WHEN _cat_slug IN ('workspace-tickets','workspace-knowledge','tenant-tickets-knowledge','plat-kb-esc') THEN 'hero-support.jpg'
    WHEN _cat_slug IN ('tenant-settings','tenant-members','tenant-groups','tenant-business-units','tenant-features') THEN 'hero-tenant.jpg'
    WHEN _cat_slug IN ('plat-tenants','plat-families','plat-status-page') THEN 'hero-platform.jpg'
    ELSE 'hero-workspace.jpg'
  END;

  topic := initcap(replace(regexp_replace(coalesce(_cat_slug,''),'^(workspace|tenant|plat)-',''),'-',' '));

  scope_label := CASE
    WHEN _cat_slug LIKE 'plat-%' THEN 'Platform Administration'
    WHEN _cat_slug LIKE 'tenant-%' THEN 'Tenant Administration'
    ELSE 'Workspace'
  END;

  body := format($md$![%1$s](/kb/%2$s)

> **%1$s** — how it works in FVI, when to use it, and the exact steps to get value from it.

**Scope:** %3$s  ·  **Area:** %4$s  ·  **Estimated read:** 4 min

---

## Why this matters

**%1$s** is part of FVI's %3$s surface. Reconciliation teams use it to %5$s with full audit, RBAC, and 4-eyes safeguards. Mastering this screen shortens cycle time, reduces operational risk, and gives your auditors a clean evidentiary trail.

## Who this is for

- **Operators** running daily reconciliations and managing breaks.
- **Team leads** monitoring SLAs and approving exceptions.
- **Admins** configuring controls, integrations and governance.

## Prerequisites

- An active FVI account with access to this %6$s area.
- The relevant role: **Member** to view, **Approver** for 4-eyes actions, **Admin** for configuration.
- Any upstream data (sources, reference tables, mappings) already provisioned.

## Step-by-step

1. **Locate the feature.** Navigate to the **%4$s** area in the left rail and open **%1$s**.
2. **Review prerequisites.** Confirm you have the required role and that any upstream data is in place.
3. **Configure inputs.** Fill the form — required fields are marked with a red dot. Hover the (?) icon for inline help.
4. **Preview before commit.** Use the **Preview** button (where available) to validate against a sample before saving.
5. **Save and run.** Click **Save** — the change is versioned. For runnable features click **Run** to execute on demand.
6. **Verify outcomes.** Check the **Activity** or **Run History** panel for status, duration and produced artefacts.
7. **Audit trail.** Every change is recorded in `audit_log` with actor, before/after and hash-chained for tamper evidence.

## Screenshots & where to click

The hero image at the top of this article shows the typical layout for this screen:

- The **left rail** is your navigation between areas.
- The **top bar** carries scope switcher, Copilot, Themes, Tour and your profile.
- The **main canvas** holds the work area for %1$s.

## Tips & best practice

- Use **⌘K / Ctrl+K** to jump to this screen from anywhere.
- Tag your work — labels improve search and reporting later.
- For repeated tasks, schedule via **Rekon Orchestrator** instead of running manually.
- Enable **Copilot** (top-right) and ask "How do I use %1$s?" for an interactive walkthrough.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Button is greyed out | You lack the required role | Ask your tenant admin for the appropriate role |
| No data shown | Filters too narrow or data not yet ingested | Clear filters; check **Ingestion Hub → Run history** |
| Save fails with 403 | RLS blocked the write (wrong tenant or BU) | Confirm your Business Unit scope covers the record |
| Run errors | Mapping or rule mismatch | Open **Run history → run logs**; the line item shows the failing rule |

## Audit & compliance

Every change touching this screen writes a row into `audit_log` with `actor_user_id`, `before` and `after` payloads, and a `row_hash` chained to the previous row. Daily SHA-256 anchors in `audit_anchors` provide tamper-evidence suitable for SOC 2 and ISO 27001 evidence packs.

## Related articles

- **Workspace · Getting Started** — orient yourself in FVI
- **Workspace · Rekon Studio** — build reconciliations
- **Tenant · Governance** — controls and approvals
- **Platform · Audit** — chain verification

---

_Need help?_ Open **Support → New Ticket** from the top bar — your ticket routes to your tenant admins first, then escalates to platform support if needed.
$md$,
    _title,
    img,
    scope_label,
    coalesce(nullif(topic,''),'FVI'),
    CASE WHEN scope_label = 'Workspace' THEN 'execute day-to-day reconciliation work' ELSE 'govern and oversee tenant operations' END,
    lower(scope_label)
  );

  RETURN body;
END
$$;

-- Backfill every article with rich body + cover image + summary
UPDATE public.kb_articles a
SET body_md = public.kb_build_body(a.scope::text, a.slug, a.title, c.slug),
    cover_image_url = COALESCE(c.cover_image_url, '/kb/hero-workspace.jpg'),
    summary = a.title || ' — step-by-step in the FVI Navigator Hub.',
    read_time_min = 4
FROM public.kb_categories c
WHERE a.category_id = c.id;

-- Catch articles without a category
UPDATE public.kb_articles a
SET body_md = public.kb_build_body(a.scope::text, a.slug, a.title, NULL),
    cover_image_url = COALESCE(cover_image_url, '/kb/hero-workspace.jpg'),
    summary = COALESCE(summary, a.title || ' — step-by-step in the FVI Navigator Hub.'),
    read_time_min = 4
WHERE a.category_id IS NULL;

-- Lock down the helper
REVOKE EXECUTE ON FUNCTION public.kb_build_body(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_build_body(text, text, text, text) TO service_role;
