import { MemoryEntry } from '../core/schema.js';
import { computeScore } from './scoring.js';

const MS_PER_DAY = 86_400_000;

export type PromotionActionType = 'promote_l2' | 'promote_l1' | 'demote_l1' | 'demote_l2';

export interface PromotionAction {
  entry: MemoryEntry;
  action: PromotionActionType;
}

/** Promote to L2 (project-level): accessed more than 3 times with high confidence. */
export function shouldPromoteToL2(entry: MemoryEntry): boolean {
  return entry.access_count > 3 && entry.confidence > 0.7;
}

/** Promote to L1 (global): accessed more than 10 times (cross-project pattern). */
export function shouldPromoteToL1(entry: MemoryEntry): boolean {
  return entry.access_count > 10;
}

/** Demote from L1: not accessed in the last 30 days. */
export function shouldDemoteFromL1(entry: MemoryEntry, now?: Date): boolean {
  const ref = now ?? new Date();
  const elapsed = (ref.getTime() - new Date(entry.last_accessed).getTime()) / MS_PER_DAY;
  return elapsed > 30;
}

/** Demote from L2: effective score has dropped below 0.3. */
export function shouldDemoteFromL2(entry: MemoryEntry, now?: Date): boolean {
  return computeScore(entry, now) < 0.3;
}

/**
 * Scan all entries and return a list of needed promotion/demotion actions.
 * Checks all four rules and returns any that apply.
 */
export function getPromotionActions(entries: MemoryEntry[], now?: Date): PromotionAction[] {
  const actions: PromotionAction[] = [];

  for (const entry of entries) {
    if (shouldPromoteToL1(entry)) {
      actions.push({ entry, action: 'promote_l1' });
    } else if (shouldPromoteToL2(entry)) {
      actions.push({ entry, action: 'promote_l2' });
    }

    if (shouldDemoteFromL1(entry, now)) {
      actions.push({ entry, action: 'demote_l1' });
    }
    if (shouldDemoteFromL2(entry, now)) {
      actions.push({ entry, action: 'demote_l2' });
    }
  }

  return actions;
}
