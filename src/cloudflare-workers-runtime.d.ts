declare module "cloudflare:workers" {
  /** Runtime bindings for the active Cloudflare deployment. */
  export const env: Record<string, unknown>;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "pdfjs-dist/legacy/build/pdf.min.mjs" {
  export const getDocument: typeof import("pdfjs-dist/legacy/build/pdf.mjs").getDocument;
}
