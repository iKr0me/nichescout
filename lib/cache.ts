/**
 * Best-effort in-memory TTL cache. Vercel serverless functions may evict
 * at any time; never assume persistence across invocations.
 */
type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheStats(): { hits: number; misses: number } {
  return { hits, misses };
}

let hits = 0;
let misses = 0;
export function cacheRecordHit(): void {
  hits++;
}
export function cacheRecordMiss(): void {
  misses++;
}
export function cacheResetStats(): void {
  hits = 0;
  misses = 0;
}

/** Request-scoped usage. Constructed fresh per /api/evaluate call. */
export class ApiUsageTracker {
  cjCalls = 0;
  serpApiCalls = 0;
  openaiCalls = 0;
  llmInputTokens = 0;
  llmOutputTokens = 0;
  llmModel = process.env.OPENAI_MODEL || "gpt-5-mini";

  bumpCj(n = 1) {
    this.cjCalls += n;
  }
  bumpSerpApi(n = 1) {
    this.serpApiCalls += n;
  }
  bumpOpenAi(n = 1, input = 0, output = 0) {
    this.openaiCalls += n;
    this.llmInputTokens += input;
    this.llmOutputTokens += output;
  }
}
