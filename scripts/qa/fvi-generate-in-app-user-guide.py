"""Build only the leased Knowledge guide content/assets from reviewed documentation.

No SQL, app build, deployment, credentials, state refresh or screenshot fabrication.
"""
from pathlib import Path
import ast, datetime, hashlib, html, json, re, shutil, subprocess, sys

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = Path(r'./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928')
PRIVATE = Path(r'./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/LEIBNIZ-DOCS-RELEASE-718-CE449-20261004')
sys.path.insert(0, str(ROOT / 'support-docs-site'))
import build_pages as builder

def read_json(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def js(code, body=''):
    return subprocess.run(['node', '-e', code], cwd=ROOT, input=body, text=True,
                          encoding='utf-8', capture_output=True, check=True).stdout

registry = {}
for filename, keys in [('FVI_APPLICATION_GUIDE_CURRENT_CAPTURE_LEDGER_2026-10-02.json', ['historicalCaptures', 'currentReviewedCaptures']),
                       ('FVI_APPLICATION_GUIDE_POST_ACK_CAPTURE_LEDGER_2026-10-03.json', ['records'])]:
    data = read_json(ROOT / 'docs/evidence' / filename)
    for key in keys:
        for record in data.get(key, []):
            if record.get('publicImage'): registry[record['publicImage']] = record

fresh = [
    ('home-my30-settled-raw.png', 'home-my30.png', 'Personal Home30d; current actor-attributed totals'),
    ('home-team30-raw.png', 'home-team30.png', 'Team Home30d; empty mapped scope, no substitution'),
    ('reference-list-raw.png', 'reference-list.png', 'Reference list, purpose/schema/scope and published version'),
    ('reference-form-raw.png', 'reference-create-form.png', 'Blank reference form; required owningBU, disabled Save'),
    ('reports-settled-raw.png', 'reports-current-failure.png', 'Reports failed read; Retry reports/Reset report scope'),
]
fresh_paths = {}
for raw, name, qualification in fresh:
    original = PRIVATE / raw
    if not original.exists(): raise RuntimeError(f'Missing actual original: {raw}')
    destination = ROOT / 'support-docs-site/assets/img/application-guide/20261004-prod7180321a' / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists(): shutil.copy2(original, destination)
    if sha(destination) != sha(original): raise RuntimeError(f'Capture changed: {name}')
    relative = destination.relative_to(ROOT).as_posix()
    fresh_paths[name] = relative
    registry[relative] = {'id': 'prod718-' + name[:-4], 'publicImage': relative,
        'atUTC': datetime.datetime.fromtimestamp(original.stat().st_mtime, datetime.timezone.utc).isoformat(),
        'environment': 'PROD', 'releaseBasis': '7180321a-e9c5-4014-bd9b-a3f1c52e392b',
        'actorRole': 'Owned synthetic Docs platform maker; actual AAL2 verified21:09UTC',
        'state': qualification, 'derivativeSHA256': sha(destination)}

# Coordinates were checked against the actual full-size captures. No pixels change.
marks = {
    'tenant-settings.png': [(1, 'Confirm the intended tenant name, slug and environment before interpreting settings.', 20, 25, [18, 23, 39, 22]),
                            (2, 'The displayed role is context, not proof of a specific action permission.', 61, 25, [58, 23, 39, 22]),
                            (3, 'Region and residency-lock controls are configuration; this capture proves neither relocation nor compliance.', 20, 49, [18, 48, 39, 24])],
    'tenant-business-units-new-form.png': [(1, 'Enter the intended BU name; the optional code is described as auto-uppercased.', 6, 15, [4, 16, 92, 28]),
                                        (2, 'Explain the purpose and select the real parent BU, or Root only when a root unit is intended.', 6, 47, [4, 48, 92, 36]),
                                        (3, 'Review before an authorized Save; this blank setup capture does not prove BU creation.', 86, 90, [82, 87, 13, 9])],
    'workspace-watchers-new-form.png': [(1, 'Name the watcher and choose a currently authorized data source.', 6, 11, [4, 11, 92, 21]),
                                      (2, 'Review watch type, severity and the captured24-hour freshness threshold.', 6, 35, [4, 35, 92, 21]),
                                      (3, 'Review quarantine behavior, repeat timing and Enabled; configuration is not an executed alert or recovery.', 6, 57, [4, 57, 92, 31]),
                                      (4, 'Validate the source and settings before Save; no watcher was submitted in this capture.', 86, 92, [81, 90, 15, 8])],
    'workspace-recons-mode-0.png': [(1, 'Connect Source A through the intended supported input path; the selected Upload file is only an entry option.', 5, 23, [3, 21, 94, 44]),
                                 (2, 'The PDF picker selects recorded AIDP output; this capture does not prove financial extraction or scanned-image OCR.', 7, 49, [5, 48, 90, 11]),
                                 (3, 'The footer requires one connected source before Continue; no connection test or reconciliation ran here.', 4, 93, [2, 91, 96, 8])],
    'workspace-recons-mode-1.png': [(1, 'Connect and validate Source A under its real input/resource permissions.', 5, 23, [3, 21, 46, 44]),
                                 (2, 'Connect and validate Source B separately; two panels do not prove an authorized two-source run.', 54, 23, [51, 21, 46, 44]),
                                 (3, 'Both sources are required before Continue; retain errors instead of manufacturing a successful connection.', 4, 93, [2, 91, 96, 8])],
    'workspace-recons-mode-2.png': [(1, 'Choose the intended Source A input and verify its readable scope.', 4, 23, [2.5, 21, 30.5, 49]),
                                 (2, 'Configure Source B independently; record its actual connection/validation result.', 36, 23, [34.5, 21, 30.5, 49]),
                                 (3, 'A third distinct Source C is required for this Tri-Party entry; no three-source execution is inferred.', 68, 23, [66.5, 21, 31, 49]),
                                 (4, 'The footer requires all three sources before Continue. The middle hint still says both sources, a captured display-text limitation; no execution is inferred.', 4, 93, [2, 91, 96, 8])],
    'prod-real-mfa-recovery.png': [(1, 'Use the current code from your own authenticator; this public capture intentionally masks the input.', 39, 55, [37, 54, 28, 10]),
                                 (2, 'Verify and continue is the real challenge action. This blank challenge image alone does not prove verification or AAL2.', 39, 67, [37, 65, 26, 6])],
    'home-my30.png': [(1, 'Choose the intended My/Team/Tenant scope and UTC period; this picture is My30d.', 80, 11, [75, 9, 16, 6]),
                     (2, 'Interpret actor-attributed totals and NA correctly; personal0runs is not tenant0runs.', 20, 18, [18, 16, 73, 10])],
    'home-team30.png': [(1, 'Read the mapped-team/no-substitution notice before interpreting zero counts.', 20, 17, [18, 16, 73, 4]),
                       (2, 'Team tickets and AI remain unavailable without verified mappings.', 70, 73, [68, 73, 23, 12])],
    'reference-list.png': [(1, 'Inspect the table description, schema and actual BU/group assignments.', 18, 28, [16, 27, 82, 25]),
                         (2, 'Check the recorded version/effective date/hash; a rollback draft is not publication.', 18, 77, [16, 76, 82, 12])],
    'reference-create-form.png': [(1, 'Enter name and description/purpose, then comma-separated key/value columns.', 29, 8, [27, 7, 45, 11]),
                                (2, 'Select at least one owning Business Unit; group options follow real associations.', 29, 22, [27, 20, 45, 10]),
                                (3, 'Blank scope leaves Create table disabled; no save was submitted.', 66, 41, [60, 40, 13, 3])],
    'reports-current-failure.png': [(1, 'This settled read failed; it is not an empty report or a successful export.', 20, 27, [18, 25, 74, 6]),
                                  (2, 'Retry the read after resolving its cause; do not fabricate report data.', 20, 33, [18, 31, 9, 4]),
                                  (3, 'Reset report scope clears selection; it does not grant access.', 29, 33, [27, 31, 12, 4])],
    'unicode-current-native-view.png': [(1, 'Choose the exact authorized source document and confirm the capture/version.', 27, 45, [25, 43, 37, 5]),
                                      (2, 'Original/Download are separate actions; the tested Download failure remains open.', 54, 68, [51, 66, 14, 5]),
                                      (3, 'length0/previewempty is not validated financial extraction.', 74, 74, [71, 65, 26, 22])],
}

def capture(path, alt):
    if path not in registry: raise RuntimeError(f'No reviewed capture metadata: {path}')
    r = registry[path]; file = ROOT / path
    if not file.exists(): raise RuntimeError(f'Missing reviewed image: {path}')
    expected = r.get('derivativeSHA256')
    if expected and sha(file).lower() != expected.lower(): raise RuntimeError(f'Image hash drift: {path}')
    relative = path.split('assets/img/application-guide/', 1)[1]
    target = CANDIDATE / 'src/assets/application-guide' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists(): shutil.copy2(file, target)
    if sha(file) != sha(target): raise RuntimeError(f'Copied image differs: {path}')
    detailed = marks.get(file.name)
    items = detailed or [(1, 'Check the captured environment, feature version and role in the caption before using the numbered procedure. This is a context marking; control-specific review is still needed.', 5, 5, [1, 1, 98, 98])]
    return {'id': r['id'], 'asset': relative, 'alt': alt,
            'environment': r.get('environment', 'Capture qualification retained'),
            'version': r.get('releaseBasis', 'See original dated evidence'),
            'capturedAt': r.get('atUTC', 'Exact capture time not independently supplied'),
            'actorRole': r.get('actorRole') or r.get('roleBasis') or r.get('actorLabel', 'See original capture qualification'),
            'qualification': r.get('state') or r.get('workflowProof') or r.get('observedState', 'Read/render proof only; actions not inferred.'),
            'annotationStatus': 'Control callouts reviewed' if detailed else 'Context marking; detailed callouts pending',
            'marks': [{'number': n, 'text': text, 'x': x, 'y': y, 'box': box} for n, text, x, y, box in items]}

renderer = ast.parse((ROOT / 'scripts/qa/fvi-documentation-render.py').read_text(encoding='utf-8'))
slugs = next(ast.literal_eval(n.value) for n in renderer.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'SLUGS' for t in n.targets))
slugs.discard('application-guide')  # The native task index replaces the separate website index.
articles = [a for a in builder.discover_md_articles() if a['slug'] in slugs]
id_by_path = {f"/{a['section']}/{a['slug']}.html": a['slug'] for a in articles}

