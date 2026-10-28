CREATE OR REPLACE FUNCTION public.seed_kb_article(
  p_cat_slug text, p_title text, p_tags text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat_id uuid; v_cat_name text; v_scope_label text; v_slug text; v_body text; v_id uuid;
BEGIN
  SELECT id, name INTO v_cat_id, v_cat_name FROM public.kb_categories
  WHERE scope='platform' AND tenant_id IS NULL AND slug = p_cat_slug;
  IF v_cat_id IS NULL THEN RAISE EXCEPTION 'Unknown category %', p_cat_slug; END IF;
  v_scope_label := CASE
    WHEN p_cat_slug IN ('control-tower','ai-governance','tenant-management') THEN 'Tenant'
    WHEN p_cat_slug IN ('admin','security-compliance') THEN 'Platform'
    ELSE 'Workspace' END;
  v_slug := lower(regexp_replace(p_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  v_slug := substr(v_slug, 1, 60) || '-fvi-kb';
  v_body :=
    '# ' || p_title || E'\n' ||
    '> **Category:** ' || regexp_replace(v_cat_name, '^[^ ]+ ', '') ||
    '  ·  **Scope:** ' || v_scope_label ||
    '  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min' || E'\n\n' ||
    '## Overview' || E'\n' ||
    'This article explains **' || p_title || '** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.' || E'\n\n' ||
    '## When to use this' || E'\n' ||
    '- You are working inside the **' || v_scope_label || '** scope and need to action a task related to ' || lower(regexp_replace(v_cat_name, '^[^ ]+ ', '')) || '.' || E'\n' ||
    '- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).' || E'\n' ||
    '- You want a single source of truth for **' || p_title || '** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.' || E'\n\n' ||
    '## Prerequisites' || E'\n' ||
    '- You are signed into FVI with MFA enabled.' || E'\n' ||
    '- Your role grants access to **' || regexp_replace(v_cat_name, '^[^ ]+ ', '') || '** in the current tenant.' || E'\n' ||
    '- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.' || E'\n\n' ||
    '## Step-by-step' || E'\n' ||
    '1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.' || E'\n' ||
    '2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.' || E'\n' ||
    '3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.' || E'\n' ||
    '4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.' || E'\n' ||
    '5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.' || E'\n' ||
    '6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.' || E'\n\n' ||
    '## Security & governance' || E'\n' ||
    '- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.' || E'\n' ||
    '- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.' || E'\n' ||
    '- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.' || E'\n' ||
    '- 4-eyes approval applies to promotion between Dev / Test / Prod.' || E'\n\n' ||
    '## Tips & shortcuts' || E'\n' ||
    '- Use `⌘K` to jump straight to any object by name.' || E'\n' ||
    '- Hover any KPI card on the dashboard for the underlying SQL definition.' || E'\n' ||
    '- Pin frequent searches with the ★ icon to make them appear in your sidebar.' || E'\n\n' ||
    '## Troubleshooting' || E'\n' ||
    '- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.' || E'\n' ||
    '- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.' || E'\n' ||
    '- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.' || E'\n\n' ||
    '## Related articles' || E'\n' ||
    '- *Understanding the Three Scopes: Workspace, Tenant, Platform*' || E'\n' ||
    '- *Audit Trail of Promotions*' || E'\n' ||
    '- *Security Architecture Overview*' || E'\n\n' ||
    '_Tags: ' || array_to_string(ARRAY(SELECT '#' || t FROM unnest(p_tags) t), ' · ') || '_';
  DELETE FROM public.kb_articles WHERE scope='platform' AND tenant_id IS NULL AND slug = v_slug;
  INSERT INTO public.kb_articles(scope, tenant_id, category_id, slug, title, body_md, status, views)
  VALUES ('platform', NULL, v_cat_id, v_slug, p_title, v_body, 'published', 0) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.seed_kb_article(text, text, text[]) FROM PUBLIC;