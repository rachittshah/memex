import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryEntry, MemoryCategory } from '../core/schema.js';
import type { MemoryStore } from '../core/store.js';
import type { TierManager } from '../core/tiers.js';
import { computeScore } from '../algorithms/scoring.js';

export interface ClaudeExportResult {
  memoryMdPath: string;
  claudeMdPath?: string;
  lineCount: number;
}

const MAX_LINES = 150;

const SECTION_ORDER: MemoryCategory[] = ['preference', 'pattern', 'project', 'decision', 'gotcha', 'tool'];

const SECTION_TITLES: Record<MemoryCategory, string> = {
  preference: 'Preferences',
  pattern: 'Patterns',
  project: 'Project Context',
  decision: 'Decisions',
  gotcha: 'Gotchas',
  tool: 'Tools',
};

function groupByCategory(entries: MemoryEntry[]): Map<MemoryCategory, MemoryEntry[]> {
  const groups = new Map<MemoryCategory, MemoryEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.category) ?? [];
    list.push(entry);
    groups.set(entry.category, list);
  }
  return groups;
}

export async function exportToClaude(
  store: MemoryStore,
  tierManager: TierManager,
  outputDir: string,
): Promise<ClaudeExportResult> {
  const entries = await store.list({ status: 'active' });

  // Sort by score descending; permanent entries (Infinity decay) first within each category
  entries.sort((a, b) => {
    const aPermanent = a.decay_days === Infinity ? 1 : 0;
    const bPermanent = b.decay_days === Infinity ? 1 : 0;
    if (aPermanent !== bPermanent) return bPermanent - aPermanent;
    return computeScore(b) - computeScore(a);
  });

  const grouped = groupByCategory(entries);

  const lines: string[] = ['# Memory', ''];
  let lineCount = 2;

  for (const category of SECTION_ORDER) {
    const catEntries = grouped.get(category);
    if (!catEntries || catEntries.length === 0) continue;
    if (lineCount + 2 >= MAX_LINES) break;

    lines.push(`## ${SECTION_TITLES[category]}`);
    lineCount++;

    for (const entry of catEntries) {
      if (lineCount + 1 >= MAX_LINES) break;
      lines.push(tierManager.entryToMarkdown(entry));
      lineCount++;
    }

    lines.push('');
    lineCount++;
  }

  const content = lines.join('\n');

  // Write MEMORY.md
  const memoryDir = join(outputDir, '.claude', 'memory');
  await mkdir(memoryDir, { recursive: true });
  const memoryMdPath = join(memoryDir, 'MEMORY.md');
  await writeFile(memoryMdPath, content, 'utf-8');

  // Write CLAUDE.md with top-level summary
  const topCategories = SECTION_ORDER.filter((c) => grouped.has(c));
  const summary = [
    '# Project Memory',
    '',
    `This project uses memex for memory management. ${entries.length} active entries across: ${topCategories.map((c) => SECTION_TITLES[c]).join(', ')}.`,
    '',
    'Detailed memory is in .claude/memory/MEMORY.md.',
    '',
  ].join('\n');

  const claudeMdPath = join(outputDir, 'CLAUDE.md');
  await writeFile(claudeMdPath, summary, 'utf-8');

  return { memoryMdPath, claudeMdPath, lineCount };
}