def scopes(article):
    slug, section = article['slug'], article['section']
    if slug in ['sign-in-with-mfa', 'check-environment-and-find-current-help', 'current-sso-scim-status']: return ['workspace', 'tenant', 'platform']
    if slug == 'read-workspace-intelligence': return ['workspace']
    if section == 'admin': return ['tenant', 'platform']
    if section == 'administration': return ['tenant']
    if slug in ['review-usage-and-budget-settings', 'review-retention-without-purging']: return ['tenant', 'platform']
    return ['workspace']

def blocks(md):
    rendered = js("const fs=require('node:fs');process.stdout.write(require('marked').parse(fs.readFileSync(0,'utf8'),{gfm:true}));", md)
    for path, id in id_by_path.items():
        rendered = rendered.replace(f'href="{path}"', f'href="#application-guide-{id}" data-application-guide="{id}"')
    # Separate actual captures from HTML so React renders annotations accessibly.
    pattern = re.compile(r'(?:<p>\s*)?<img\b(?P<attrs>[^>]+)>\s*(?:</p>)?', re.I)
    out = []; position = 0
    for match in pattern.finditer(rendered):
        if match.start() > position: out.append({'kind': 'html', 'html': rendered[position:match.start()]})
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', match['attrs']))
        src = html.unescape(attrs.get('src', '')); alt = html.unescape(attrs.get('alt', ''))
        if not alt: raise RuntimeError('Capture has no accessible description')
        if not src.startswith('/assets/img/application-guide/'): raise RuntimeError(f'Unapproved capture source: {src}')
        out.append({'kind': 'capture', 'capture': capture('support-docs-site' + src, alt)})
        position = match.end()
    if position < len(rendered): out.append({'kind': 'html', 'html': rendered[position:]})
    return out

