-- KB seed: categories + articles for FVI Navigator Hub
-- Idempotent: deletes platform-scoped seeded categories then re-inserts.
BEGIN;

DELETE FROM public.kb_articles WHERE scope='platform' AND tenant_id IS NULL AND slug LIKE '%-fvi-kb';
DELETE FROM public.kb_categories WHERE scope='platform' AND tenant_id IS NULL AND slug IN ('getting-started','dashboard','rekon-studio','squawk-desk','data-refinery','skydoc-ai','cargo-bay','environments','llm-config','reports','control-tower','ai-governance','admin','tenant-management','ai-copilot','security-compliance');

INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'getting-started','🚀 Getting Started',0);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'dashboard','📊 Dashboard',1);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'rekon-studio','🛠️ Rekon Studio',2);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'squawk-desk','🚨 Squawk Desk',3);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'data-refinery','🧪 Data Refinery',4);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'skydoc-ai','🤖 SkyDoc AI',5);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'cargo-bay','📦 Cargo Bay',6);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'environments','🌐 Environments',7);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'llm-config','🧠 LLM Config',8);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'reports','📈 Reports',9);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'control-tower','🗼 Control Tower',10);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'ai-governance','🛡️ AI Governance',11);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'admin','⚙️ Admin',12);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'tenant-management','🏢 Tenant Management',13);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'ai-copilot','✨ AI Copilot',14);
INSERT INTO public.kb_categories(scope,tenant_id,slug,name,position) VALUES ('platform',NULL,'security-compliance','🔐 Security & Compliance',15);

INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'welcome-to-falcon-veritas-intelligence-fvi-kb','Welcome to Recon Spark','# Welcome to Recon Spark
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Welcome to Recon Spark** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Welcome to Recon Spark** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #intro · #fvi_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'your-first-15-minutes-in-fvi-fvi-kb','Your First 15 Minutes in FVI','# Your First 15 Minutes in FVI
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Your First 15 Minutes in FVI** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Your First 15 Minutes in FVI** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #onboarding · #quickstart_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'understanding-the-three-scopes-workspace-tenant-platform-fvi-kb','Understanding the Three Scopes: Workspace, Tenant, Platform','# Understanding the Three Scopes: Workspace, Tenant, Platform
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Understanding the Three Scopes: Workspace, Tenant, Platform** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Understanding the Three Scopes: Workspace, Tenant, Platform** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #scope · #architecture_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'navigating-the-left-rail-fvi-kb','Navigating the Left Rail','# Navigating the Left Rail
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Navigating the Left Rail** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Navigating the Left Rail** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #navigation · #ui_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'switching-environments-dev-test-prod-fvi-kb','Switching Environments (Dev / Test / Prod)','# Switching Environments (Dev / Test / Prod)
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Switching Environments (Dev / Test / Prod)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Switching Environments (Dev / Test / Prod)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'using-the-command-palette-k-fvi-kb','Using the Command Palette (⌘K)','# Using the Command Palette (⌘K)
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Using the Command Palette (⌘K)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Using the Command Palette (⌘K)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #palette · #productivity_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'notifications-center-overview-fvi-kb','Notifications Center Overview','# Notifications Center Overview
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Notifications Center Overview** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Notifications Center Overview** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #notifications_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'theme-personalization-fvi-kb','Theme & Personalization','# Theme & Personalization
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Theme & Personalization** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Theme & Personalization** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #themes · #ui_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'idle-session-auto-logout-fvi-kb','Idle Session & Auto-Logout','# Idle Session & Auto-Logout
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Idle Session & Auto-Logout** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Idle Session & Auto-Logout** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #session · #security_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'enabling-two-factor-authentication-totp-fvi-kb','Enabling Two-Factor Authentication (TOTP)','# Enabling Two-Factor Authentication (TOTP)
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Enabling Two-Factor Authentication (TOTP)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Enabling Two-Factor Authentication (TOTP)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #mfa · #security_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'joining-a-tenant-via-invitation-fvi-kb','Joining a Tenant via Invitation','# Joining a Tenant via Invitation
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Joining a Tenant via Invitation** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Joining a Tenant via Invitation** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #invite_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'updating-your-profile-fvi-kb','Updating Your Profile','# Updating Your Profile
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Updating Your Profile** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Updating Your Profile** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #profile_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'help-support-where-to-get-answers-fvi-kb','Help & Support: Where to Get Answers','# Help & Support: Where to Get Answers
> **Category:** Getting Started  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Help & Support: Where to Get Answers** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to getting started.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Help & Support: Where to Get Answers** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Getting Started** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #help_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='getting-started';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'dashboard-tour-kpis-at-a-glance-fvi-kb','Dashboard Tour: KPIs at a Glance','# Dashboard Tour: KPIs at a Glance
> **Category:** Dashboard  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Dashboard Tour: KPIs at a Glance** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to dashboard.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Dashboard Tour: KPIs at a Glance** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Dashboard** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #dashboard · #kpi_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='dashboard';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'reading-the-match-rate-trend-card-fvi-kb','Reading the Match-Rate Trend Card','# Reading the Match-Rate Trend Card
> **Category:** Dashboard  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Reading the Match-Rate Trend Card** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to dashboard.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Reading the Match-Rate Trend Card** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Dashboard** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #dashboard · #match-rate_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='dashboard';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'severity-distribution-donut-explained-fvi-kb','Severity Distribution Donut Explained','# Severity Distribution Donut Explained
> **Category:** Dashboard  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Severity Distribution Donut Explained** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to dashboard.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Severity Distribution Donut Explained** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Dashboard** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #dashboard · #severity_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='dashboard';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'customising-dashboard-widgets-fvi-kb','Customising Dashboard Widgets','# Customising Dashboard Widgets
> **Category:** Dashboard  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Customising Dashboard Widgets** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to dashboard.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Customising Dashboard Widgets** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Dashboard** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #dashboard · #widgets_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='dashboard';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'exporting-dashboard-snapshots-fvi-kb','Exporting Dashboard Snapshots','# Exporting Dashboard Snapshots
> **Category:** Dashboard  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Exporting Dashboard Snapshots** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to dashboard.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Exporting Dashboard Snapshots** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Dashboard** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #dashboard · #export_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='dashboard';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'drilling-from-dashboard-into-breaks-fvi-kb','Drilling From Dashboard Into Breaks','# Drilling From Dashboard Into Breaks
> **Category:** Dashboard  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Drilling From Dashboard Into Breaks** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to dashboard.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Drilling From Dashboard Into Breaks** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Dashboard** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #dashboard · #drilldown_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='dashboard';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'time-range-selector-comparisons-fvi-kb','Time-Range Selector & Comparisons','# Time-Range Selector & Comparisons
> **Category:** Dashboard  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Time-Range Selector & Comparisons** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to dashboard.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Time-Range Selector & Comparisons** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Dashboard** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #dashboard · #time-range_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='dashboard';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'dashboard-performance-tips-fvi-kb','Dashboard Performance Tips','# Dashboard Performance Tips
> **Category:** Dashboard  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Dashboard Performance Tips** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to dashboard.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Dashboard Performance Tips** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Dashboard** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #dashboard · #performance_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='dashboard';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'what-is-rekon-studio-fvi-kb','What is Rekon Studio?','# What is Rekon Studio?
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **What is Rekon Studio?** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **What is Rekon Studio?** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #intro_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'choosing-one-two-or-three-sided-mode-fvi-kb','Choosing One-, Two-, or Three-Sided Mode','# Choosing One-, Two-, or Three-Sided Mode
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Choosing One-, Two-, or Three-Sided Mode** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Choosing One-, Two-, or Three-Sided Mode** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #mode_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'wizard-walkthrough-step-by-step-fvi-kb','Wizard Walkthrough Step-by-Step','# Wizard Walkthrough Step-by-Step
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Wizard Walkthrough Step-by-Step** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Wizard Walkthrough Step-by-Step** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #wizard_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connector-type-file-upload-fvi-kb','Connector Type: File Upload','# Connector Type: File Upload
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connector Type: File Upload** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connector Type: File Upload** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #file_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connector-type-paste-data-fvi-kb','Connector Type: Paste Data','# Connector Type: Paste Data
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connector Type: Paste Data** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connector Type: Paste Data** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #paste_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connector-type-rest-api-fvi-kb','Connector Type: REST API','# Connector Type: REST API
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connector Type: REST API** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connector Type: REST API** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #api_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connector-type-database-postgres-mysql-sql-server-fvi-kb','Connector Type: Database (Postgres/MySQL/SQL Server)','# Connector Type: Database (Postgres/MySQL/SQL Server)
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connector Type: Database (Postgres/MySQL/SQL Server)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connector Type: Database (Postgres/MySQL/SQL Server)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #database_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connector-type-existing-source-fvi-kb','Connector Type: Existing Source','# Connector Type: Existing Source
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connector Type: Existing Source** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connector Type: Existing Source** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #existing_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connector-type-refined-dataset-fvi-kb','Connector Type: Refined Dataset','# Connector Type: Refined Dataset
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connector Type: Refined Dataset** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connector Type: Refined Dataset** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #pipeline_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connector-type-pdf-via-skydoc-ai-fvi-kb','Connector Type: PDF via SkyDoc AI','# Connector Type: PDF via SkyDoc AI
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connector Type: PDF via SkyDoc AI** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connector Type: PDF via SkyDoc AI** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #pdf_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'auto-detect-column-mapping-fvi-kb','Auto-Detect Column Mapping','# Auto-Detect Column Mapping
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Auto-Detect Column Mapping** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Auto-Detect Column Mapping** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #auto-detect_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'manually-configuring-mappings-fvi-kb','Manually Configuring Mappings','# Manually Configuring Mappings
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Manually Configuring Mappings** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Manually Configuring Mappings** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #manual-mapping_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'describe-in-english-mapping-nl-fvi-kb','Describe-in-English Mapping (NL)','# Describe-in-English Mapping (NL)
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Describe-in-English Mapping (NL)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Describe-in-English Mapping (NL)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #nlp · #ai_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'mapping-preview-panel-fvi-kb','Mapping Preview Panel','# Mapping Preview Panel
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Mapping Preview Panel** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Mapping Preview Panel** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #preview_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'test-connection-button-fvi-kb','Test Connection Button','# Test Connection Button
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Test Connection Button** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Test Connection Button** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #test_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'saving-a-reconciliation-definition-fvi-kb','Saving a Reconciliation Definition','# Saving a Reconciliation Definition
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Saving a Reconciliation Definition** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Saving a Reconciliation Definition** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #save_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'definition-version-history-comparison-fvi-kb','Definition Version History & Comparison','# Definition Version History & Comparison
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Definition Version History & Comparison** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Definition Version History & Comparison** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #versions_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'editing-a-saved-reconciliation-fvi-kb','Editing a Saved Reconciliation','# Editing a Saved Reconciliation
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Editing a Saved Reconciliation** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Editing a Saved Reconciliation** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #edit_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'cloning-a-reconciliation-fvi-kb','Cloning a Reconciliation','# Cloning a Reconciliation
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Cloning a Reconciliation** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Cloning a Reconciliation** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #clone_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'deleting-a-reconciliation-safely-fvi-kb','Deleting a Reconciliation (Safely)','# Deleting a Reconciliation (Safely)
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Deleting a Reconciliation (Safely)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Deleting a Reconciliation (Safely)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #delete_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'scheduling-a-recon-run-fvi-kb','Scheduling a Recon Run','# Scheduling a Recon Run
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Scheduling a Recon Run** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Scheduling a Recon Run** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #schedule_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'reading-the-run-history-fvi-kb','Reading the Run History','# Reading the Run History
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Reading the Run History** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Reading the Run History** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #rekon-studio · #runs_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'benchmark-comparison-measuring-against-industry-standards-fvi-kb','Benchmark Comparison: Measuring Against Industry Standards','# Benchmark Comparison: Measuring Against Industry Standards
> **Category:** Rekon Studio  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Benchmark Comparison: Measuring Against Industry Standards** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to rekon studio.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Benchmark Comparison: Measuring Against Industry Standards** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Rekon Studio** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #benchmark · #comparison_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='rekon-studio';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'what-is-the-squawk-desk-fvi-kb','What is the Squawk Desk?','# What is the Squawk Desk?
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **What is the Squawk Desk?** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **What is the Squawk Desk?** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #intro_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'break-list-view-filters-search-fvi-kb','Break List View: Filters & Search','# Break List View: Filters & Search
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Break List View: Filters & Search** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Break List View: Filters & Search** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #filters_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'break-inspector-side-by-side-view-fvi-kb','Break Inspector: Side-by-Side View','# Break Inspector: Side-by-Side View
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Break Inspector: Side-by-Side View** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Break Inspector: Side-by-Side View** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #inspector_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'assigning-breaks-to-investigators-fvi-kb','Assigning Breaks to Investigators','# Assigning Breaks to Investigators
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Assigning Breaks to Investigators** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Assigning Breaks to Investigators** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #assign_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'setting-break-priority-slas-fvi-kb','Setting Break Priority & SLAs','# Setting Break Priority & SLAs
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Setting Break Priority & SLAs** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Setting Break Priority & SLAs** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #sla_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'lifecycle-states-open-in-review-resolved-fvi-kb','Lifecycle States: Open → In-Review → Resolved','# Lifecycle States: Open → In-Review → Resolved
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Lifecycle States: Open → In-Review → Resolved** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Lifecycle States: Open → In-Review → Resolved** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #lifecycle_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'bulk-actions-on-breaks-fvi-kb','Bulk Actions on Breaks','# Bulk Actions on Breaks
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Bulk Actions on Breaks** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Bulk Actions on Breaks** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #bulk_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'adding-notes-attachments-to-a-break-fvi-kb','Adding Notes & Attachments to a Break','# Adding Notes & Attachments to a Break
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Adding Notes & Attachments to a Break** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Adding Notes & Attachments to a Break** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #notes_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'root-cause-tagging-fvi-kb','Root-Cause Tagging','# Root-Cause Tagging
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Root-Cause Tagging** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Root-Cause Tagging** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #root-cause_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'kanban-style-break-manager-fvi-kb','Kanban-Style Break Manager','# Kanban-Style Break Manager
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Kanban-Style Break Manager** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Kanban-Style Break Manager** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #kanban_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'exporting-breaks-csv-json-xlsx-fvi-kb','Exporting Breaks (CSV / JSON / XLSX)','# Exporting Breaks (CSV / JSON / XLSX)
> **Category:** Squawk Desk  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Exporting Breaks (CSV / JSON / XLSX)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to squawk desk.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Exporting Breaks (CSV / JSON / XLSX)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Squawk Desk** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #squawk-desk · #export_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='squawk-desk';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'data-refinery-overview-fvi-kb','Data Refinery Overview','# Data Refinery Overview
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Data Refinery Overview** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Data Refinery Overview** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #intro_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'creating-a-pipeline-fvi-kb','Creating a Pipeline','# Creating a Pipeline
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Creating a Pipeline** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Creating a Pipeline** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #pipeline_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'calculated-columns-deriving-new-fields-fvi-kb','Calculated Columns: Deriving New Fields','# Calculated Columns: Deriving New Fields
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Calculated Columns: Deriving New Fields** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Calculated Columns: Deriving New Fields** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #calculated-columns · #formulas_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'string-transformations-catalog-fvi-kb','String Transformations Catalog','# String Transformations Catalog
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **String Transformations Catalog** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **String Transformations Catalog** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #strings_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'numeric-date-transformations-fvi-kb','Numeric & Date Transformations','# Numeric & Date Transformations
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Numeric & Date Transformations** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Numeric & Date Transformations** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #numeric_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'lookup-joins-in-a-pipeline-fvi-kb','Lookup & Joins in a Pipeline','# Lookup & Joins in a Pipeline
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Lookup & Joins in a Pipeline** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Lookup & Joins in a Pipeline** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #lookup_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'filtering-rows-fvi-kb','Filtering Rows','# Filtering Rows
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Filtering Rows** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Filtering Rows** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #filter_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'data-quality-rules-fvi-kb','Data Quality Rules','# Data Quality Rules
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Data Quality Rules** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Data Quality Rules** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #dq_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'pipeline-run-history-fvi-kb','Pipeline Run History','# Pipeline Run History
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Pipeline Run History** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Pipeline Run History** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #runs_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'versioning-a-pipeline-fvi-kb','Versioning a Pipeline','# Versioning a Pipeline
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Versioning a Pipeline** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Versioning a Pipeline** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #versions_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'publishing-a-refined-dataset-fvi-kb','Publishing a Refined Dataset','# Publishing a Refined Dataset
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Publishing a Refined Dataset** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Publishing a Refined Dataset** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #publish_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'using-a-refined-dataset-in-rekon-studio-fvi-kb','Using a Refined Dataset in Rekon Studio','# Using a Refined Dataset in Rekon Studio
> **Category:** Data Refinery  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Using a Refined Dataset in Rekon Studio** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to data refinery.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Using a Refined Dataset in Rekon Studio** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Data Refinery** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #data-refinery · #integration_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='data-refinery';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'skydoc-ai-overview-aidp-fvi-kb','SkyDoc AI Overview (AIDP)','# SkyDoc AI Overview (AIDP)
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **SkyDoc AI Overview (AIDP)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **SkyDoc AI Overview (AIDP)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #aidp_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'uploading-a-pdf-for-extraction-fvi-kb','Uploading a PDF for Extraction','# Uploading a PDF for Extraction
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Uploading a PDF for Extraction** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Uploading a PDF for Extraction** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #upload_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'defining-an-extraction-schema-fvi-kb','Defining an Extraction Schema','# Defining an Extraction Schema
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Defining an Extraction Schema** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Defining an Extraction Schema** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #schema_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'reviewing-extracted-fields-fvi-kb','Reviewing Extracted Fields','# Reviewing Extracted Fields
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Reviewing Extracted Fields** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Reviewing Extracted Fields** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #review_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'validating-with-confidence-scores-fvi-kb','Validating with Confidence Scores','# Validating with Confidence Scores
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Validating with Confidence Scores** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Validating with Confidence Scores** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #confidence_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'exporting-extracted-data-fvi-kb','Exporting Extracted Data','# Exporting Extracted Data
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Exporting Extracted Data** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Exporting Extracted Data** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #export_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'routing-extracted-data-into-pipelines-fvi-kb','Routing Extracted Data Into Pipelines','# Routing Extracted Data Into Pipelines
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Routing Extracted Data Into Pipelines** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Routing Extracted Data Into Pipelines** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #routing_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'handling-multi-page-documents-fvi-kb','Handling Multi-Page Documents','# Handling Multi-Page Documents
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Handling Multi-Page Documents** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Handling Multi-Page Documents** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #multipage_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'tables-in-pdfs-best-practices-fvi-kb','Tables in PDFs: Best Practices','# Tables in PDFs: Best Practices
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Tables in PDFs: Best Practices** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Tables in PDFs: Best Practices** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #tables_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'troubleshooting-low-confidence-extractions-fvi-kb','Troubleshooting Low-Confidence Extractions','# Troubleshooting Low-Confidence Extractions
> **Category:** SkyDoc AI  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Troubleshooting Low-Confidence Extractions** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to skydoc ai.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Troubleshooting Low-Confidence Extractions** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **SkyDoc AI** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #skydoc · #troubleshooting_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='skydoc-ai';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'cargo-bay-data-ingestion-hub-fvi-kb','Cargo Bay: Data Ingestion Hub','# Cargo Bay: Data Ingestion Hub
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Cargo Bay: Data Ingestion Hub** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Cargo Bay: Data Ingestion Hub** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #cargo-bay · #intro_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-an-sftp-source-fvi-kb','Connecting an SFTP Source','# Connecting an SFTP Source
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting an SFTP Source** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting an SFTP Source** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #sftp · #connection_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-an-s3-bucket-fvi-kb','Connecting an S3 Bucket','# Connecting an S3 Bucket
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting an S3 Bucket** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting an S3 Bucket** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #s3 · #connection_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-azure-blob-storage-fvi-kb','Connecting Azure Blob Storage','# Connecting Azure Blob Storage
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting Azure Blob Storage** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting Azure Blob Storage** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #azure · #connection_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-google-cloud-storage-fvi-kb','Connecting Google Cloud Storage','# Connecting Google Cloud Storage
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting Google Cloud Storage** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting Google Cloud Storage** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #gcs · #connection_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-snowflake-fvi-kb','Connecting Snowflake','# Connecting Snowflake
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting Snowflake** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting Snowflake** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #snowflake · #warehouse_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-bigquery-fvi-kb','Connecting BigQuery','# Connecting BigQuery
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting BigQuery** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting BigQuery** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #bigquery · #warehouse_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-databricks-fvi-kb','Connecting Databricks','# Connecting Databricks
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting Databricks** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting Databricks** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #databricks_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-postgres-fvi-kb','Connecting Postgres','# Connecting Postgres
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting Postgres** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting Postgres** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #postgres · #db_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-mysql-fvi-kb','Connecting MySQL','# Connecting MySQL
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting MySQL** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting MySQL** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #mysql · #db_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-sql-server-fvi-kb','Connecting SQL Server','# Connecting SQL Server
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting SQL Server** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting SQL Server** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #sqlserver · #db_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'connecting-a-generic-rest-api-fvi-kb','Connecting a Generic REST API','# Connecting a Generic REST API
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Connecting a Generic REST API** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Connecting a Generic REST API** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #api · #rest_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'webhook-ingestion-fvi-kb','Webhook Ingestion','# Webhook Ingestion
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Webhook Ingestion** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Webhook Ingestion** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #webhook_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'scheduling-connector-pulls-fvi-kb','Scheduling Connector Pulls','# Scheduling Connector Pulls
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Scheduling Connector Pulls** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Scheduling Connector Pulls** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #cargo-bay · #schedule_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'watchers-detecting-new-files-automatically-fvi-kb','Watchers: Detecting New Files Automatically','# Watchers: Detecting New Files Automatically
> **Category:** Cargo Bay  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Watchers: Detecting New Files Automatically** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to cargo bay.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Watchers: Detecting New Files Automatically** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Cargo Bay** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #cargo-bay · #watcher_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='cargo-bay';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'dev-test-prod-topology-fvi-kb','Dev / Test / Prod Topology','# Dev / Test / Prod Topology
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Dev / Test / Prod Topology** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Dev / Test / Prod Topology** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #topology_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'promoting-definitions-between-environments-fvi-kb','Promoting Definitions Between Environments','# Promoting Definitions Between Environments
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Promoting Definitions Between Environments** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Promoting Definitions Between Environments** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #promote_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'4-eyes-approval-on-promotion-fvi-kb','4-Eyes Approval on Promotion','# 4-Eyes Approval on Promotion
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **4-Eyes Approval on Promotion** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **4-Eyes Approval on Promotion** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #approval · #4-eyes_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'snapshots-rollback-fvi-kb','Snapshots & Rollback','# Snapshots & Rollback
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Snapshots & Rollback** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Snapshots & Rollback** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #snapshot_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'environment-banners-safety-rails-fvi-kb','Environment Banners & Safety Rails','# Environment Banners & Safety Rails
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Environment Banners & Safety Rails** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Environment Banners & Safety Rails** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #safety_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'diffing-a-definition-across-environments-fvi-kb','Diffing a Definition Across Environments','# Diffing a Definition Across Environments
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Diffing a Definition Across Environments** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Diffing a Definition Across Environments** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #diff_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'per-environment-secrets-connections-fvi-kb','Per-Environment Secrets & Connections','# Per-Environment Secrets & Connections
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Per-Environment Secrets & Connections** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Per-Environment Secrets & Connections** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #secrets_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'audit-trail-of-promotions-fvi-kb','Audit Trail of Promotions','# Audit Trail of Promotions
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Audit Trail of Promotions** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Audit Trail of Promotions** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #audit_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'restoring-from-a-snapshot-fvi-kb','Restoring From a Snapshot','# Restoring From a Snapshot
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Restoring From a Snapshot** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Restoring From a Snapshot** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #restore_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'best-practices-release-workflow-fvi-kb','Best Practices: Release Workflow','# Best Practices: Release Workflow
> **Category:** Environments  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Best Practices: Release Workflow** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to environments.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Best Practices: Release Workflow** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Environments** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #environments · #best-practice_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='environments';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'llm-config-overview-byo-llm-fvi-kb','LLM Config Overview (BYO-LLM)','# LLM Config Overview (BYO-LLM)
> **Category:** LLM Config  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **LLM Config Overview (BYO-LLM)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to llm config.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **LLM Config Overview (BYO-LLM)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **LLM Config** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #llm-config · #intro_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='llm-config';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'adding-an-anthropic-claude-provider-fvi-kb','Adding an Anthropic Claude Provider','# Adding an Anthropic Claude Provider
> **Category:** LLM Config  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Adding an Anthropic Claude Provider** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to llm config.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Adding an Anthropic Claude Provider** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **LLM Config** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #llm-config · #claude_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='llm-config';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'adding-an-muse-provider-fvi-kb','Adding an Muse Provider','# Adding an Muse Provider
> **Category:** LLM Config  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Adding an Muse Provider** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to llm config.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Adding an Muse Provider** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **LLM Config** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #llm-config · #muse_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='llm-config';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'adding-google-gemini-fvi-kb','Adding Google Gemini','# Adding Google Gemini
> **Category:** LLM Config  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Adding Google Gemini** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to llm config.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Adding Google Gemini** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **LLM Config** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #llm-config · #gemini_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='llm-config';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'adding-mistral-cohere-groq-perplexity-fvi-kb','Adding Mistral, Cohere, Groq, Perplexity','# Adding Mistral, Cohere, Groq, Perplexity
> **Category:** LLM Config  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Adding Mistral, Cohere, Groq, Perplexity** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to llm config.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Adding Mistral, Cohere, Groq, Perplexity** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **LLM Config** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #llm-config · #providers_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='llm-config';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'adding-deepseek-xai-grok-meta-fvi-kb','Adding DeepSeek, xAI Grok, Meta','# Adding DeepSeek, xAI Grok, Meta
> **Category:** LLM Config  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Adding DeepSeek, xAI Grok, Meta** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to llm config.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Adding DeepSeek, xAI Grok, Meta** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **LLM Config** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #llm-config · #providers_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='llm-config';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'custom-ai-provider-with-base-url-fvi-kb','Custom AI Provider with Base URL','# Custom AI Provider with Base URL
> **Category:** LLM Config  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Custom AI Provider with Base URL** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to llm config.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Custom AI Provider with Base URL** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **LLM Config** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #llm-config · #custom_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='llm-config';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'setting-default-model-per-capability-fvi-kb','Setting Default Model per Capability','# Setting Default Model per Capability
> **Category:** LLM Config  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Setting Default Model per Capability** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to llm config.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Setting Default Model per Capability** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **LLM Config** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #llm-config · #routing_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='llm-config';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'reports-center-overview-fvi-kb','Reports Center Overview','# Reports Center Overview
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Reports Center Overview** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Reports Center Overview** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #intro_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'operations-report-fvi-kb','Operations Report','# Operations Report
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Operations Report** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Operations Report** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #operations_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'match-rates-report-fvi-kb','Match-Rates Report','# Match-Rates Report
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Match-Rates Report** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Match-Rates Report** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #match_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'trend-analysis-report-fvi-kb','Trend Analysis Report','# Trend Analysis Report
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Trend Analysis Report** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Trend Analysis Report** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #trends_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'risk-report-fvi-kb','Risk Report','# Risk Report
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Risk Report** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Risk Report** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #risk_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'ai-usage-report-fvi-kb','AI-Usage Report','# AI-Usage Report
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **AI-Usage Report** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **AI-Usage Report** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #ai_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'security-report-fvi-kb','Security Report','# Security Report
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Security Report** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Security Report** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #security_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'compliance-report-fvi-kb','Compliance Report','# Compliance Report
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Compliance Report** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Compliance Report** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #compliance_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'building-a-custom-report-fvi-kb','Building a Custom Report','# Building a Custom Report
> **Category:** Reports  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Building a Custom Report** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to reports.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Building a Custom Report** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Reports** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #reports · #custom · #builder_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='reports';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'control-tower-tenant-admin-overview-fvi-kb','Control Tower (Tenant Admin) Overview','# Control Tower (Tenant Admin) Overview
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Control Tower (Tenant Admin) Overview** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Control Tower (Tenant Admin) Overview** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #intro_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'inviting-members-to-your-tenant-fvi-kb','Inviting Members to Your Tenant','# Inviting Members to Your Tenant
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Inviting Members to Your Tenant** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Inviting Members to Your Tenant** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #invite_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'assigning-tenant-roles-fvi-kb','Assigning Tenant Roles','# Assigning Tenant Roles
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Assigning Tenant Roles** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Assigning Tenant Roles** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #roles · #rbac_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'tenant-groups-for-bulk-permissions-fvi-kb','Tenant Groups for Bulk Permissions','# Tenant Groups for Bulk Permissions
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Tenant Groups for Bulk Permissions** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Tenant Groups for Bulk Permissions** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #groups_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'configuring-sso-saml-oidc-fvi-kb','Configuring SSO (SAML / OIDC)','# Configuring SSO (SAML / OIDC)
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Configuring SSO (SAML / OIDC)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Configuring SSO (SAML / OIDC)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #sso_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'setting-up-scim-2-0-provisioning-fvi-kb','Setting Up SCIM 2.0 Provisioning','# Setting Up SCIM 2.0 Provisioning
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Setting Up SCIM 2.0 Provisioning** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Setting Up SCIM 2.0 Provisioning** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #scim_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'ip-allowlists-for-your-tenant-fvi-kb','IP Allowlists for Your Tenant','# IP Allowlists for Your Tenant
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **IP Allowlists for Your Tenant** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **IP Allowlists for Your Tenant** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #ip · #security_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'data-residency-settings-fvi-kb','Data Residency Settings','# Data Residency Settings
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Data Residency Settings** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Data Residency Settings** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #residency_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'tenant-level-audit-log-fvi-kb','Tenant-Level Audit Log','# Tenant-Level Audit Log
> **Category:** Control Tower  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Tenant-Level Audit Log** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to control tower.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Tenant-Level Audit Log** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Control Tower** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #control-tower · #audit_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='control-tower';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'ai-governance-at-the-tenant-level-fvi-kb','AI Governance at the Tenant Level','# AI Governance at the Tenant Level
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **AI Governance at the Tenant Level** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **AI Governance at the Tenant Level** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #tenant_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'feature-toggles-for-ai-capabilities-fvi-kb','Feature Toggles for AI Capabilities','# Feature Toggles for AI Capabilities
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Feature Toggles for AI Capabilities** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Feature Toggles for AI Capabilities** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #toggles_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'pii-redaction-policy-fvi-kb','PII Redaction Policy','# PII Redaction Policy
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **PII Redaction Policy** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **PII Redaction Policy** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #pii_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'ai-cost-metering-per-tenant-fvi-kb','AI Cost Metering Per Tenant','# AI Cost Metering Per Tenant
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **AI Cost Metering Per Tenant** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **AI Cost Metering Per Tenant** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #cost_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'ai-budget-enforcement-fvi-kb','AI Budget Enforcement','# AI Budget Enforcement
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **AI Budget Enforcement** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **AI Budget Enforcement** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #budget_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'platform-level-ai-policies-fvi-kb','Platform-Level AI Policies','# Platform-Level AI Policies
> **Category:** AI Governance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Platform-Level AI Policies** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Platform-Level AI Policies** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #platform_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'allowed-provider-catalog-fvi-kb','Allowed Provider Catalog','# Allowed Provider Catalog
> **Category:** AI Governance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Allowed Provider Catalog** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Allowed Provider Catalog** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #catalog_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'reviewing-ai-audit-trails-fvi-kb','Reviewing AI Audit Trails','# Reviewing AI Audit Trails
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Reviewing AI Audit Trails** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Reviewing AI Audit Trails** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #audit_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'byok-hyok-key-custody-fvi-kb','BYOK / HYOK Key Custody','# BYOK / HYOK Key Custody
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **BYOK / HYOK Key Custody** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **BYOK / HYOK Key Custody** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #byok_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'confidential-compute-boundaries-fvi-kb','Confidential Compute Boundaries','# Confidential Compute Boundaries
> **Category:** AI Governance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Confidential Compute Boundaries** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Confidential Compute Boundaries** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #confidential_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'model-cards-disclosures-fvi-kb','Model Cards & Disclosures','# Model Cards & Disclosures
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Model Cards & Disclosures** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Model Cards & Disclosures** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #model-card_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'human-in-the-loop-gates-fvi-kb','Human-in-the-Loop Gates','# Human-in-the-Loop Gates
> **Category:** AI Governance  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Human-in-the-Loop Gates** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to ai governance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Human-in-the-Loop Gates** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Governance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #ai-governance · #hitl_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-governance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'platform-admin-console-overview-fvi-kb','Platform Admin Console Overview','# Platform Admin Console Overview
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Platform Admin Console Overview** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Platform Admin Console Overview** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #platform_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'creating-a-tenant-fvi-kb','Creating a Tenant','# Creating a Tenant
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Creating a Tenant** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Creating a Tenant** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #tenant · #create_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'tenant-families-hierarchy-fvi-kb','Tenant Families & Hierarchy','# Tenant Families & Hierarchy
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Tenant Families & Hierarchy** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Tenant Families & Hierarchy** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #family_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'suspending-restoring-a-tenant-fvi-kb','Suspending & Restoring a Tenant','# Suspending & Restoring a Tenant
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Suspending & Restoring a Tenant** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Suspending & Restoring a Tenant** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #suspend_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'platform-rbac-fvi-kb','Platform RBAC','# Platform RBAC
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Platform RBAC** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Platform RBAC** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #rbac_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'platform-audit-hash-chained-fvi-kb','Platform Audit (Hash-Chained)','# Platform Audit (Hash-Chained)
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Platform Audit (Hash-Chained)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Platform Audit (Hash-Chained)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #audit_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'verifying-the-audit-chain-fvi-kb','Verifying the Audit Chain','# Verifying the Audit Chain
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Verifying the Audit Chain** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Verifying the Audit Chain** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #audit · #integrity_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'daily-audit-anchor-snapshots-fvi-kb','Daily Audit Anchor Snapshots','# Daily Audit Anchor Snapshots
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Daily Audit Anchor Snapshots** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Daily Audit Anchor Snapshots** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #audit · #anchor_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'stripe-billing-console-fvi-kb','Stripe Billing Console','# Stripe Billing Console
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Stripe Billing Console** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Stripe Billing Console** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #billing · #stripe_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'webhooks-console-fvi-kb','Webhooks Console','# Webhooks Console
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Webhooks Console** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Webhooks Console** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #webhooks_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'status-page-incidents-fvi-kb','Status Page & Incidents','# Status Page & Incidents
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Status Page & Incidents** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Status Page & Incidents** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #status_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'github-sync-panel-fvi-kb','GitHub Sync Panel','# GitHub Sync Panel
> **Category:** Admin  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **GitHub Sync Panel** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to admin.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **GitHub Sync Panel** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Admin** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #admin · #github_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='admin';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'tenant-slug-custom-urls-fvi-kb','Tenant Slug & Custom URLs','# Tenant Slug & Custom URLs
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Tenant Slug & Custom URLs** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Tenant Slug & Custom URLs** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #slug_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'tenant-branding-logo-theme-fvi-kb','Tenant Branding (Logo, Theme)','# Tenant Branding (Logo, Theme)
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Tenant Branding (Logo, Theme)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Tenant Branding (Logo, Theme)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #branding_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'support-ticket-routing-for-your-tenant-fvi-kb','Support Ticket Routing for Your Tenant','# Support Ticket Routing for Your Tenant
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Support Ticket Routing for Your Tenant** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Support Ticket Routing for Your Tenant** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #support · #sla_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'tenant-subscription-plan-fvi-kb','Tenant Subscription & Plan','# Tenant Subscription & Plan
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Tenant Subscription & Plan** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Tenant Subscription & Plan** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #billing_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'quotas-connectors-runs-ai-tokens-fvi-kb','Quotas: Connectors, Runs, AI Tokens','# Quotas: Connectors, Runs, AI Tokens
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Quotas: Connectors, Runs, AI Tokens** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Quotas: Connectors, Runs, AI Tokens** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #quota_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'data-retention-settings-fvi-kb','Data Retention Settings','# Data Retention Settings
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Data Retention Settings** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Data Retention Settings** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #retention_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'backup-export-of-tenant-data-fvi-kb','Backup & Export of Tenant Data','# Backup & Export of Tenant Data
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Backup & Export of Tenant Data** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Backup & Export of Tenant Data** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #backup_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'off-boarding-a-tenant-member-fvi-kb','Off-boarding a Tenant Member','# Off-boarding a Tenant Member
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Off-boarding a Tenant Member** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Off-boarding a Tenant Member** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #offboard_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'deleting-a-tenant-hard-vs-soft-fvi-kb','Deleting a Tenant (Hard vs Soft)','# Deleting a Tenant (Hard vs Soft)
> **Category:** Tenant Management  ·  **Scope:** Tenant  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Deleting a Tenant (Hard vs Soft)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Tenant** scope and need to action a task related to tenant management.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Deleting a Tenant (Hard vs Soft)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Tenant Management** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #tenant · #delete_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='tenant-management';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'meet-fvi-copilot-fvi-kb','Meet FVI - Copilot','# Meet FVI - Copilot
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Meet FVI - Copilot** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Meet FVI - Copilot** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #intro_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'opening-copilot-from-the-top-bar-fvi-kb','Opening Copilot From the Top Bar','# Opening Copilot From the Top Bar
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Opening Copilot From the Top Bar** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Opening Copilot From the Top Bar** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #ui_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'asking-operational-questions-fvi-kb','Asking Operational Questions','# Asking Operational Questions
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Asking Operational Questions** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Asking Operational Questions** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #query_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'persistent-chat-history-memory-fvi-kb','Persistent Chat History & Memory','# Persistent Chat History & Memory
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Persistent Chat History & Memory** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Persistent Chat History & Memory** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #memory_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'rbac-rls-guardrails-inside-copilot-fvi-kb','RBAC & RLS Guardrails Inside Copilot','# RBAC & RLS Guardrails Inside Copilot
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **RBAC & RLS Guardrails Inside Copilot** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **RBAC & RLS Guardrails Inside Copilot** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #security_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'generating-a-reconciliation-from-natural-language-fvi-kb','Generating a Reconciliation From Natural Language','# Generating a Reconciliation From Natural Language
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Generating a Reconciliation From Natural Language** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Generating a Reconciliation From Natural Language** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #generate_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'triaging-breaks-with-copilot-fvi-kb','Triaging Breaks with Copilot','# Triaging Breaks with Copilot
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Triaging Breaks with Copilot** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Triaging Breaks with Copilot** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #triage_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'summarising-runs-reports-fvi-kb','Summarising Runs & Reports','# Summarising Runs & Reports
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Summarising Runs & Reports** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Summarising Runs & Reports** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #summary_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'copilot-cost-usage-fvi-kb','Copilot Cost & Usage','# Copilot Cost & Usage
> **Category:** AI Copilot  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Copilot Cost & Usage** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to ai copilot.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Copilot Cost & Usage** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **AI Copilot** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #copilot · #cost_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='ai-copilot';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'security-architecture-overview-fvi-kb','Security Architecture Overview','# Security Architecture Overview
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Security Architecture Overview** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Security Architecture Overview** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #architecture_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'row-level-security-rls-in-fvi-fvi-kb','Row-Level Security (RLS) in FVI','# Row-Level Security (RLS) in FVI
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Row-Level Security (RLS) in FVI** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Row-Level Security (RLS) in FVI** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #rls_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'role-based-access-control-rbac-fvi-kb','Role-Based Access Control (RBAC)','# Role-Based Access Control (RBAC)
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Role-Based Access Control (RBAC)** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Role-Based Access Control (RBAC)** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #rbac_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'hash-chained-audit-log-fvi-kb','Hash-Chained Audit Log','# Hash-Chained Audit Log
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Hash-Chained Audit Log** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Hash-Chained Audit Log** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #audit · #integrity_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'step-up-authentication-for-destructive-actions-fvi-kb','Step-Up Authentication for Destructive Actions','# Step-Up Authentication for Destructive Actions
> **Category:** Security & Compliance  ·  **Scope:** Workspace  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Step-Up Authentication for Destructive Actions** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Workspace** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Step-Up Authentication for Destructive Actions** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #stepup_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'encryption-at-rest-in-transit-fvi-kb','Encryption At Rest & In Transit','# Encryption At Rest & In Transit
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Encryption At Rest & In Transit** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Encryption At Rest & In Transit** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #encryption_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'data-residency-eu-routing-fvi-kb','Data Residency & EU Routing','# Data Residency & EU Routing
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Data Residency & EU Routing** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Data Residency & EU Routing** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #residency_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'soc-2-type-ii-controls-mapping-fvi-kb','SOC 2 Type II Controls Mapping','# SOC 2 Type II Controls Mapping
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **SOC 2 Type II Controls Mapping** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **SOC 2 Type II Controls Mapping** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #soc2_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'iso-27001-controls-mapping-fvi-kb','ISO 27001 Controls Mapping','# ISO 27001 Controls Mapping
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **ISO 27001 Controls Mapping** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **ISO 27001 Controls Mapping** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #iso27001_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'gdpr-subject-access-requests-fvi-kb','GDPR: Subject-Access Requests','# GDPR: Subject-Access Requests
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **GDPR: Subject-Access Requests** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **GDPR: Subject-Access Requests** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #gdpr_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'dora-operational-resilience-fvi-kb','DORA Operational Resilience','# DORA Operational Resilience
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **DORA Operational Resilience** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **DORA Operational Resilience** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #dora_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'emir-refit-reporting-pack-fvi-kb','EMIR Refit Reporting Pack','# EMIR Refit Reporting Pack
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **EMIR Refit Reporting Pack** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **EMIR Refit Reporting Pack** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #emir_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'penetration-test-vulnerability-disclosure-fvi-kb','Penetration-Test & Vulnerability Disclosure','# Penetration-Test & Vulnerability Disclosure
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Penetration-Test & Vulnerability Disclosure** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Penetration-Test & Vulnerability Disclosure** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #pentest_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';
INSERT INTO public.kb_articles(scope,tenant_id,category_id,slug,title,body_md,status,views) SELECT 'platform',NULL,c.id,'incident-response-runbook-fvi-kb','Incident Response Runbook','# Incident Response Runbook
> **Category:** Security & Compliance  ·  **Scope:** Platform  ·  **Audience:** Operators, analysts, admins  ·  **Reading time:** ~3 min

