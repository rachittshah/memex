import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryEntry, MemoryCategory } from '../core/schema.js';
import type { MemoryStore } from '../core/store.js';
import type { TierManager } from '../core/tiers.js';
import { computeScore } from '../algorithms/scoring.js';

const SECTION_ORDER: MemoryCategory[] = ['preference', 'pattern', 'project', 'decision', 'gotcha', 'tool'];

const SECTION_TITLES: Record<MemoryCategory, string> = {
  preference: 'Preferences',
  pattern: 'Patterns',
  project: 'Project Context',
  decision: 'Decisions',
  gotcha: 'Gotchas',
  tool: 'Tools',
};

function entryLine(entry: MemoryEntry): string {
  const lastDate = entry.last_accessed.split('T')[0];
  return `- ${entry.content} [confidence: ${entry.confidence}, last: ${lastDate}]`;
}

export async function exportToAgentsMd(
  store: MemoryStore,
  _tierManager: TierManager,
  outputDir: string,
): Promise<string> {
  const entries = await store.list({ status: 'active' });
  entries.sort((a, b) => computeScore(b) - computeScore(a));

  const lines: string[] = ['# AGENTS.md — Project Memory (managed by memex)', ''];

  for (const category of SECTION_ORDER) {
    const catEntries = entries.filter((e) => e.category === category);
    if (catEntries.length === 0) continue;

    lines.push(`## ${SECTION_TITLES[category]}`);
    for (const entry of catEntries) {
      lines.push(entryLine(entry));
    }
    lines.push('');
  }

  const metadata = {
    entry_count: entries.length,
    last_updated: new Date().toISOString(),
    version: '1.0.0',
  };
  lines.push(`<!-- memex metadata: ${JSON.stringify(metadata)} -->`);
  lines.push('');

  const content = lines.join('\n');
  const filePath = join(outputDir, 'AGENTS.md');
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}
