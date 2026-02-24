import { readFile, watch } from 'node:fs/promises';
import { extname } from 'node:path';
import { createEntry } from '../core/schema.js';
import type { MemoryCategory, MemoryEntry } from '../core/schema.js';

export interface TranscriptMessage {
  role: string;
  content: string;
}

export function detectFormat(content: string): 'jsonl' | 'json' | 'text' {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('{')) return 'jsonl';
  return 'text';
}

export function detectFormatFromPath(filePath: string, content: string): 'jsonl' | 'json' | 'text' {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.jsonl') return 'jsonl';
  if (ext === '.json') return 'json';
  if (ext === '.txt' || ext === '.md') return 'text';
  return detectFormat(content);
}

export function parseTranscript(content: string, format: 'jsonl' | 'json' | 'text'): TranscriptMessage[] {
  if (format === 'json') {
    try {
      const arr = JSON.parse(content);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((m: unknown): m is { role: string; content: unknown } => typeof m === 'object' && m !== null && 'role' in m && 'content' in m)
        .map((m) => ({ role: String(m.role), content: String(m.content) }));
    } catch {
      return [];
    }
  }

  if (format === 'jsonl') {
    const messages: TranscriptMessage[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && 'role' in obj && 'content' in obj) {
          messages.push({ role: obj.role, content: String(obj.content) });
        }
      } catch {
        // skip malformed lines
      }
    }
    return messages;
  }

  // text: split by "Human:" / "Assistant:" markers
  const messages: TranscriptMessage[] = [];
  const blocks = content.split(/^(Human|Assistant|User|System):\s*/mi);
  for (let i = 1; i < blocks.length; i += 2) {
    const role = blocks[i].toLowerCase();
    const text = blocks[i + 1]?.trim();
    if (text) {
      messages.push({ role: role === 'human' || role === 'user' ? 'user' : role, content: text });
    }
  }
  return messages;
}

const MEMORY_PATTERNS: { pattern: RegExp; category: MemoryCategory }[] = [
  { pattern: /always\s+(?:use|prefer|do)\b/i, category: 'preference' },
  { pattern: /never\s+(?:use|do)\b/i, category: 'preference' },
  { pattern: /decided\s+to\b/i, category: 'decision' },
  { pattern: /(?:watch out|be careful|gotcha|pitfall|caveat)\b/i, category: 'gotcha' },
  { pattern: /(?:pattern|convention|standard)\b/i, category: 'pattern' },
  { pattern: /(?:project|repo|codebase)\s+(?:uses|is|has)\b/i, category: 'project' },
];

function extractMemoryCandidatesRegex(messages: TranscriptMessage[]): { content: string; category: MemoryCategory }[] {
  const candidates: { content: string; category: MemoryCategory }[] = [];

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;

    const sentences = msg.content.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 10 && s.length < 300);

    for (const sentence of sentences) {
      for (const { pattern, category } of MEMORY_PATTERNS) {
        if (pattern.test(sentence)) {
          candidates.push({ content: sentence, category });
          break;
        }
      }
    }
  }

  return candidates;
}

/**
 * Extract memories from a transcript file.
 * Tries LLM-powered extraction first, falls back to regex-based extraction.
 * Returns MemoryEntry[] (not persisted — caller is responsible for dedup & store).
 */
export async function extractFromFile(filePath: string): Promise<MemoryEntry[]> {
  const raw = await readFile(filePath, 'utf-8');
  const format = detectFormatFromPath(filePath, raw);
  const messages = parseTranscript(raw, format);

  if (messages.length === 0) return [];

  // Try LLM-powered extraction first
  try {
    const { extractMemories } = await import('../llm/extract.js');
    const fullText = messages.map((m) => m.content).join('\n\n');
    const results = await extractMemories(fullText);

    if (results.length > 0) {
      return results.map((r) =>
        createEntry(r.content, r.category, {
          confidence: r.confidence,
          tags: r.tags,
          source: 'auto',
        }),
      );
    }
  } catch {
    // LLM not available — fall through to regex
  }

  // Fallback: regex-based extraction
  const candidates = extractMemoryCandidatesRegex(messages);
  return candidates.map(({ content, category }) =>
    createEntry(content, category, {
      source: 'auto',
      confidence: 0.6,
    }),
  );
}

export async function watchDirectory(
  dir: string,
  callback: (filePath: string) => Promise<void>,
): Promise<void> {
  const watcher = watch(dir, { recursive: false });

  for await (const event of watcher) {
    if (event.eventType === 'rename' && event.filename) {
      const ext = extname(event.filename).toLowerCase();
      if (['.jsonl', '.json', '.txt'].includes(ext)) {
        const filePath = `${dir}/${event.filename}`;
        try {
          await callback(filePath);
        } catch {
          // skip errors for individual files
        }
      }
    }
  }
}