data = []
for a in sorted(articles, key=lambda a: (a['section'], a['title'])):
    _, body = builder.parse_frontmatter(a['md_path'].read_text(encoding='utf-8'))
    body = re.sub(r'^#\s+.+?\n+', '', body, count=1, flags=re.M)
    if a['slug'] == 'read-workspace-intelligence':
        body = '''## Current My and Team view — PROD7180321a

1. Open Workspace → Home and check the tenant/environment and30UTC-calendar-day window.
2. My uses actor-attributed runs, definitions/sources/tickets/schedules and assigned exceptions. This actor has3created definitions/0runs; NAmatchrate is not0% or0tenantactivity.
3. Select Team (accessible name Team scope). Its current readable reconciliations follow effective same-tenant BU/group mappings. This actor's mapped scope is empty; no personal/tenant rows were substituted.
4. Totals cover the scoped data, while Recent runs previews at most8rows. Team tickets/AI remain unavailable without verified team mapping.
5. Change7d/30d/90d only for the intended UTCwindow and wait for a settled result. This pass proves30dMy/Team only.
6. Preserve a timeout/access refusal and retry the read or return to My. Do not change permissions or rerun a reconciliation to repair metrics.

![Actual My30d view, actor-created3definitions and0runs; original capture pixels.](/assets/img/application-guide/20261004-prod7180321a/home-my30.png)

![Actual Team30d empty mapped scope and unavailable team-ticket/AI sections; original capture pixels.](/assets/img/application-guide/20261004-prod7180321a/home-team30.png)

## Retained earlier procedure and evidence

''' + body
    if a['slug'] == 'review-reference-data':
        body = '''## Current reference view — PROD7180321a

1. Open Ingestion → Reference data (workspace?page=reference), confirm current tenant/read authority and inspect description/purpose, schema and actual BU/group mappings.
2. The retained selected currency-alias master is publishedversion1 with4saved rows, while the captured preview shows3rows; the preview is not a full export.
3. Create table requires an intended name, description explaining purpose, comma-separated key/value columns and at least one owningBU. Group choices follow actual association/inheritance; no relationship is invented.
4. The blank form shows the missingBU error and disables Create table. No save, stage, publication, rollback or checker mutation was repeated for these captures.
5. If a save is uncertain, inspect the original record/request before retrying identical retainedinputs. Do not duplicate a table or publish a draft without a legitimate independent checker and actual version/audit readback.

![Actual retained current reference list/version and bounded row preview.](/assets/img/application-guide/20261004-prod7180321a/reference-list.png)

![Actual blank current reference form; requiredBU and disabled creation.](/assets/img/application-guide/20261004-prod7180321a/reference-create-form.png)

## Retained earlier procedure and evidence

''' + body
    if a['slug'] == 'current-sso-scim-status':
        body = '## Latest scope qualification\n\nThe approved hybrid TypeScript plan preserves current email/password, MFA/TOTP, Supabase identities, sessions, RLS and authorization. Reuse of Casdoor UI and selected WSO2 React administration/SSO workflows waits for the tested, versioned reusable Cortex module. There is no Java/Go engine or identity cutover. Earlier vendor-adoption directions are historical; no unimplemented nativeSSO/SCIM setup is published as available. Current login/MFA/recovery/notifications continue.\n\n' + body
    if a['slug'] == 'prepare-bu-group-and-invitation':
        body = '''## Current refusal and DEV workflow qualification — 4 October

The app releases remain PROD7180321a/DEVce449c37. The separately committed PT409 SQL hotfix is PROD452/DEV430. Zeno reused one original owned stale withdrawal and received actual HTTP409/PT409 in319ms; before/after remained withdrawn/version2. Do not replay that completed check. Refresh the original record/currentversion before a legitimate new decision; preserve the refusal and original history.

The legitimate new DEV ordinary requester and independent real-MFA administrators completed request/withdraw/replay, independent approval, retain/revoke and membership/resource allow→deny with8correlated audit events. This is bounded current API evidence, not a fabricated checker or new screenshot. Durable denied-attempt audit and missing identity/team/environment metadata remain separate gaps. Older pictures retain their capture versions below.

''' + body
    role = 'Confirm current tenant administration authority and the specific action permission; use a distinct authorized checker for governed changes.' if 'tenant' in scopes(a) and scopes(a) != ['workspace', 'tenant', 'platform'] else 'Confirm the intended tenant/workspace, current role, effective BU/group/resource permissions and required assurance before acting. A QA capture does not grant access.'
    data.append({'id': a['slug'], 'title': a['title'], 'summary': a['desc'], 'scopes': scopes(a), 'category': a['section'],
                 'searchText': re.sub(r'<[^>]+>', ' ', body), 'prerequisite': role,
                 'blocks': blocks(body)})

