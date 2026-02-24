import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryCategory } from '../core/schema.js';
import type { MemoryStore } from '../core/store.js';
import type { TierManager } from '../core/tiers.js';
import { computeScore } from '../algorithms/scoring.js';

const SECTION_ORDER: MemoryCategory[] = ['preference', 'pattern', 'decision', 'gotcha', 'project', 'tool'];

const SECTION_TITLES: Record<MemoryCategory, string> = {
  preference: 'Preferences',
  pattern: 'Patterns',
  decision: 'Decisions',
  gotcha: 'Gotchas',
  project: 'Projects',
  tool: 'Tools',
};

export async function exportToAider(
  store: MemoryStore,
  tierManager: TierManager,
  outputDir: string,
): Promise<string> {
  const entries = await store.list({ status: 'active' });
  entries.sort((a, b) => computeScore(b) - computeScore(a));

  const sections: string[] = ['# CONVENTIONS', '', 'Project conventions managed by memex.', ''];

  for (const category of SECTION_ORDER) {
    const catEntries = entries.filter((e) => e.category === category);
    if (catEntries.length === 0) continue;

    const section = tierManager.markdownToSection(catEntries, SECTION_TITLES[category]);
    if (section) {
      sections.push(section);
    }
  }

  const content = sections.join('\n');
  const filePath = join(outputDir, 'CONVENTIONS.md');
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}
