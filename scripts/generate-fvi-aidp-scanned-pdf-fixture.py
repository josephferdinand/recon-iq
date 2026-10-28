from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an image-only scanned PDF from a source PDF.")
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("output_pdf", type=Path)
    parser.add_argument("--pdftoppm", type=Path, required=True)
    args = parser.parse_args()

    source = args.input_pdf.resolve()
    output = args.output_pdf.resolve()
    if not source.is_file() or source.suffix.lower() != ".pdf":
        raise ValueError("input_pdf must be an existing PDF")
    if output.suffix.lower() != ".pdf":
        raise ValueError("output_pdf must end in .pdf")
    converter = args.pdftoppm.resolve(strict=True)
    if not converter.is_file() or converter.name.lower() not in {"pdftoppm", "pdftoppm.exe"}:
        raise ValueError("--pdftoppm must be the pdftoppm executable")
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="fvi-scanned-pdf-") as work:
        prefix = Path(work) / "page"
        # Fixture-only CLI: the local caller selects a validated Poppler binary;
        # arguments are separate and shell execution is never enabled.
        subprocess.run(
            [str(converter), "-png", "-r", "150", str(source), str(prefix)],  # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args
            check=True,
            capture_output=True,
        )
        pages = sorted(Path(work).glob("page-*.png"))
        if not pages:
            raise RuntimeError("source PDF produced no rendered pages")

        document = canvas.Canvas(str(output), pageCompression=1)
        for page_path in pages:
            with Image.open(page_path) as image:
                width, height = image.size
                page_width = width * 72 / 150
                page_height = height * 72 / 150
                document.setPageSize((page_width, page_height))
                document.drawImage(
                    ImageReader(image.convert("RGB")),
                    0,
                    0,
                    width=page_width,
                    height=page_height,
                    preserveAspectRatio=True,
                    mask="auto",
                )
                document.showPage()
        document.save()

    print(f"created={output}")
    print(f"pages={len(pages)}")


if __name__ == "__main__":
    main()