# Publish only the actual supported Reports recovery steps, not unseen future tabs.
data.append({'id': 'recover-unavailable-reports', 'title': 'Recover an unavailable report',
    'summary': 'Recognize the current failed read and use its real recovery controls without claiming a download.',
    'scopes': ['workspace'], 'category': 'reports', 'searchText': 'Reports Retry reports Reset report scope download failed permission data UTC',
    'prerequisite': 'Active same-tenant membership and current readable report/resource scope. No administrator substitution or permission grant is implied.',
    'blocks': blocks('''1. Open Workspace → Reports for the intended tenant/environment and wait for the settled result.
2. The current PROD718 read failed: Reports could not be loaded / Report data could not be loaded. Retry the report. It is not an empty report or0activity.
3. Use Retry reports after its cause is resolved. One focused retry retained the same serializederror; no report data was fabricated.
4. Reset report scope clears selectedBU/reconciliation; it does not grant access. Preserve the safe scope/window/time and escalate the failed read if it remains unavailable.
5. No populated tabs, bundle or export were available in this read. Download/approval/history/recovery outcomes remain unverified until an actual current successful result is captured.

![Actual current Reports read failure and real recovery controls; no download success inferred.](/assets/img/application-guide/20261004-prod7180321a/reports-current-failure.png)
''')})

