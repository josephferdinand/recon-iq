from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "fvi-assurance-multipage-bank-statement.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

PAGE_W, PAGE_H = A4
NAVY = colors.HexColor("#102A43")
BLUE = colors.HexColor("#1F5E99")
PALE = colors.HexColor("#EAF2F8")
MUTED = colors.HexColor("#52606D")
LINE = colors.HexColor("#D9E2EC")


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 24 * mm, PAGE_W, 24 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 14)
    canvas.drawString(18 * mm, PAGE_H - 15 * mm, "Falcon International Bank")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(PAGE_W - 18 * mm, PAGE_H - 15 * mm, "ASSURANCE LAB - TEST DATA")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 17 * mm, PAGE_W - 18 * mm, 17 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 11 * mm, "Synthetic reconciliation evidence - no customer or personal data")
    canvas.drawRightString(PAGE_W - 18 * mm, 11 * mm, f"Page {doc.page}")
    canvas.restoreState()


styles = getSampleStyleSheet()
title = ParagraphStyle(
    "StatementTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=20, leading=24, textColor=NAVY, spaceAfter=5 * mm,
)
subtle = ParagraphStyle(
    "Subtle", parent=styles["BodyText"], fontSize=8.5, leading=12,
    textColor=MUTED,
)
right = ParagraphStyle(
    "Right", parent=subtle, alignment=TA_RIGHT,
)
section = ParagraphStyle(
    "Section", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=12, leading=15, textColor=BLUE, spaceBefore=4 * mm, spaceAfter=2 * mm,
)

doc = SimpleDocTemplate(
    str(OUTPUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
    topMargin=32 * mm, bottomMargin=24 * mm,
    title="FVI Assurance Multipage Bank Statement",
    author="ReconIQ Assurance Lab",
)

story = [
    Paragraph("Corporate Account Statement", title),
    Table(
        [
            [Paragraph("Account identifier", subtle), Paragraph("FVI-VALIDATION-001", right)],
            [Paragraph("Currency", subtle), Paragraph("USD", right)],
            [Paragraph("Statement period", subtle), Paragraph("2026-08-01 to 2026-08-31", right)],
            [Paragraph("Account type", subtle), Paragraph("Institutional operating account", right)],
        ],
        colWidths=[70 * mm, 104 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PALE),
            ("BOX", (0, 0), (-1, -1), 0.5, LINE),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ]),
    ),
    Spacer(1, 6 * mm),
    Paragraph("Statement summary", section),
    Table(
        [
            ["Opening balance", "Total credits", "Total debits", "Closing balance"],
            ["USD 125,000.00", "USD 28,250.00", "USD 20,825.00", "USD 132,425.00"],
        ],
        colWidths=[43.5 * mm] * 4,
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("FONTSIZE", (0, 0), (-1, 0), 7.5),
            ("FONTSIZE", (0, 1), (-1, 1), 9),
            ("BOX", (0, 0), (-1, -1), 0.5, NAVY),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ]),
    ),
    Spacer(1, 6 * mm),
    Paragraph("Transaction activity - part 1 of 2", section),
]

headers = ["Value date", "Reference", "Description", "Debit (USD)", "Credit (USD)"]
page1_rows = [
    ["2026-08-03", "CR-0803-001", "Incoming client settlement", "", "15,000.00"],
    ["2026-08-09", "DR-0809-002", "Custody and processing fees", "5,000.00", ""],
    ["2026-08-15", "CR-0815-003", "Treasury transfer receipt", "", "13,250.00"],
]
story.append(Table(
    [headers] + page1_rows,
    colWidths=[27 * mm, 31 * mm, 59 * mm, 28 * mm, 29 * mm],
    repeatRows=1,
    style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9FC")]),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]),
))
story += [
    Spacer(1, 8 * mm),
    Paragraph("This statement contains five transactions across two pages. Continued on page 2.", subtle),
    PageBreak(),
    Paragraph("Transaction activity - part 2 of 2", title),
]

page2_rows = [
    ["2026-08-21", "DR-0821-004", "Margin collateral transfer", "7,500.00", ""],
    ["2026-08-28", "DR-0828-005", "Broker settlement payment", "8,325.00", ""],
]
story.append(Table(
    [headers] + page2_rows,
    colWidths=[27 * mm, 31 * mm, 59 * mm, 28 * mm, 29 * mm],
    repeatRows=1,
    style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9FC")]),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]),
))
story += [
    Spacer(1, 7 * mm),
    Paragraph("Control totals", section),
    Table(
        [
            ["Transaction count", "5"],
            ["Total credits", "USD 28,250.00"],
            ["Total debits", "USD 20,825.00"],
            ["Net movement", "USD 7,425.00"],
            ["Closing balance", "USD 132,425.00"],
        ],
        colWidths=[85 * mm, 89 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), PALE),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.35, LINE),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ]),
    ),
    Spacer(1, 8 * mm),
    Paragraph(
        "Reconciliation check: opening balance + total credits - total debits = closing balance. "
        "125,000.00 + 28,250.00 - 20,825.00 = 132,425.00.",
        subtle,
    ),
]

doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print(str(OUTPUT))
