import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TierManager } from '../src/core/tiers.js';
import { MemoryStore } from '../src/core/store.js';
import { createEntry } from '../src/core/schema.js';
import { buildIndex } from '../src/core/index.js';
import {
  shouldPromoteToL1,
  shouldPromoteToL2,
  shouldDemoteFromL1,
  shouldDemoteFromL2,
} from '../src/algorithms/promote.js';

let testDir: string;
let tiers: TierManager;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'memex-tiers-'));
  tiers = new TierManager(testDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('TierManager L1', () => {
  it('writeL1/getL1 round-trips content', async () => {
    const content = '# Memory Index\n\nSome content here.\n';
    await tiers.writeL1(content);
    const result = await tiers.getL1();
    expect(result).toBe(content);
  });

  it('getL1 returns empty string if index.md does not exist', async () => {
    const result = await tiers.getL1();
    expect(result).toBe('');
  });
});

describe('TierManager L2', () => {
  it('writeL2/getL2 round-trips content for a topic', async () => {
    const content = '## TypeScript\n- Use strict mode\n';
    await tiers.writeL2('typescript', content);
    const result = await tiers.getL2('typescript');
    expect(result).toBe(content);
  });

  it('getL2 returns empty string for nonexistent topic', async () => {
    const result = await tiers.getL2('nonexistent');
    expect(result).toBe('');
  });

  it('listL2Topics() returns topic names', async () => {
    await tiers.writeL2('typescript', '# TS');
    await tiers.writeL2('testing', '# Testing');
    const topics = await tiers.listL2Topics();
    expect(topics).toContain('typescript');
    expect(topics).toContain('testing');
    expect(topics).toHaveLength(2);
  });

  it('listL2Topics() returns empty for no topics', async () => {
    const topics = await tiers.listL2Topics();
    expect(topics).toEqual([]);
  });

  it('deleteL2 removes a topic', async () => {
    await tiers.writeL2('temp', '# Temp');
    await tiers.deleteL2('temp');
    const result = await tiers.getL2('temp');
    expect(result).toBe('');
  });
});

describe('entryToMarkdown', () => {
  it('formats entry as markdown bullet', () => {
    const entry = createEntry('Use strict mode', 'pattern');
    const md = tiers.entryToMarkdown(entry);
    expect(md).toBe('- Use strict mode');
  });

  it('includes tags in brackets', () => {
    const entry = createEntry('Use strict mode', 'pattern', { tags: ['typescript', 'eslint'] });
    const md = tiers.entryToMarkdown(entry);
    expect(md).toBe('- Use strict mode [typescript, eslint]');
  });
});

describe('markdownToSection', () => {
  it('formats a section with title and entries', () => {
    const entries = [
      createEntry('Entry one', 'pattern'),
      createEntry('Entry two', 'pattern'),
    ];
    const section = tiers.markdownToSection(entries, 'Patterns');
    expect(section).toContain('## Patterns');
    expect(section).toContain('- Entry one');
    expect(section).toContain('- Entry two');
  });

  it('returns empty string for no entries', () => {
    const section = tiers.markdownToSection([], 'Empty');
    expect(section).toBe('');
  });
});

describe('buildIndex L1 line limit', () => {
  it('L1 index stays under 80 lines even with many entries', async () => {
    const archiveDir = join(testDir, 'archive');
    const store = new MemoryStore(archiveDir);
    // Add 100 entries to overflow the 80-line limit
    for (let i = 0; i < 100; i++) {
      await store.add(createEntry(`Entry number ${i}`, 'pattern'));
    }
    const indexContent = await buildIndex(store, tiers);
    const lines = indexContent.split('\n');
    expect(lines.length).toBeLessThanOrEqual(80);
  });
});

describe('Promotion/demotion rules', () => {
  it('shouldPromoteToL2 returns true for high access + high confidence', () => {
    const entry = { ...createEntry('Frequent', 'pattern', { confidence: 0.9 }), access_count: 5 };
    expect(shouldPromoteToL2(entry)).toBe(true);
  });

  it('shouldPromoteToL2 returns false for low access count', () => {
    const entry = { ...createEntry('Rare', 'pattern', { confidence: 0.9 }), access_count: 2 };
    expect(shouldPromoteToL2(entry)).toBe(false);
  });

  it('shouldPromoteToL1 returns true for very high access count', () => {
    const entry = { ...createEntry('Very frequent', 'pattern'), access_count: 15 };
    expect(shouldPromoteToL1(entry)).toBe(true);
  });

  it('shouldPromoteToL1 returns false for moderate access count', () => {
    const entry = { ...createEntry('Moderate', 'pattern'), access_count: 8 };
    expect(shouldPromoteToL1(entry)).toBe(false);
  });

  it('shouldDemoteFromL1 returns true for entry not accessed in 30+ days', () => {
    const entry = createEntry('Old', 'pattern');
    entry.last_accessed = new Date(Date.now() - 45 * 86_400_000).toISOString();
    expect(shouldDemoteFromL1(entry)).toBe(true);
  });

  it('shouldDemoteFromL1 returns false for recently accessed entry', () => {
    const entry = createEntry('Recent', 'pattern');
    expect(shouldDemoteFromL1(entry)).toBe(false);
  });

  it('shouldDemoteFromL2 returns true for low-scoring entry', () => {
    const entry = createEntry('Weak', 'project', { confidence: 0.1 });
    entry.last_accessed = new Date(Date.now() - 60 * 86_400_000).toISOString();
    expect(shouldDemoteFromL2(entry)).toBe(true);
  });
});
