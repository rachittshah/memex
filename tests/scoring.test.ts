import { describe, it, expect } from 'vitest';
import { computeScore, scoreAll } from '../src/algorithms/scoring.js';
import { createEntry } from '../src/core/schema.js';

describe('computeScore', () => {
  it('scores a fresh entry accessed today with confidence 0.8', () => {
    const entry = createEntry('Fresh entry', 'pattern', { confidence: 0.8 });
    const now = new Date();
    const score = computeScore(entry, now);
    // decay ≈ 1.0, accessFactor = max(1, log2(0+1)) = max(1, 0) = 1
    // score = 0.8 * 1 * 1.0 = 0.8
    expect(score).toBeCloseTo(0.8, 1);
  });

  it('returns higher score for higher access_count', () => {
    const low = createEntry('Low access', 'pattern', { confidence: 0.8 });
    const high = { ...createEntry('High access', 'pattern', { confidence: 0.8 }), access_count: 10 };
    const now = new Date();
    expect(computeScore(high, now)).toBeGreaterThan(computeScore(low, now));
  });

  it('preference category entries never decay (score stays high regardless of age)', () => {
    const entry = createEntry('Prefers dark mode', 'preference', { confidence: 0.9 });
    // Simulate old last_accessed
    const oldDate = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const oldEntry = { ...entry, last_accessed: oldDate };
    const now = new Date();
    const score = computeScore(oldEntry, now);
    // decay = 1.0 for preference (Infinity half-life), so score = 0.9 * 1 * 1.0
    expect(score).toBeCloseTo(0.9, 1);
  });

  it('stale entry (old last_accessed) scores lower', () => {
    const fresh = createEntry('Fresh', 'project', { confidence: 0.8 });
    const stale = {
      ...createEntry('Stale', 'project', { confidence: 0.8 }),
      last_accessed: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    };
    const now = new Date();
    expect(computeScore(stale, now)).toBeLessThan(computeScore(fresh, now));
  });
});

describe('scoreAll', () => {
  it('returns entries sorted by score descending', () => {
    const high = createEntry('High confidence', 'preference', { confidence: 1.0 });
    const low = createEntry('Low confidence', 'pattern', { confidence: 0.1 });
    const results = scoreAll([low, high]);
    expect(results[0].entry.id).toBe(high.id);
    expect(results[1].entry.id).toBe(low.id);
  });

  it('annotates entries with correct health flags', () => {
    const healthy = createEntry('Healthy', 'preference', { confidence: 0.9 });
    const results = scoreAll([healthy]);
    expect(results[0].flags).toBe('healthy');
  });
});