matrix = read_json(ROOT / 'docs/evidence/FVI_APPLICATION_PROCEDURE_CURRENT_RUNTIME_MATRIX_2026-10-02.json')
known = {a['id'] for a in data}
mapping = {'dashboard': ['read-workspace-intelligence'], 'reference': ['review-reference-data'],
           'reports': ['recover-unavailable-reports'], 'prep': ['find-and-review-pipelines', 'prepare-pipeline-settings', 'read-governed-pipeline-and-recorded-outcome'],
           'recons': ['choose-mode-and-connect-sources', 'read-exact-run-and-grouped-results'],
           'runs': ['read-exact-run-and-grouped-results'], 'productivity': ['use-productivity-pivot-and-document-view'],
           'governance': ['prepare-bu-group-and-invitation', 'read-and-export-audit-history'],
           'membership-requests': ['prepare-bu-group-and-invitation'], 'groups': ['prepare-bu-group-and-invitation'],
           'members': ['prepare-bu-group-and-invitation'], 'business-units': ['review-business-unit-access'],
           'audit': ['read-and-export-audit-history'], 'sso': ['current-sso-scim-status'], 'scim': ['current-sso-scim-status'],
           'retention': ['review-retention-without-purging'], 'watchers': ['review-data-watchers', 'prepare-data-watcher']}