## Overview
This article explains **Incident Response Runbook** inside Recon Spark (FVI). It covers what it is, when to use it, how to do it step-by-step, the security and governance model that applies, and common troubleshooting.

## When to use this
- You are working inside the **Platform** scope and need to action a task related to security & compliance.
- A teammate has linked you to this article from the in-app **Help** widget or the Command Palette (`⌘K → Help`).
- You want a single source of truth for **Incident Response Runbook** that aligns with our SOC 2, ISO 27001, GDPR, and DORA controls.

## Prerequisites
- You are signed into FVI with MFA enabled.
- Your role grants access to **Security & Compliance** in the current tenant.
- The relevant environment (Dev / Test / Prod) is selected from the top-bar switcher.

## Step-by-step
1. **Open the page.** From the left rail choose the matching section. If you do not see it, press `⌘K` and search for it.
2. **Confirm context.** Verify the breadcrumb shows the correct *Workspace › Section › Item* path and the environment chip reads the one you intend to change.
3. **Perform the action.** Use the primary CTA in the top-right of the panel. Forms validate inline; required fields are marked with a navy asterisk.
4. **Review the preview.** Where supported, FVI shows a **before / after** preview (mappings, transforms, role grants). Inspect it carefully.
5. **Save and confirm.** Destructive actions trigger a **step-up authentication** modal. Type the highlighted phrase exactly to confirm.
6. **Verify in audit.** Open *Audit* → filter by your user — the action appears with a SHA-256 row hash linked to the previous entry.

## Security & governance
- Every read and write is filtered by **Row-Level Security** scoped to your tenant and role.
- Mutations are written to the **append-only audit log** with a hash-chain anchor produced daily.
- AI-assisted features apply the tenant **PII redaction policy** *before* prompts leave the platform.
- 4-eyes approval applies to promotion between Dev / Test / Prod.

## Tips & shortcuts
- Use `⌘K` to jump straight to any object by name.
- Hover any KPI card on the dashboard for the underlying SQL definition.
- Pin frequent searches with the ★ icon to make them appear in your sidebar.

## Troubleshooting
- **I cannot see the action button.** Your role does not include the required permission. Ask your tenant admin to grant it via *Control Tower → Roles*.
- **The save fails with `403`.** RLS rejected the write — usually because you are on the wrong tenant or environment.
- **AI output looks generic.** Check that the tenant LLM Config has a non-default provider, and that the prompt has access to the underlying dataset.

## Related articles
- *Understanding the Three Scopes: Workspace, Tenant, Platform*
- *Audit Trail of Promotions*
- *Security Architecture Overview*

_Tags: #security · #incident_','published',0 FROM public.kb_categories c WHERE c.scope='platform' AND c.tenant_id IS NULL AND c.slug='security-compliance';

COMMIT;