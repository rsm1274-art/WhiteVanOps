export interface FieldUrlClassification {
  /** Host is localhost / 127.0.0.1 — unreachable from a phone. */
  isLocalhost: boolean;
  /** Plain http:// over a public host — credentials would travel unencrypted. */
  isPlainHttp: boolean;
  /** https:// — the shape the tunnel produces. */
  isHttps: boolean;
}

/**
 * Classifies a Field Module URL by transport shape so the QR flow can guide
 * the admin. The tunnel (trial or client-owned) always yields an https URL
 * with no :3000; localhost is never phone-reachable; public plain http means
 * plaintext credentials.
 */
export function classifyFieldUrl(url: string): FieldUrlClassification {
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
  const isHttps = /^https:\/\//i.test(url);
  const isPlainHttp = /^http:\/\//i.test(url) && !isLocalhost;
  return { isLocalhost, isPlainHttp, isHttps };
}
