#!/usr/bin/env python3
"""FVI branded PDF renderer. Onyx cover + gold accents, Playfair-like display via
reportlab bundled fonts (falling back to DejaVu for Unicode) and clean body pages."""
import os, re, sys, subprocess, datetime
from pathlib import Path
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
    Spacer, PageBreak, Table, TableStyle, KeepTogether, HRFlowable)

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT  = DOCS / "pdf"
OUT.mkdir(parents=True, exist_ok=True)

# --- Fonts ---------------------------------------------------------------
def _find(name):
    try:
        return subprocess.check_output(["fc-match","-f","%{file}",name], text=True).strip()
    except Exception:
        return None
for face, query in [("BodyRegular","DejaVu Sans"),("BodyBold","DejaVu Sans:bold"),
                    ("BodyItalic","DejaVu Sans:italic"),("Mono","DejaVu Sans Mono"),
                    ("Display","Georgia") ,("DisplayBold","Georgia:bold")]:
    path = _find(query) or _find("DejaVu Sans")
    if path: pdfmetrics.registerFont(TTFont(face, path))

GOLD   = HexColor("#D4B581")
ONYX   = HexColor("#0A0D14")
COFFEE = HexColor("#141D33")
CREAM  = HexColor("#F5EEDC")
INK    = HexColor("#1B1F2A")
MUTED  = HexColor("#5A6070")
RULE   = HexColor("#C9A96B")

# --- Styles --------------------------------------------------------------
def _s(name, **kw):
    base = dict(fontName="BodyRegular", fontSize=10.5, leading=15.5, textColor=INK,
                spaceBefore=0, spaceAfter=6)
    base.update(kw); return ParagraphStyle(name, **base)

STY = {
    "h1": _s("h1", fontName="DisplayBold", fontSize=22, leading=28, textColor=ONYX,
             spaceBefore=18, spaceAfter=10),
    "h2": _s("h2", fontName="DisplayBold", fontSize=16, leading=22, textColor=COFFEE,
             spaceBefore=14, spaceAfter=6),
    "h3": _s("h3", fontName="BodyBold", fontSize=12, leading=18, textColor=COFFEE,
             spaceBefore=10, spaceAfter=4),
    "body": _s("body"),
    "meta": _s("meta", fontSize=9, textColor=MUTED),
    "li":   _s("li", leftIndent=16, bulletIndent=4, spaceAfter=2),
    "code": _s("code", fontName="Mono", fontSize=9, leading=12, textColor=HexColor("#0B1220"),
               backColor=HexColor("#F1EDE1"), leftIndent=6, rightIndent=6,
               borderPadding=6, spaceBefore=4, spaceAfter=6),
    "cover_kicker": _s("ck", fontName="BodyBold", fontSize=10, textColor=GOLD,
                       alignment=1, spaceAfter=18),
    "cover_title":  _s("ct", fontName="DisplayBold", fontSize=44, leading=52,
                       textColor=CREAM, alignment=1, spaceAfter=14),
    "cover_sub":    _s("cs", fontSize=13, leading=20, textColor=HexColor("#C7C1AE"),
                       alignment=1, spaceAfter=40),
    "cover_meta":   _s("cm", fontSize=10, textColor=HexColor("#8E8877"), alignment=1),
}

# --- Page decoration -----------------------------------------------------
def cover_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(ONYX); canvas.rect(0,0,LETTER[0],LETTER[1],fill=1,stroke=0)
    # subtle gold rule
    canvas.setStrokeColor(GOLD); canvas.setLineWidth(0.6)
    canvas.line(1.2*inch, LETTER[1]-1.2*inch, LETTER[0]-1.2*inch, LETTER[1]-1.2*inch)
    canvas.line(1.2*inch, 1.2*inch,           LETTER[0]-1.2*inch, 1.2*inch)
    # monogram FV
    canvas.setFillColor(GOLD); canvas.setFont("DisplayBold", 22)
    canvas.drawCentredString(LETTER[0]/2, LETTER[1]-1.6*inch, "F V")
    canvas.restoreState()

