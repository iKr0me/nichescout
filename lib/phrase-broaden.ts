/**
 * Phrase broadening — pure, testable.
 *
 * Google Shopping returns zero results for over-specific queries. The
 * interpretation LLM frequently produces phrases like
 * "lightweight desk organizers" (no data) when the broad version
 * "desk organizer" has a full page of results.
 *
 * Given a phrase, produce progressively broader variants, most-specific
 * first, so the caller can try each until one yields market data.
 */

// Modifiers that narrow a query without changing the core noun. Dropping
// these is the highest-yield broadening step.
const DROP_WORDS = new Set([
  "lightweight", "compact", "portable", "mini", "small", "large", "heavy",
  "adjustable", "foldable", "collapsible", "reusable", "washable",
  "premium", "luxury", "deluxe", "professional", "heavy-duty", "heavyduty",
  "cheap", "affordable", "budget", "discount", "wholesale",
  "new", "best", "top", "hot", "trending", "viral", "popular",
  "smart", "wireless", "electric", "automatic", "digital",
  "men", "mens", "women", "womens", "kids", "baby", "children",
  "indoor", "outdoor", "travel", "office", "home",
]);

function words(phrase: string): string[] {
  return phrase.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Naive singularisation for the last word only (organizers → organizer). */
function singularise(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("sses") || word.endsWith("shes") || word.endsWith("ches")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Broaden a phrase, most-specific first.
 *
 * "lightweight desk organizers" →
 *   ["lightweight desk organizers",   (original)
 *    "desk organizers",               (drop leading modifier)
 *    "desk organizer",                (singularise)
 *    "organizer"]                     (keep the head noun)
 *
 * Returns a de-duplicated list that ALWAYS includes the original first.
 */
export function broadenPhrase(phrase: string, maxVariants = 4): string[] {
  const original = phrase.trim().replace(/\s+/g, " ");
  if (!original) return [];

  const out: string[] = [original];
  const add = (candidate: string) => {
    const c = candidate.trim().replace(/\s+/g, " ");
    if (c && !out.includes(c)) out.push(c);
  };

  const w = words(original);

  // 1. Drop leading modifier words (highest-yield broadening).
  let start = 0;
  while (start < w.length - 1 && DROP_WORDS.has(w[start])) start++;
  const trimmed = w.slice(start);

  if (start > 0) {
    add(trimmed.join(" "));
    add(trimmed.map((x, i, a) => (i === a.length - 1 ? singularise(x) : x)).join(" "));
  } else {
    // No leading modifier dropped — singularise the tail directly.
    add(w.map((x, i, a) => (i === a.length - 1 ? singularise(x) : x)).join(" "));
  }

  // 2. Keep only the head noun (last content word), singularised. This is the
  //    broadest useful query and must not be crowded out by maxVariants.
  if (trimmed.length >= 2) {
    add(singularise(trimmed[trimmed.length - 1]));
  }

  return out.slice(0, maxVariants);
}
