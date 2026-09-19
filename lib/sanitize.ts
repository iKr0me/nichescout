/**
 * Sanitize untrusted external text. Used to limit the prompt-injection
 * surface area before any external string reaches the LLM.
 *
 * Per the plan: strip HTML and control characters, limit field lengths,
 * keep external content out of system instructions.
 */

const MAX_FIELD_LENGTH = 500;

export function sanitizeField(value: unknown, maxLen = MAX_FIELD_LENGTH): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Remove control characters (including \x00-\x1F except whitespace, \x7F).
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  // Strip HTML tags (very small surface; we never pass HTML, this is belt-and-braces).
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  s = s.replace(/<!\[CDATA\[[^\]]*\]\]>/g, "");
  // Collapse excessive whitespace.
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen) + "…";
  return s;
}

export function safePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function safeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
