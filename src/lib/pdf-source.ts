/** Resolve the actual signed URL; do not fabricate a document source. */
export function resolvePdfSource(value: unknown, error?: unknown): { status: 'available'; url: string } | { status: 'unavailable' } {
  if (error) return { status: 'unavailable' };
  const candidate = typeof value === 'string' ? value : value && typeof value === 'object'
    ? (value as { signedUrl?: unknown; signedURL?: unknown }).signedUrl ?? (value as { signedURL?: unknown }).signedURL
    : undefined;
  if (typeof candidate !== 'string') return { status: 'unavailable' };
  try { const url = new URL(candidate); return url.protocol === 'https:' || url.protocol === 'http:'
    ? { status: 'available', url: candidate } : { status: 'unavailable' }; }
  catch { return { status: 'unavailable' }; }
}
