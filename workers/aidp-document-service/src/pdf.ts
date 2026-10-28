export class PdfOcrRequiredError extends Error {
  constructor(
    public readonly pageCount: number,
    public readonly pageTexts: string[],
  ) {
    super("AIDP PDF contains no extractable text; OCR is required");
  }
}

export async function extractDigitalPdfText(bytes: Uint8Array): Promise<{
  pageCount: number;
  text: string;
}> {
  await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  if (document.numPages < 1 || document.numPages > 200) {
    throw new Error(`AIDP PDF page count ${document.numPages} is outside the 1-200 limit`);
  }
  const pages: string[] = [];
  let totalCharacters = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
    totalCharacters += pageText.length;
    if (totalCharacters > 500_000) throw new Error("AIDP PDF text exceeds 500,000 characters");
    pages.push(`[Page ${pageNumber}]\n${pageText}`);
  }
  const pageTexts = pages.map((page) => page.split("\n").slice(1).join("\n").trim());
  if (totalCharacters === 0 || pageTexts.some((page) => !page)) {
    throw new PdfOcrRequiredError(document.numPages, pageTexts);
  }
  const text = pages.join("\n\n").trim();
  return { pageCount: document.numPages, text };
}
