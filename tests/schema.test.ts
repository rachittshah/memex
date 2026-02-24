import { describe, it, expect } from 'vitest';
import {
  createEntry,
  validateEntry,
  DEFAULT_HALF_LIVES,
  type MemoryEntry,
  type MemoryCategory,
} from '../src/core/schema.js';

describe('createEntry', () => {
  it('produces a valid MemoryEntry with UUID, timestamps, and defaults', () => {
    const entry = createEntry('Always use strict mode', 'pattern');
    expect(entry.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entry.content).toBe('Always use strict mode');
    expect(entry.category).toBe('pattern');
    expect(entry.confidence).toBe(0.8);
    expect(entry.access_count).toBe(0);
    expect(entry.source).toBe('manual');
    expect(entry.tags).toEqual([]);
    expect(entry.related_files).toEqual([]);
    expect(entry.status).toBe('active');
    expect(new Date(entry.created).getTime()).not.toBeNaN();
    expect(new Date(entry.updated).getTime()).not.toBeNaN();
    expect(new Date(entry.last_accessed).getTime()).not.toBeNaN();
  });

  it('uses correct decay_days for each category', () => {
    const categories: MemoryCategory[] = ['pattern', 'decision', 'gotcha', 'preference', 'project', 'tool'];
    for (const cat of categories) {
      const entry = createEntry(`test ${cat}`, cat);
      expect(entry.decay_days).toBe(DEFAULT_HALF_LIVES[cat]);
    }
  });

  it('uses Infinity decay_days for preference category', () => {
    const entry = createEntry('Use dark mode', 'preference');
    expect(entry.decay_days).toBe(Infinity);
  });

  it('respects opts overrides', () => {
    const entry = createEntry('custom', 'pattern', {
      confidence: 0.5,
      source: 'auto',
      tags: ['typescript'],
      related_files: ['src/index.ts'],
      decay_days: 100,
      status: 'stale',
    });
    expect(entry.confidence).toBe(0.5);
    expect(entry.source).toBe('auto');
    expect(entry.tags).toEqual(['typescript']);
    expect(entry.related_files).toEqual(['src/index.ts']);
    expect(entry.decay_days).toBe(100);
    expect(entry.status).toBe('stale');
  });
});

describe('validateEntry', () => {
  function makeValid(): MemoryEntry {
    return createEntry('Valid content', 'pattern');
  }

  it('accepts a valid entry', () => {
    const result = validateEntry(makeValid());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects invalid category', () => {
    const entry = { ...makeValid(), category: 'invalid' as MemoryCategory };
    const result = validateEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('category'))).toBe(true);
  });

  it('rejects confidence > 1', () => {
    const entry = { ...makeValid(), confidence: 1.5 };
    const result = validateEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
  });

  it('rejects confidence < 0', () => {
    const entry = { ...makeValid(), confidence: -0.1 };
    const result = validateEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
  });

  it('rejects empty content', () => {
    const entry = { ...makeValid(), content: '' };
    const result = validateEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('content'))).toBe(true);
  });
});