def body_page(canvas, doc):
    canvas.saveState()
    # header rule
    canvas.setStrokeColor(RULE); canvas.setLineWidth(0.4)
    canvas.line(0.9*inch, LETTER[1]-0.7*inch, LETTER[0]-0.9*inch, LETTER[1]-0.7*inch)
    canvas.setFillColor(MUTED); canvas.setFont("BodyRegular", 8)
    canvas.drawString(0.9*inch,  LETTER[1]-0.55*inch, doc.title or "ReconIQ")
    canvas.drawRightString(LETTER[0]-0.9*inch, LETTER[1]-0.55*inch, "Confidential — FVI")
    # footer
    canvas.line(0.9*inch, 0.7*inch, LETTER[0]-0.9*inch, 0.7*inch)
    canvas.drawString(0.9*inch, 0.5*inch, doc.title or "")
    canvas.drawRightString(LETTER[0]-0.9*inch, 0.5*inch, f"Page {canvas.getPageNumber()}")
    canvas.restoreState()

# --- Markdown → flowables (lightweight) ----------------------------------
INLINE_CODE = re.compile(r"`([^`]+)`")
BOLD        = re.compile(r"\*\*([^*]+)\*\*")
ITAL        = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)")
LINK        = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

def inline(t):
    # Extract inline code first so ** or * inside code doesn't get parsed
    codes = []
    def _grab(m):
        codes.append(m.group(1))
        return f"\x00CODE{len(codes)-1}\x00"
    t = INLINE_CODE.sub(_grab, t)
    t = t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
    t = LINK.sub(lambda m: f'<font color="#8A6D2F"><u>{m.group(1)}</u></font>', t)
    t = BOLD.sub(r"<b>\1</b>", t)
    t = ITAL.sub(r"<i>\1</i>", t)
    def _restore(m):
        c = codes[int(m.group(1))].replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
        return f'<font face="Mono" backColor="#F1EDE1">{c}</font>'
    t = re.sub(r"\x00CODE(\d+)\x00", _restore, t)
    return t

def md_to_flowables(md_text):
    flow = []
    lines = md_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        # fenced code
        if line.startswith("```"):
            i += 1; buf=[]
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i]); i += 1
            i += 1
            code = "\n".join(buf).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            code = code.replace("\n","<br/>")
            flow.append(Paragraph(code, STY["code"])); continue
        # table (pipe)
        if "|" in line and i+1 < len(lines) and re.match(r"\s*\|?\s*:?-{2,}", lines[i+1]):
            rows=[]
            while i < len(lines) and "|" in lines[i]:
                if re.match(r"\s*\|?\s*:?-{2,}", lines[i]): i+=1; continue
                cells=[c.strip() for c in lines[i].strip().strip("|").split("|")]
                rows.append(cells); i+=1
            if rows:
                # normalize widths
                ncol = max(len(r) for r in rows)
                for r in rows:
                    while len(r) < ncol: r.append("")
                # convert cells to Paragraphs
                data=[[Paragraph(inline(c), STY["body"]) for c in r] for r in rows]
                col_w = (LETTER[0]-1.8*inch)/ncol
                t = Table(data, colWidths=[col_w]*ncol, hAlign="LEFT")
                t.setStyle(TableStyle([
                    ("BACKGROUND",(0,0),(-1,0), CREAM),
                    ("TEXTCOLOR", (0,0),(-1,0), ONYX),
                    ("FONTNAME",  (0,0),(-1,0), "BodyBold"),
                    ("LINEBELOW", (0,0),(-1,0), 0.8, GOLD),
                    ("LINEBELOW", (0,-1),(-1,-1), 0.4, RULE),
                    ("ROWBACKGROUNDS",(0,1),(-1,-1),[white, HexColor("#FBF7EC")]),
                    ("VALIGN",(0,0),(-1,-1),"TOP"),
                    ("LEFTPADDING",(0,0),(-1,-1),6),
                    ("RIGHTPADDING",(0,0),(-1,-1),6),
                    ("TOPPADDING",(0,0),(-1,-1),4),
                    ("BOTTOMPADDING",(0,0),(-1,-1),4),
                ]))
                flow.append(t); flow.append(Spacer(1,8)); continue
        # heading
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level=len(m.group(1)); text=inline(m.group(2))
            sty = STY["h1"] if level==1 else STY["h2"] if level==2 else STY["h3"]
            flow.append(Paragraph(text, sty))
            if level==1: flow.append(HRFlowable(width="100%", thickness=0.6, color=GOLD,
                                               spaceBefore=2, spaceAfter=8))
            i+=1; continue
        # hr
        if re.match(r"^-{3,}\s*$", line):
            flow.append(HRFlowable(width="100%", thickness=0.4, color=RULE,
                                   spaceBefore=6, spaceAfter=6)); i+=1; continue
        # list
        if re.match(r"^\s*[-*]\s+", line):
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                txt = re.sub(r"^\s*[-*]\s+","", lines[i])
                flow.append(Paragraph("• "+inline(txt), STY["li"])); i+=1
            continue
        if re.match(r"^\s*\d+\.\s+", line):
            n=1
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                txt = re.sub(r"^\s*\d+\.\s+","", lines[i])
                flow.append(Paragraph(f"{n}. "+inline(txt), STY["li"])); n+=1; i+=1
            continue
        # blank
        if not line.strip(): i+=1; continue
        # paragraph (join continuation)
        buf=[line]; i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r"^(#|\||```|-{3,}|\s*[-*]\s|\s*\d+\.\s)", lines[i]):
            buf.append(lines[i]); i+=1
        flow.append(Paragraph(inline(" ".join(buf)), STY["body"]))
    return flow

