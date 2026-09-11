// Pure helper: turns a user-supplied report name into a safe attachment
// filename. Pulled out of the export route so the header-injection defence
// (CRLF/quote stripping) is unit-testable without exercising the route.

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\r\n]/g, "")
    .replace(/"/g, "")
    .replace(/[/\\]/g, "-")
    .trim();
  return cleaned.length > 0 ? cleaned : "report";
}
