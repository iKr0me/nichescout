/**
 * Relevance filter — pure, testable. Prevents CJ's loose full-text search
 * from surfacing products that match only one word of the niche (e.g.
 * "desk accessory" returning beaded shoe parts and crystal pendants).
 *
 * Rule: at least one non-stopword token from the search phrase must appear
 * in the product title. Short generic phrases ("accessory") are stop words.
 */

const STOPWORDS = new Set([
  "accessory", "accessories", "product", "products", "item", "items",
  "good", "goods", "cheap", "best", "new", "hot", "sale", "online",
  "lightweight", "small", "large", "mini", "portable",
  "under", "over", "with", "for", "the", "a", "an", "and", "or", "of",
  "to", "in", "on", "at", "by", "from", "that", "this", "it", "is",
]);

function tokenize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Returns true when at least one non-stopword token from the search phrase
 * appears in the product title. This is a minimum bar — it catches the
 * "accessory" → "beaded shoe accessory" mismatch without being so strict
 * that nothing passes.
 */
export function isRelevantProduct(searchPhrase: string, productTitle: string): boolean {
  const phraseTokens = tokenize(searchPhrase);
  if (phraseTokens.length === 0) return true;   // can't filter on empty phrase
  const titleLower = productTitle.toLowerCase();
  // At least one content word must match (as a substring, since compound
  // titles like "cable management" might split differently).
  return phraseTokens.some((token) => titleLower.includes(token));
}

/**
 * Score relevance by counting how many phrase tokens appear in the title.
 * Higher = more relevant. Used for sorting candidates before the freight step.
 */
export function relevanceScore(searchPhrase: string, productTitle: string): number {
  const phraseTokens = tokenize(searchPhrase);
  if (phraseTokens.length === 0) return 0;
  const titleLower = productTitle.toLowerCase();
  return phraseTokens.filter((t) => titleLower.includes(t)).length;
}