# --- Cover ---------------------------------------------------------------
def cover_flow(title, subtitle):
    from reportlab.platypus.doctemplate import NextPageTemplate
    today = datetime.date.today().isoformat()
    return [
        Spacer(1, 2.6*inch),
        Paragraph("RECONIQ", STY["cover_kicker"]),
        Paragraph(title, STY["cover_title"]),
        Paragraph(subtitle, STY["cover_sub"]),
        Spacer(1, 1.4*inch),
        Paragraph(f"Version 1.0.0 &nbsp;·&nbsp; {today}", STY["cover_meta"]),
        Paragraph("Confidential — For customer &amp; auditor review", STY["cover_meta"]),
        NextPageTemplate("body"),
        PageBreak(),
    ]

# --- Doc builder ---------------------------------------------------------
def build_pdf(out_path, title, subtitle, md_paths):
    doc = BaseDocTemplate(str(out_path), pagesize=LETTER,
        leftMargin=0.9*inch, rightMargin=0.9*inch,
        topMargin=0.95*inch, bottomMargin=0.9*inch,
        title=title, author="ReconIQ")
    frame = Frame(doc.leftMargin, doc.bottomMargin,
                  doc.width, doc.height, id="normal")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame], onPage=cover_page),
        PageTemplate(id="body",  frames=[frame], onPage=body_page),
    ])
    from reportlab.platypus.doctemplate import NextPageTemplate
    story = [NextPageTemplate("cover")] + cover_flow(title, subtitle)
    first = True
    for p in md_paths:
        text = Path(p).read_text(encoding="utf-8")
        if not first: story.append(PageBreak())
        first = False
        story.extend(md_to_flowables(text))
    doc.build(story)
    print(f"wrote {out_path}")

