/**
 * Pure statistics helpers. No I/O.
 *
 * - median: correct for even-sized inputs (average of the two middle values).
 * - linearRegressionSlope / coefficientOfVariation: operate on a SINGLE
 *   ordered series. Callers must never concatenate different Trends series —
 *   each phrase has its own independent 0–100 normalization, and mixing them
 *   produces a meaningless slope/CV.
 */

export function median(sortedAscending: number[]): number | null {
  if (!Array.isArray(sortedAscending) || sortedAscending.length === 0) return null;
  const s = [...sortedAscending].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  // even-sized: average of the two middle values
  return (s[mid - 1] + s[mid]) / 2;
}

export function linearRegressionSlope(points: number[]): number | null {
  if (!Array.isArray(points) || points.length < 2) return null;
  const n = points.length;
  const xs = points.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = points.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * points[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

export function coefficientOfVariation(points: number[]): number {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  if (mean <= 0) return 1;   // guard: collapse to max instability
  const variance = points.reduce((s, x) => s + (x - mean) ** 2, 0) / points.length;
  return Math.sqrt(variance) / mean;
}
