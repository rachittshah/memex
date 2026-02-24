import { MemoryEntry, DEFAULT_HALF_LIVES, MemoryCategory } from '../core/schema.js';

const MS_PER_DAY = 86_400_000;

function daysSince(isoDate: string, now: Date): number {
  return (now.getTime() - new Date(isoDate).getTime()) / MS_PER_DAY;
}

function getHalfLife(
  entry: MemoryEntry,
  halfLives?: Partial<Record<MemoryCategory, number>>,
): number {
  return halfLives?.[entry.category] ?? DEFAULT_HALF_LIVES[entry.category];
}

/**
 * Compute temporal decay factor for a memory entry.
 * Formula: 0.5 ^ (daysSinceLastAccess / halfLife)
 * Returns a value between 0.0 and 1.0.
 */
export function computeDecay(
  entry: MemoryEntry,
  now?: Date,
  halfLives?: Partial<Record<MemoryCategory, number>>,
): number {
  const ref = now ?? new Date();
  const halfLife = getHalfLife(entry, halfLives);

  if (halfLife === Infinity) return 1.0;

  const elapsed = daysSince(entry.last_accessed, ref);
  if (elapsed <= 0) return 1.0;

  return Math.max(0, Math.pow(0.5, elapsed / halfLife));
}

/** True when the decay factor drops below the stale threshold (default 0.3). */
export function isStale(
  entry: MemoryEntry,
  threshold = 0.3,
  now?: Date,
): boolean {
  return computeDecay(entry, now) < threshold;
}

/** True when the decay factor drops below the expired threshold (default 0.1). */
export function isExpired(
  entry: MemoryEntry,
  threshold = 0.1,
  now?: Date,
): boolean {
  return computeDecay(entry, now) < threshold;
}

/**
 * Number of days until the entry's decay crosses the given threshold.
 * Returns 0 if already past the threshold.
 * Returns Infinity for entries with infinite half-life (preferences).
 */
export function daysUntilStale(
  entry: MemoryEntry,
  threshold = 0.3,
  now?: Date,
): number {
  const ref = now ?? new Date();
  const halfLife = getHalfLife(entry, undefined);

  if (halfLife === Infinity) return Infinity;

  // Total days from last_accessed until decay crosses threshold:
  //   threshold = 0.5 ^ (totalDays / halfLife)
  //   totalDays = halfLife × log2(1 / threshold)
  const totalDays = halfLife * Math.log2(1 / threshold);
  const elapsed = daysSince(entry.last_accessed, ref);
  const remaining = totalDays - elapsed;

  return Math.max(0, remaining);
}
