import type { MemoryEntry, MemoryCategory } from './schema.js';
import type { MemoryStore } from './store.js';
import type { TierManager } from './tiers.js';

const MAX_L1_LINES = 80;

const CATEGORY_ORDER: MemoryCategory[] = ['project', 'pattern', 'preference', 'decision', 'gotcha', 'tool'];

const SECTION_TITLES: Record<MemoryCategory, string> = {
  project: 'Projects',
  pattern: 'Patterns',
  preference: 'Preferences',
  decision: 'Decisions',
  gotcha: 'Gotchas',
  tool: 'Tools',
};

function effectiveScore(entry: MemoryEntry): number {
  const age = (Date.now() - new Date(entry.last_accessed).getTime()) / (1000 * 60 * 60 * 24);
  if (entry.decay_days === Infinity || entry.decay_days === 0) {
    return entry.confidence;
  }
  const decay = Math.pow(0.5, age / entry.decay_days);
  return entry.confidence * decay;
}

function groupByCategory(entries: MemoryEntry[]): Map<MemoryCategory, MemoryEntry[]> {
  const groups = new Map<MemoryCategory, MemoryEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.category) ?? [];
    list.push(entry);
    groups.set(entry.category, list);
  }
  return groups;
}

function groupByTag(entries: MemoryEntry[]): Map<string, MemoryEntry[]> {
  const groups = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const tags = entry.tags.length > 0 ? entry.tags : ['general'];
    for (const tag of tags) {
      const list = groups.get(tag) ?? [];
      list.push(entry);
      groups.set(tag, list);
    }
  }
  return groups;
}

export async function buildIndex(store: MemoryStore, tierManager: TierManager): Promise<string> {
  const entries = await store.list({ status: 'active' });

  // Sort all entries by effective score descending
  entries.sort((a, b) => effectiveScore(b) - effectiveScore(a));

  const grouped = groupByCategory(entries);
  const lines: string[] = ['# Memory Index', ''];
  let lineCount = 2;

  for (const category of CATEGORY_ORDER) {
    const catEntries = grouped.get(category);
    if (!catEntries || catEntries.length === 0) continue;

    // Section header takes 2 lines (## Title + blank line after)
    if (lineCount + 2 >= MAX_L1_LINES) break;

    lines.push(`## ${SECTION_TITLES[category]}`);
    lineCount++;

    for (const entry of catEntries) {
      const bullet = tierManager.entryToMarkdown(entry);
      const bulletLines = bullet.split('\n').length;
      if (lineCount + bulletLines >= MAX_L1_LINES) break;
      lines.push(bullet);
      lineCount += bulletLines;
    }

    lines.push('');
    lineCount++;
  }

  // Add quick reference to L2 topics
  const topics = await tierManager.listL2Topics();
  if (topics.length > 0 && lineCount + 3 < MAX_L1_LINES) {
    lines.push('## Quick Reference');
    lineCount++;
    for (const topic of topics) {
      if (lineCount + 1 >= MAX_L1_LINES) break;
      lines.push(`- See topics/${topic}.md for details`);
      lineCount++;
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function rebuildAll(store: MemoryStore, tierManager: TierManager): Promise<void> {
  const entries = await store.list({ status: 'active' });

  // Rebuild L2 topic files from entries grouped by tags
  const tagGroups = groupByTag(entries);

  // Remove old topic files
  const existingTopics = await tierManager.listL2Topics();
  for (const topic of existingTopics) {
    await tierManager.deleteL2(topic);
  }

  // Write new topic files
  for (const [tag, tagEntries] of tagGroups) {
    tagEntries.sort((a, b) => effectiveScore(b) - effectiveScore(a));
    const content = tierManager.markdownToSection(tagEntries, tag);
    if (content) {
      await tierManager.writeL2(tag, content);
    }
  }

  // Rebuild L1 index
  const indexContent = await buildIndex(store, tierManager);
  await tierManager.writeL1(indexContent);
}
