import { readFile } from 'node:fs/promises';
import { MemoryEntry, MemoryCategory, VALID_CATEGORIES, createEntry } from '../core/schema.js';

export interface ExtractionResult {
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

export function chunkText(text: string, maxChars = 6000): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [''];
}

const EXTRACTION_PROMPT = `Extract salient memories from this conversation segment. Focus on:
- Patterns: recurring approaches or conventions
- Decisions: architectural or design choices made
- Gotchas: bugs, pitfalls, or things that didn't work
- Preferences: user preferences for tools, styles, workflows
- Project: project-specific context (structure, dependencies, setup)
- Tool: tool-specific knowledge (commands, configs, integrations)

Return as JSON array: [{content, category, confidence, tags}]
where category is one of: pattern, decision, gotcha, preference, project, tool
confidence is a number between 0 and 1
tags is an array of short keyword strings

Return ONLY valid JSON. No markdown fences, no explanation.`;

function parseExtractionResponse(text: string): ExtractionResult[] {
  // Strip markdown code fences if present
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

  const results: ExtractionResult[] = [];
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

export async function extractMemories(text: string): Promise<ExtractionResult[]> {
  const client = await getAnthropicClient();
  const chunks = chunkText(text);
  const allResults: ExtractionResult[] = [];

  for (const chunk of chunks) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\n---\n\n${chunk}`,
        },
      ],
    });

    const responseText =
      response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('') || '';

    const results = parseExtractionResponse(responseText);
    allResults.push(...results);
  }

  return allResults;
}

export async function extractFromTranscript(
  transcriptPath: string,
  _trigger: string,
): Promise<MemoryEntry[]> {
  const raw = await readFile(transcriptPath, 'utf-8');
  const lines = raw.trim().split('\n');

  const parts: string[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { role?: string; content?: string };
      if (parsed.content) {
        parts.push(parsed.content);
      }
    } catch {
      // skip malformed lines
    }
  }

  const fullText = parts.join('\n\n');
  const results = await extractMemories(fullText);

  return results.map((r) =>
    createEntry(r.content, r.category, {
      confidence: r.confidence,
      tags: r.tags,
      source: 'auto',
    }),
  );
}

export async function extractFromStdin(): Promise<MemoryEntry[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = Buffer.concat(chunks).toString('utf-8');
  const data = JSON.parse(input) as {
    transcript_path?: string;
    session_id?: string;
    cwd?: string;
    last_assistant_message?: string;
  };

  if (data.transcript_path) {
    return extractFromTranscript(data.transcript_path, 'stdin');
  }

  if (data.last_assistant_message) {
    const results = await extractMemories(data.last_assistant_message);
    return results.map((r) =>
      createEntry(r.content, r.category, {
        confidence: r.confidence,
        tags: r.tags,
        source: 'auto',
      }),
    );
  }

  return [];
}
