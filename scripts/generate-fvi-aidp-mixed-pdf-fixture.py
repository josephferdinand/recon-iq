from __future__ import annotations

import argparse
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a two-page mixed digital/image-only PDF.")
    parser.add_argument("digital_pdf", type=Path)
    parser.add_argument("scanned_pdf", type=Path)
    parser.add_argument("output_pdf", type=Path)
    args = parser.parse_args()

    digital = PdfReader(str(args.digital_pdf.resolve()))
    scanned = PdfReader(str(args.scanned_pdf.resolve()))
    if len(digital.pages) < 2 or len(scanned.pages) < 2:
        raise ValueError("Both source PDFs must contain at least two pages")

    output = args.output_pdf.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    writer = PdfWriter()
    writer.add_page(digital.pages[0])
    writer.add_page(scanned.pages[1])
    with output.open("wb") as stream:
        writer.write(stream)
    print(f"created={output}")
    print("pages=2")


if __name__ == "__main__":
    main()
