import { describe, it, expect } from 'vitest';
import {
  tokenize,
  jaccardSimilarity,
  dedupOperation,
  mergeEntries,
} from '../src/algorithms/dedup.js';
import { createEntry } from '../src/core/schema.js';

describe('tokenize', () => {
  it('splits text into lowercase tokens', () => {
    const tokens = tokenize('Hello World! This is a TEST.');
    expect(tokens).toEqual(['hello', 'world', 'this', 'is', 'a', 'test']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles punctuation-heavy text', () => {
    const tokens = tokenize("don't use var; use const/let");
    expect(tokens).toContain("don");
    expect(tokens).toContain("t");
    expect(tokens).toContain("use");
    expect(tokens).toContain("const");
    expect(tokens).toContain("let");
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    const tokens = ['hello', 'world'];
    expect(jaccardSimilarity(tokens, tokens)).toBe(1.0);
  });

  it('returns 0.0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0.0);
  });

  it('returns 1.0 for two empty sets', () => {
    expect(jaccardSimilarity([], [])).toBe(1);
  });

  it('returns correct value for partial overlap', () => {
    const sim = jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd']);
    // intersection = {b, c} = 2, union = {a, b, c, d} = 4
    expect(sim).toBeCloseTo(0.5, 5);
  });
});

describe('dedupOperation', () => {
  it('returns ADD for unique content', () => {
    const newEntry = createEntry('Use TypeScript for type safety', 'pattern');
    const existing = [createEntry('Always write tests', 'pattern')];
    const result = dedupOperation(newEntry, existing);
    expect(result.op).toBe('ADD');
  });

  it('returns ADD when no existing entries', () => {
    const newEntry = createEntry('Some content', 'pattern');
    const result = dedupOperation(newEntry, []);
    expect(result.op).toBe('ADD');
  });

  it('returns NOOP for nearly identical content (>0.9 similarity)', () => {
    const content = 'Always use strict TypeScript mode for all projects';
    const newEntry = createEntry(content, 'pattern');
    const existing = [createEntry(content, 'pattern')];
    const result = dedupOperation(newEntry, existing);
    expect(result.op).toBe('NOOP');
  });

  it('returns UPDATE for similar content (0.6-0.9 similarity)', () => {
    const newEntry = createEntry(
      'Use TypeScript strict mode with ESLint for all new projects',
      'pattern',
    );
    const existing = [
      createEntry(
        'Use TypeScript strict mode for all projects',
        'pattern',
      ),
    ];
    const result = dedupOperation(newEntry, existing);
    expect(result.op).toBe('UPDATE');
    expect(result.merged).toBeDefined();
  });
});

describe('mergeEntries', () => {
  it('combines tags and takes max confidence', () => {
    const existing = createEntry('Use ESM', 'pattern', {
      confidence: 0.7,
      tags: ['typescript'],
    });
    const newEntry = createEntry('Use ESM modules', 'pattern', {
      confidence: 0.9,
      tags: ['modules'],
    });
    const merged = mergeEntries(existing, newEntry);
    expect(merged.tags).toContain('typescript');
    expect(merged.tags).toContain('modules');
    expect(merged.confidence).toBe(0.9);
  });

  it('takes longer content', () => {
    const existing = createEntry('Short', 'pattern');
    const newEntry = createEntry('Much longer content string', 'pattern');
    const merged = mergeEntries(existing, newEntry);
    expect(merged.content).toBe('Much longer content string');
  });

  it('increments access_count', () => {
    const existing = { ...createEntry('Content', 'pattern'), access_count: 5 };
    const newEntry = createEntry('Content', 'pattern');
    const merged = mergeEntries(existing, newEntry);
    expect(merged.access_count).toBe(6);
  });

  it('unions related_files', () => {
    const existing = createEntry('Content', 'pattern', { related_files: ['a.ts'] });
    const newEntry = createEntry('Content', 'pattern', { related_files: ['b.ts'] });
    const merged = mergeEntries(existing, newEntry);
    expect(merged.related_files).toContain('a.ts');
    expect(merged.related_files).toContain('b.ts');
  });
});
