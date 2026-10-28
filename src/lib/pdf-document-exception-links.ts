/**
 * The recovered application imports a missing association module.
 * Fail closed until its intended tenant-authorized implementation is qualified;
 * do not restore a quarantined historical writer or invent a successful link.
 */
export interface PdfDocumentExceptionLinkView {
  id: string; exceptionId: string; reference: string; amount: number | null;
  currency: string | null; status: string | null; ageDays: number | null; category: string | null;
}
export type PdfDocumentExceptionLinksResult = { status: 'available'; links: PdfDocumentExceptionLinkView[] } | { status: 'unavailable' };
export type PdfDocumentExceptionLinkCreateResult = { status: 'linked' } | { status: 'already-linked' } | { status: 'unavailable' };
export async function readPdfDocumentExceptionLinks(_tenantId: string, _documentId: string): Promise<PdfDocumentExceptionLinksResult> {
  return { status: 'unavailable' };
}
export async function createPdfDocumentExceptionLink(_input: { tenantId: string; documentId: string; exceptionId: string }): Promise<PdfDocumentExceptionLinkCreateResult> {
  return { status: 'unavailable' };
}
