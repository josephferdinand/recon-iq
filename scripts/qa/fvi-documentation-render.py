"""Render only Leibniz's owned procedure articles in the existing support structure."""
import html, re, sys, subprocess, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'support-docs-site'))
import build_pages as builder
if not builder._HAS_MD:
    # Keep the guide render complete when the selected Python has no Markdown.
    # Use the existing installed parser; fail instead of emitting raw markup.
    marked = ROOT / 'node_modules/marked/lib/marked.cjs'
    node = shutil.which('node')
    if not node or not marked.is_file():
        raise RuntimeError('Guide rendering requires Python Markdown or the existing Node marked parser.')
    def render_markdown(body):
        result = subprocess.run(
            [node, '-e', "const fs=require('node:fs');process.stdout.write(require(process.argv[1]).parse(fs.readFileSync(0,'utf8'),{gfm:true}));", str(marked)],
            input=body, text=True, encoding='utf-8', capture_output=True, check=True,
        )
        return result.stdout
    builder.md_to_html = render_markdown
SLUGS={'application-guide','find-and-review-pipelines','review-reference-data','read-workspace-intelligence','review-data-watchers','review-business-unit-access','current-sso-scim-status','review-ageing-and-recorded-exposure','review-recorded-agent-analysis','use-productivity-pivot-and-document-view','inspect-recorded-lineage','read-and-export-audit-history','prepare-pipeline-settings','prepare-data-watcher','prepare-bu-group-and-invitation','choose-mode-and-connect-sources','sign-in-with-mfa','check-tenant-identity-and-residency','review-usage-and-budget-settings','review-modules-and-page-visibility','review-retention-without-purging','find-tenants-and-review-environment-access','review-platform-entitlements-and-roadmap','read-exact-run-and-grouped-results','read-governed-pipeline-and-recorded-outcome','check-environment-and-find-current-help'}
articles=[a for a in builder.discover_md_articles() if a['slug'] in SLUGS]
ordered=sorted(articles,key=lambda a:(a['slug']!='application-guide',a['section'],a['title']))
for article in articles:
    builder.render_md_article(article)
    file=ROOT/'support-docs-site'/article['section']/(article['slug']+'.html')
    text=file.read_text(encoding='utf-8')
    text=re.sub(r'<body\b([^>]*)>',r'<body class="fvi-guide-document"\1>',text,count=1).replace('</head>','  <link rel="stylesheet" href="/assets/css/application-guide-layout.css" />\n</head>',1)
    nav='<nav aria-label="Application procedures"><strong>Application procedures</strong>'
    for other in ordered:
        current=' aria-current="page"' if other['slug']==article['slug'] else ''
        nav+=f'<a{current} href="/{other["section"]}/{other["slug"]}.html">{html.escape(other["title"])}</a>'
    nav+='</nav>'
    text=text.replace('<aside class="fvi-doc-sidebar" data-fvi-sidebar></aside>',f'<aside class="fvi-doc-sidebar">{nav}</aside>')
    text=re.sub(r'<article>\s*<article>','<article>',text,count=1)
    text=re.sub(r'</article>\s*</article>','</article>',text,count=1)
    file.write_text(text,encoding='utf-8')
print(f'Rendered {len(articles)} owned guide articles; no global site/app build.')





