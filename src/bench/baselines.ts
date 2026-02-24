import type { MemoryStore } from '../core/store.js';
import type { TierManager } from '../core/tiers.js';
import type { LoCoMoTurn } from './locomo.js';

export function noneBaseline(): string {
  return '';
}

export function naiveBaseline(turns: LoCoMoTurn[]): string {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');
}

export async function l1Baseline(tierManager: TierManager): Promise<string> {
  return tierManager.getL1();
}

export async function l2Baseline(tierManager: TierManager): Promise<string> {
  const l1 = await tierManager.getL1();
  const topics = await tierManager.listL2Topics();

  const l2Parts: string[] = [];
  for (const topic of topics) {
    const content = await tierManager.getL2(topic);
    if (content) {
      l2Parts.push(content);
    }
  }

  return [l1, ...l2Parts].filter(Boolean).join('\n\n');
}

export async function fullBaseline(
  store: MemoryStore,
  tierManager: TierManager,
  query: string,
): Promise<string> {
  const l2Content = await l2Baseline(tierManager);

  // Search L3 archive for query-relevant entries
  const allEntries = await store.list({ status: 'active' });

  // Simple keyword matching for relevance
  const queryTokens = new Set(
    query.toLowerCase().split(/[\s\p{P}]+/u).filter((t) => t.length > 2),
  );

  const relevant = allEntries
    .map((entry) => {
      const entryTokens = entry.content
        .toLowerCase()
        .split(/[\s\p{P}]+/u)
        .filter((t) => t.length > 2);
      const overlap = entryTokens.filter((t) => queryTokens.has(t)).length;
      return { entry, score: overlap };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => `- ${r.entry.content}`);

  return [l2Content, ...relevant].filter(Boolean).join('\n');
}
