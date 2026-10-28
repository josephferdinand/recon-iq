import { extractDigitalPdfText, PdfOcrRequiredError } from "./pdf";
import { extractScannedPdfText, type VisionAiBinding } from "./ocr";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: { AI?: VisionAiBinding }): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, { ok: true, service: "fvi-aidp-document-service" });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/pdf/text") {
      return json(404, { error: "not_found" });
    }
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/pdf") {
      return json(415, { error: "application_pdf_required" });
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_PDF_BYTES) return json(413, { error: "pdf_too_large" });
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength === 0) return json(400, { error: "empty_pdf" });
    if (buffer.byteLength > MAX_PDF_BYTES) return json(413, { error: "pdf_too_large" });
    const bytes = new Uint8Array(buffer);
    const ocrBytes = bytes.slice();
    try {
      const result = await extractDigitalPdfText(bytes);
      return json(200, { ...result, extractionMode: "digital" });
    } catch (error) {
      if (error instanceof PdfOcrRequiredError && env.AI) {
        try {
          return json(200, await extractScannedPdfText(env.AI, ocrBytes, error));
        } catch (ocrError) {
          const reason = ocrError instanceof Error ? ocrError.message.slice(0, 160) : "unknown";
          console.warn(
            JSON.stringify({ event: "aidp.pdf.ocr.failed", code: "ocr_conversion_failed", reason }),
          );
          return json(422, { error: "ocr_conversion_failed" });
        }
      }
      const code =
        error instanceof PdfOcrRequiredError ? "ocr_service_unavailable" : "pdf_extraction_failed";
      console.warn(JSON.stringify({ event: "aidp.pdf.extract.failed", code }));
      return json(422, { error: code });
    }
  },
} satisfies ExportedHandler<{ AI?: VisionAiBinding }>;
