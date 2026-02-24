import { describe, it, expect } from 'vitest';
import { computeDecay, isStale, isExpired } from '../src/algorithms/decay.js';
import { createEntry } from '../src/core/schema.js';

const MS_PER_DAY = 86_400_000;

function entryAccessedDaysAgo(days: number, category: Parameters<typeof createEntry>[1]) {
  const entry = createEntry(`Test ${category}`, category);
  entry.last_accessed = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  return entry;
}

describe('computeDecay', () => {
  it('returns ~1.0 for entry accessed today', () => {
    const entry = createEntry('Fresh entry', 'pattern');
    const decay = computeDecay(entry, new Date());
    expect(decay).toBeCloseTo(1.0, 1);
  });

  it('returns 1.0 for preference category (even if old)', () => {
    const entry = entryAccessedDaysAgo(365, 'preference');
    const decay = computeDecay(entry, new Date());
    expect(decay).toBe(1.0);
  });

  it('returns ~0.5 for project category entry accessed 14 days ago', () => {
    // project half-life = 14 days
    const entry = entryAccessedDaysAgo(14, 'project');
    const decay = computeDecay(entry, new Date());
    expect(decay).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.5 for gotcha category entry accessed 30 days ago', () => {
    // gotcha half-life = 30 days
    const entry = entryAccessedDaysAgo(30, 'gotcha');
    const decay = computeDecay(entry, new Date());
    expect(decay).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.25 for two half-lives elapsed', () => {
    // pattern half-life = 60, 120 days = 2 half-lives -> 0.25
    const entry = entryAccessedDaysAgo(120, 'pattern');
    const decay = computeDecay(entry, new Date());
    expect(decay).toBeCloseTo(0.25, 1);
  });
});

describe('isStale', () => {
  it('returns false for a fresh entry', () => {
    const entry = createEntry('Fresh', 'pattern');
    expect(isStale(entry, 0.3, new Date())).toBe(false);
  });

  it('returns true for a very old entry', () => {
    // project half-life = 14, after ~25 days decay ≈ 0.28 < 0.3
    const entry = entryAccessedDaysAgo(25, 'project');
    expect(isStale(entry, 0.3, new Date())).toBe(true);
  });

  it('returns false for preference category regardless of age', () => {
    const entry = entryAccessedDaysAgo(1000, 'preference');
    expect(isStale(entry, 0.3, new Date())).toBe(false);
  });
});

describe('isExpired', () => {
  it('returns false for a fresh entry', () => {
    const entry = createEntry('Fresh', 'gotcha');
    expect(isExpired(entry, 0.1, new Date())).toBe(false);
  });

  it('returns true for a very old entry with short half-life', () => {
    // project half-life = 14, after 50 days: 0.5^(50/14) ≈ 0.08 < 0.1
    const entry = entryAccessedDaysAgo(50, 'project');
    expect(isExpired(entry, 0.1, new Date())).toBe(true);
  });

  it('returns false for preference category regardless of age', () => {
    const entry = entryAccessedDaysAgo(1000, 'preference');
    expect(isExpired(entry, 0.1, new Date())).toBe(false);
  });
});
