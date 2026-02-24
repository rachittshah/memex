import { MemoryEntry } from '../core/schema.js';
import { computeDecay } from './decay.js';

export type ScoreFlag = 'healthy' | 'stale' | 'critical';

export interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
  flags: ScoreFlag;
}

/**
 * Compute the effective score for a single memory entry.
 * Formula: confidence × max(1, log2(access_count + 1)) × decay_factor
 */
export function computeScore(entry: MemoryEntry, now?: Date): number {
  const confidence = entry.confidence;
  const accessFactor = Math.max(1, Math.log2(entry.access_count + 1));
  const decayFactor = computeDecay(entry, now);
  return confidence * accessFactor * decayFactor;
}

function flagForScore(score: number): ScoreFlag {
  if (score >= 0.3) return 'healthy';
  if (score >= 0.1) return 'stale';
  return 'critical';
}

/**
 * Score all entries and return them sorted by score descending,
 * each annotated with a health flag.
 */
export function scoreAll(entries: MemoryEntry[], now?: Date): ScoredEntry[] {
  return entries
    .map((entry) => {
      const score = computeScore(entry, now);
      return { entry, score, flags: flagForScore(score) };
    })
    .sort((a, b) => b.score - a.score);
}
