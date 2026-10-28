from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


OUTPUT = Path("output/pdf/fvi-validation-bank-statement.pdf")


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="FVI Validation Bank Statement",
        author="ReconIQ Validation",
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph("ReconIQ", styles["Title"]),
        Paragraph("Synthetic Bank Statement - Validation Data Only", styles["Heading2"]),
        Spacer(1, 5 * mm),
        Paragraph(
            "Account: FVI-VALIDATION-001 | Currency: USD | Period: 2026-08-01 to 2026-08-31",
            styles["BodyText"],
        ),
        Spacer(1, 4 * mm),
    ]
    rows = [
        ["Value date", "Reference", "Description", "Debit", "Credit", "Balance"],
        ["2026-08-01", "OPEN-001", "Opening balance", "", "", "125,000.00"],
        ["2026-08-04", "PAY-1001", "Supplier settlement A", "12,450.00", "", "112,550.00"],
        ["2026-08-08", "REC-2001", "Customer receipt A", "", "18,750.00", "131,300.00"],
        ["2026-08-12", "FEE-3001", "Bank processing fee", "125.00", "", "131,175.00"],
        ["2026-08-19", "PAY-1002", "Supplier settlement B", "8,250.00", "", "122,925.00"],
        ["2026-08-26", "REC-2002", "Customer receipt B", "", "9,500.00", "132,425.00"],
    ]
    table = Table(rows, colWidths=[25 * mm, 27 * mm, 48 * mm, 23 * mm, 23 * mm, 27 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3B2B22")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#B8ADA6")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F2ED")]),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend(
        [
            table,
            Spacer(1, 7 * mm),
            Paragraph(
                "This document contains synthetic data created exclusively for authorised FVI DEV validation. "
                "It contains no real customer, account, or transaction information.",
                styles["Italic"],
            ),
        ]
    )
    document.build(story)
    print(f"Generated {OUTPUT}")


if __name__ == "__main__":
    main()