coverage = []
for row in matrix['rows']:
    page = re.search(r'[?&]page=([^&]+)', row.get('route', ''))
    key = page[1] if page else row.get('label', '')
    ids = [id for id in mapping.get(key, []) if id in known]
    coverage.append({'id': row['id'], 'scope': 'tenant' if row['scope'] == 'tenantadministration' else row['scope'],
                     'module': row['label'], 'page': key, 'guideIds': ids,
                     'status': 'Procedure available; full workflow evidence remains qualified' if ids else 'Procedure and annotated capture needed',
                     'nextEvidence': row.get('nextCapture') or 'Current inputs, validation, legitimate action/checker, denied/error/recovery and audit/download outcome.'})

toc = CANDIDATE / 'src/content/support-toc.ts'
code = "const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');const c={exports:{}};vm.createContext(c);vm.runInContext(ts.transpileModule(fs.readFileSync(process.argv[1],'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);process.stdout.write(JSON.stringify(c.exports.getSupportCategories()));"
support = json.loads(subprocess.run(['node', '-e', code, str(toc)], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout)
support_rows = [{'category': c['name'], 'article': a['title'], 'path': f"/support/{c['slug']}/{a['slug']}",
                 'status': 'Existing source article; current action/capture review separate'} for c in support for a in c['articles']]

out = CANDIDATE / 'src/content/application-user-guide.data.ts'
text = 'import type { ApplicationGuideArticle, GuideCoverage, SupportGuideCoverage } from "./application-user-guide.types";\n\n'
for name, typ, value in [('ApplicationGuideArticles', 'ApplicationGuideArticle', data), ('ApplicationGuideCoverage', 'GuideCoverage', coverage), ('SupportGuideCoverage', 'SupportGuideCoverage', support_rows)]:
    text += f'export function get{name}(): {typ}[] {{ return ' + json.dumps(value, ensure_ascii=True, separators=(',', ':')) + '; }\n\n'
if re.search(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,}', text): raise RuntimeError('Credential-shaped guide content; value withheld')
out.write_text(text, encoding='utf-8')
captures = {b['capture']['asset']: b['capture'] for a in data for b in a['blocks'] if b['kind'] == 'capture'}
report = {'owner': 'Leibniz — in-app annotated Knowledge guide', 'status': 'SOURCE COMPLETE generation / not integrated or deployed',
          'atUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'guideArticles': len(data), 'reusedPreparedGuides': len(articles),
          'referencedActualCaptures': len(captures), 'sourceNavigationRows': len(coverage), 'supportCategories': len(support), 'supportArticles': len(support_rows),
          'controlAnnotatedCaptures': sum(c['annotationStatus'] == 'Control callouts reviewed' for c in captures.values()),
          'contextOnlyCaptures': sum(c['annotationStatus'] != 'Control callouts reviewed' for c in captures.values()),
          'captures': list(captures.values()), 'original75ImageLedgerPreserved': True,
          'missingEvidenceNotClosed': True, 'noRuntimeSQLOrCredentialMutation': True, 'sourceRoot': str(CANDIDATE)}
report_name = 'FVI_IN_APP_KNOWLEDGE_GUIDE_GENERATION_ANNOTATION_BATCH2_2026-10-04.json' if '--annotation-batch2' in sys.argv else 'FVI_IN_APP_KNOWLEDGE_GUIDE_GENERATION_2026-10-04.json'
(ROOT / 'docs/evidence' / report_name).write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['guideArticles', 'reusedPreparedGuides', 'referencedActualCaptures', 'sourceNavigationRows', 'supportCategories', 'supportArticles', 'controlAnnotatedCaptures', 'contextOnlyCaptures']}))
