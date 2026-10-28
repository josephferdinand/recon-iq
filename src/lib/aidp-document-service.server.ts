import { env as cloudflareEnv } from "cloudflare:workers";

export interface AidpDocumentServiceBinding {
  fetch(request: Request): Promise<Response>;
}

type EnvShape = { AIDP_DOCUMENT_SERVICE?: AidpDocumentServiceBinding } & Record<string, unknown>;

export function getAidpDocumentService(): AidpDocumentServiceBinding | null {
  const globalEnv = globalThis as unknown as { __env?: EnvShape; env?: EnvShape };
  const runtime = globalEnv.__env ?? globalEnv.env ?? (cloudflareEnv as EnvShape);
  const binding = runtime?.AIDP_DOCUMENT_SERVICE;
  return binding && typeof binding.fetch === "function" ? binding : null;
}

export async function extractPdfTextWithService(
  bytes: Uint8Array,
  service: AidpDocumentServiceBinding | null = getAidpDocumentService(),
) {
  if (!service) throw new Error("AIDP PDF service binding unavailable");
  const response = await service.fetch(
    new Request("https://aidp-document-service/v1/pdf/text", {
      method: "POST",
      headers: { "content-type": "application/pdf", "content-length": String(bytes.byteLength) },
      body: Uint8Array.from(bytes).buffer,
    }),
  );
  const payload = (await response.json()) as {
    pageCount?: unknown;
    text?: unknown;
    error?: unknown;
    extractionMode?: unknown;
    conversionTokens?: unknown;
  };
  if (!response.ok) {
    if (payload.error === "ocr_required" || payload.error === "ocr_service_unavailable") {
      throw new Error("AIDP PDF contains no extractable text; OCR is required");
    }
    throw new Error(`AIDP PDF service failed with status ${response.status}`);
  }
  if (
    !Number.isInteger(payload.pageCount) ||
    Number(payload.pageCount) < 1 ||
    Number(payload.pageCount) > 200
  ) {
    throw new Error("AIDP PDF service returned an invalid page count");
  }
  if (typeof payload.text !== "string" || !payload.text || payload.text.length > 500_000) {
    throw new Error("AIDP PDF service returned invalid text");
  }
  return {
    pageCount: Number(payload.pageCount),
    text: payload.text,
    extractionMode: payload.extractionMode === "ocr" ? ("ocr" as const) : ("digital" as const),
    conversionTokens: Number(payload.conversionTokens ?? 0),
  };
}