# --- Bundles -------------------------------------------------------------
BUNDLES = [
    ("FVI_PRODUCT_REQUIREMENTS.pdf",
     "Product Requirements",
     "Business goals, users, functional &amp; non-functional requirements",
     ["docs/PRODUCT_REQUIREMENTS.md","docs/USER_STORIES_AND_ACCEPTANCE_CRITERIA.md"]),
    ("FVI_SYSTEM_ARCHITECTURE.pdf",
     "System Architecture",
     "Components, data flow, trust boundaries &amp; deployment",
     ["docs/01_architecture_overview.md","docs/05_deployment_topology.md","docs/02_database_schema.md"]),
    ("FVI_SECURITY_AND_THREAT_MODEL.pdf",
     "Security & Threat Model",
     "Assets, threats, mitigations, residual risk",
     ["docs/03_security_posture.md","docs/12_security_test_report.md","docs/35_continuous_security_monitoring.md","docs/39_tenant_isolation.md"]),
    ("FVI_TEST_AND_RELEASE_REPORT.pdf",
     "Test & Release Report",
     "Plan, cases, results, release readiness",
     ["docs/TEST_PLAN.md","docs/TEST_CASES.md","docs/TEST_RESULTS.md","docs/RELEASE_CHECKLIST.md","docs/CHANGELOG.md"]),
    ("FVI_ADMINISTRATOR_GUIDE.pdf",
     "Administrator Guide",
     "Platform &amp; tenant administrator reference",
     ["docs/ADMINISTRATOR_GUIDE.md",
      "docs/admin-guides/01_rbac_sod.md","docs/admin-guides/02_sso_saml.md",
      "docs/admin-guides/03_ip_allowlist_zero_trust.md","docs/admin-guides/04_audit_export.md",
      "docs/admin-guides/05_retention_residency.md","docs/admin-guides/06_byok_llm.md",
      "docs/admin-guides/07_support_escalation.md","docs/admin-guides/08_break_glass.md"]),
    ("FVI_COMPLETE_DOCUMENTATION.pdf",
     "Complete Documentation",
     "Product, architecture, security, tests, ops &amp; admin — consolidated",
     ["docs/README.md","docs/PRODUCT_REQUIREMENTS.md","docs/USER_STORIES_AND_ACCEPTANCE_CRITERIA.md",
      "docs/01_architecture_overview.md","docs/02_database_schema.md","docs/03_security_posture.md",
      "docs/04_api_reference.md","docs/25_rbac_guide.md","docs/05_deployment_topology.md",
      "docs/TEST_PLAN.md","docs/TEST_CASES.md","docs/TEST_RESULTS.md",
      "docs/ADMINISTRATOR_GUIDE.md","docs/USER_GUIDE.md","docs/TROUBLESHOOTING_RUNBOOK.md",
      "docs/RELEASE_CHECKLIST.md","docs/CHANGELOG.md","docs/DECISIONS_AND_TECHNICAL_DEBT.md"]),
    # ---- Penetration test bundle ----
    ("FVI_PENTEST_EXECUTIVE_SUMMARY.pdf",
     "Penetration Test — Executive Summary",
     "Scope, posture &amp; release recommendation",
     ["docs/pentest/EXECUTIVE_SUMMARY.md","docs/pentest/PENETRATION_TEST_SCOPE.md","docs/pentest/RULES_OF_ENGAGEMENT.md"]),
    ("FVI_PENTEST_TECHNICAL_FINDINGS.pdf",
     "Penetration Test — Technical Findings",
     "Confirmed findings, authorization, business logic, API, payment, isolation",
     ["docs/pentest/CONFIRMED_FINDINGS.md","docs/pentest/AUTHORIZATION_TEST_RESULTS.md","docs/pentest/COUPON_ABUSE_TEST_RESULTS.md","docs/pentest/API_SECURITY_TEST_RESULTS.md","docs/pentest/PAYMENT_SECURITY_TEST_RESULTS.md","docs/pentest/DATABASE_AND_TENANT_ISOLATION_RESULTS.md","docs/pentest/CLOUD_CONFIGURATION_RESULTS.md","docs/pentest/DEPENDENCY_AND_SOURCE_REVIEW.md"]),
    ("FVI_PENTEST_REMEDIATION_PLAN.pdf",
     "Penetration Test — Remediation Plan",
     "Owners, targets, regression tests",
     ["docs/pentest/REMEDIATION_PLAN.md"]),
    ("FVI_PENTEST_RETEST_AND_CLOSURE.pdf",
     "Penetration Test — Retest &amp; Closure",
     "Retest cycle results and residual risk",
     ["docs/pentest/RETEST_RESULTS.md","docs/pentest/RESIDUAL_RISK_REGISTER.md"]),
    ("FVI_PENTEST_FINAL_RELEASE_ASSESSMENT.pdf",
     "Penetration Test — Final Release Assessment",
     "Release gate outcome and required actions",
     ["docs/pentest/RELEASE_SECURITY_CHECKLIST.md"]),
    ("FVI_PENTEST_FULL_REPORT.pdf",
     "Penetration Test — Full Report",
     "Consolidated pentest deliverable",
     ["docs/pentest/EXECUTIVE_SUMMARY.md","docs/pentest/PENETRATION_TEST_SCOPE.md","docs/pentest/RULES_OF_ENGAGEMENT.md","docs/pentest/ASSET_INVENTORY.md","docs/pentest/TEST_ACCOUNT_MATRIX.md","docs/pentest/DATA_HANDLING_PLAN.md","docs/pentest/EMERGENCY_CONTACTS_AND_STOP_PROCEDURE.md","docs/pentest/ATTACK_SURFACE_INVENTORY.md","docs/pentest/PENETRATION_TEST_PLAN.md","docs/pentest/PENETRATION_TEST_CASES.md","docs/pentest/CONFIRMED_FINDINGS.md","docs/pentest/AUTHORIZATION_TEST_RESULTS.md","docs/pentest/COUPON_ABUSE_TEST_RESULTS.md","docs/pentest/API_SECURITY_TEST_RESULTS.md","docs/pentest/PAYMENT_SECURITY_TEST_RESULTS.md","docs/pentest/DATABASE_AND_TENANT_ISOLATION_RESULTS.md","docs/pentest/CLOUD_CONFIGURATION_RESULTS.md","docs/pentest/DEPENDENCY_AND_SOURCE_REVIEW.md","docs/pentest/REMEDIATION_PLAN.md","docs/pentest/RETEST_RESULTS.md","docs/pentest/RESIDUAL_RISK_REGISTER.md","docs/pentest/RELEASE_SECURITY_CHECKLIST.md"]),
    ("FULL_PENETRATION_TEST_REPORT.pdf",
     "Full Penetration Test Report",
     "Complete engagement — scope, findings, remediation, retest, release",
     ["docs/pentest/EXECUTIVE_SUMMARY.md","docs/pentest/PENETRATION_TEST_SCOPE.md","docs/pentest/RULES_OF_ENGAGEMENT.md","docs/pentest/ASSET_INVENTORY.md","docs/pentest/TEST_ACCOUNT_MATRIX.md","docs/pentest/DATA_HANDLING_PLAN.md","docs/pentest/EMERGENCY_CONTACTS_AND_STOP_PROCEDURE.md","docs/pentest/ATTACK_SURFACE_INVENTORY.md","docs/pentest/PENETRATION_TEST_PLAN.md","docs/pentest/PENETRATION_TEST_CASES.md","docs/pentest/CONFIRMED_FINDINGS.md","docs/pentest/AUTHORIZATION_TEST_RESULTS.md","docs/pentest/COUPON_ABUSE_TEST_RESULTS.md","docs/pentest/API_SECURITY_TEST_RESULTS.md","docs/pentest/PAYMENT_SECURITY_TEST_RESULTS.md","docs/pentest/DATABASE_AND_TENANT_ISOLATION_RESULTS.md","docs/pentest/CLOUD_CONFIGURATION_RESULTS.md","docs/pentest/DEPENDENCY_AND_SOURCE_REVIEW.md","docs/pentest/REMEDIATION_PLAN.md","docs/pentest/RETEST_RESULTS.md","docs/pentest/RESIDUAL_RISK_REGISTER.md","docs/pentest/RELEASE_SECURITY_CHECKLIST.md"]),
]

def main():
    for name, title, sub, mds in BUNDLES:
        paths = [ROOT/p for p in mds if (ROOT/p).exists()]
        if not paths:
            print(f"skip {name}: no sources"); continue
        build_pdf(OUT/name, title, sub, paths)

if __name__ == "__main__":
    main()
