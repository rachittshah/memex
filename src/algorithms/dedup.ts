import { MemoryEntry } from '../core/schema.js';

export type DedupOp = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';

export interface DedupResult {
  op: DedupOp;
  target?: MemoryEntry;
  merged?: MemoryEntry;
}

const NEGATION_PATTERNS = /\b(not|never|don't|doesn't|shouldn't|avoid|stop|disable|remove)\b/i;

/** Lowercase, split on whitespace + punctuation, filter empty tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((t) => t.length > 0);
}

/** Jaccard similarity: |intersection| / |union|. Returns 0 if both sets are empty. */
export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Check if two pieces of content contradict each other.
 * Simple heuristic: one has negation keywords and they share enough vocabulary.
 */
function isContradiction(contentA: string, contentB: string): boolean {
  const aHasNeg = NEGATION_PATTERNS.test(contentA);
  const bHasNeg = NEGATION_PATTERNS.test(contentB);
  // Contradiction requires exactly one side to have negation
  if (aHasNeg === bHasNeg) return false;

  // Check they're talking about the same topic (moderate similarity)
  const tokA = tokenize(contentA.replace(NEGATION_PATTERNS, ''));
  const tokB = tokenize(contentB.replace(NEGATION_PATTERNS, ''));
  return jaccardSimilarity(tokA, tokB) > 0.5;
}

/**
 * Merge two entries, preferring newer/longer content and unioning metadata.
 */
export function mergeEntries(existing: MemoryEntry, newEntry: MemoryEntry): MemoryEntry {
  const now = new Date().toISOString();
  const tags = [...new Set([...existing.tags, ...newEntry.tags])];
  const related_files = [...new Set([...existing.related_files, ...newEntry.related_files])];
  const content =
    newEntry.content.length >= existing.content.length ? newEntry.content : existing.content;

  return {
    ...existing,
    content,
    confidence: Math.max(existing.confidence, newEntry.confidence),
    access_count: existing.access_count + 1,
    last_accessed: now,
    updated: now,
    tags,
    related_files,
  };
}

/**
 * Determine the dedup operation for a new entry against existing entries.
 * - NOOP if Jaccard > 0.9 (essentially identical)
 * - DELETE if content contradicts an existing entry
 * - UPDATE if 0.6 < Jaccard <= 0.9 (similar, merge)
 * - ADD if Jaccard <= 0.6 (unique)
 */
export function dedupOperation(
  newEntry: MemoryEntry,
  existingEntries: MemoryEntry[],
): DedupResult {
  if (existingEntries.length === 0) return { op: 'ADD' };

  const newTokens = tokenize(newEntry.content);

  let bestSim = 0;
  let bestMatch: MemoryEntry | undefined;

  for (const existing of existingEntries) {
    const sim = jaccardSimilarity(newTokens, tokenize(existing.content));
    if (sim > bestSim) {
      bestSim = sim;
      bestMatch = existing;
    }
  }

  if (!bestMatch) return { op: 'ADD' };

  // Check contradiction before similarity thresholds
  if (isContradiction(newEntry.content, bestMatch.content)) {
    return { op: 'DELETE', target: bestMatch };
  }

  if (bestSim > 0.9) {
    return { op: 'NOOP', target: bestMatch };
  }

  if (bestSim > 0.6) {
    return { op: 'UPDATE', target: bestMatch, merged: mergeEntries(bestMatch, newEntry) };
  }

  return { op: 'ADD' };
}
