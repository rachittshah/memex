import { MemoryEntry, MemoryCategory, VALID_CATEGORIES, createEntry } from '../core/schema.js';

interface ConsolidatedResult {
  content: string;
  category: MemoryCategory;
  confidence: number;
  tags: string[];
}

async function getAnthropicClient(): Promise<any> {
  try {
    // Dynamic import — @anthropic-ai/sdk is an optional dependency
    const mod = await import(/* webpackIgnore: true */ '@anthropic-ai/sdk' as string);
    const Anthropic = mod.default ?? mod;
    return new Anthropic();
  } catch {
    throw new Error(
      'Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk'
    );
  }
}

const CONSOLIDATION_PROMPT = `Merge these related memory entries into fewer, consolidated entries.
Resolve contradictions (prefer newer).
Preserve important details.
Return JSON array of consolidated entries: [{content, category, confidence, tags}]
where category is one of: pattern, decision, gotcha, preference, project, tool
confidence is a number between 0 and 1
tags is an array of short keyword strings

Return ONLY valid JSON. No markdown fences, no explanation.`;

function groupByPrimaryTag(entries: MemoryEntry[]): Map<string, MemoryEntry[]> {
  const groups = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const key = entry.tags.length > 0 ? entry.tags[0] : entry.category;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return groups;
}

function parseConsolidationResponse(text: string): ConsolidatedResult[] {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const results: ConsolidatedResult[] = [];
  for (const item of parsed) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof item.content === 'string' &&
      item.content.length > 0 &&
      VALID_CATEGORIES.includes(item.category) &&
      typeof item.confidence === 'number' &&
      item.confidence >= 0 &&
      item.confidence <= 1 &&
      Array.isArray(item.tags)
    ) {
      results.push({
        content: item.content,
        category: item.category as MemoryCategory,
        confidence: item.confidence,
        tags: item.tags.filter((t: unknown) => typeof t === 'string'),
      });
    }
  }

  return results;
}

export async function consolidateEntries(entries: MemoryEntry[]): Promise<MemoryEntry[]> {
  const client = await getAnthropicClient();
  const groups = groupByPrimaryTag(entries);
  const consolidated: MemoryEntry[] = [];

  for (const [_key, groupEntries] of groups) {
    if (groupEntries.length <= 3) {
      consolidated.push(...groupEntries);
      continue;
    }

    const entriesJson = groupEntries.map((e) => ({
      content: e.content,
      category: e.category,
      confidence: e.confidence,
      tags: e.tags,
      created: e.created,
    }));

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `${CONSOLIDATION_PROMPT}\n\n---\n\n${JSON.stringify(entriesJson, null, 2)}`,
        },
      ],
    });

    const responseText =
      response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('') || '';

    const results = parseConsolidationResponse(responseText);

    if (results.length > 0) {
      consolidated.push(
        ...results.map((r) =>
          createEntry(r.content, r.category, {
            confidence: r.confidence,
            tags: r.tags,
            source: 'auto',
          }),
        ),
      );
    } else {
      // If LLM consolidation failed, keep originals
      consolidated.push(...groupEntries);
    }
  }

  return consolidated;
}

export function shouldConsolidate(entryCount: number, extractionCount: number): boolean {
  return entryCount > 80 || extractionCount % 10 === 0;
}
