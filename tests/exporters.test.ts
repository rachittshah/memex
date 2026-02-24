import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/core/store.js';
import { TierManager } from '../src/core/tiers.js';
import { createEntry } from '../src/core/schema.js';
import { exportToClaude } from '../src/exporters/claude.js';
import { exportToAgentsMd } from '../src/exporters/agents-md.js';
import { exportToAider } from '../src/exporters/aider.js';
import { exportToCursor } from '../src/exporters/cursor.js';

let testDir: string;
let store: MemoryStore;
let tierManager: TierManager;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'memex-export-'));
  const memexDir = join(testDir, '.memex');
  const archiveDir = join(memexDir, 'archive');
  store = new MemoryStore(archiveDir);
  tierManager = new TierManager(memexDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function seedEntries() {
  const categories = ['pattern', 'decision', 'gotcha', 'preference', 'project', 'tool'] as const;
  for (const cat of categories) {
    await store.add(createEntry(`Test ${cat} entry`, cat, { tags: [cat] }));
  }
}

describe('exportToClaude', () => {
  it('produces MEMORY.md under 150 lines', async () => {
    await seedEntries();
    const result = await exportToClaude(store, tierManager, testDir);
    expect(result.lineCount).toBeLessThan(150);
    expect(result.memoryMdPath).toContain('MEMORY.md');
  });

  it('includes all category sections', async () => {
    await seedEntries();
    await exportToClaude(store, tierManager, testDir);
    const content = await readFile(join(testDir, '.claude', 'memory', 'MEMORY.md'), 'utf-8');
    expect(content).toContain('## Preferences');
    expect(content).toContain('## Patterns');
    expect(content).toContain('## Project Context');
    expect(content).toContain('## Decisions');
    expect(content).toContain('## Gotchas');
    expect(content).toContain('## Tools');
  });

  it('creates CLAUDE.md summary file', async () => {
    await seedEntries();
    const result = await exportToClaude(store, tierManager, testDir);
    expect(result.claudeMdPath).toContain('CLAUDE.md');
    const content = await readFile(result.claudeMdPath!, 'utf-8');
    expect(content).toContain('Project Memory');
    expect(content).toContain('memex');
  });
});

describe('exportToAgentsMd', () => {
  it('includes metadata comment', async () => {
    await seedEntries();
    const filePath = await exportToAgentsMd(store, tierManager, testDir);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('<!-- memex metadata:');
    expect(content).toContain('"entry_count"');
    expect(content).toContain('"version"');
  });

  it('includes category sections', async () => {
    await seedEntries();
    const filePath = await exportToAgentsMd(store, tierManager, testDir);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('## Preferences');
    expect(content).toContain('## Patterns');
  });
});

describe('exportToAider', () => {
  it('produces CONVENTIONS.md', async () => {
    await seedEntries();
    const filePath = await exportToAider(store, tierManager, testDir);
    expect(filePath).toContain('CONVENTIONS.md');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('# CONVENTIONS');
    expect(content).toContain('Project conventions managed by memex');
  });

  it('includes entries from all categories', async () => {
    await seedEntries();
    const filePath = await exportToAider(store, tierManager, testDir);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('Test pattern entry');
    expect(content).toContain('Test preference entry');
  });
});

describe('exportToCursor', () => {
  it('produces .mdc files with frontmatter for each topic', async () => {
    await seedEntries();
    // Write L2 topics so cursor exporter has something to export
    await tierManager.writeL2('typescript', '## TypeScript\n- Use strict mode\n');
    await tierManager.writeL2('testing', '## Testing\n- Write unit tests\n');

    const files = await exportToCursor(store, tierManager, testDir);
    expect(files.length).toBe(2);

    for (const filePath of files) {
      expect(filePath).toMatch(/\.mdc$/);
      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('description:');
      expect(content).toContain('globs:');
    }
  });

  it('returns empty array when no L2 topics exist', async () => {
    const files = await exportToCursor(store, tierManager, testDir);
    expect(files).toEqual([]);
  });
});
