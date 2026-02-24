import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryStore } from '../core/store.js';
import type { TierManager } from '../core/tiers.js';
import type { MemoryEntry } from '../core/schema.js';
import { dedupOperation } from '../algorithms/dedup.js';

export interface HookInput {
  transcript_path?: string;
  session_id?: string;
  cwd?: string;
  last_assistant_message?: string;
}

async function addEntriesToStore(
  store: MemoryStore,
  newEntries: MemoryEntry[],
): Promise<number> {
  const existing = await store.loadAll();
  let added = 0;

  for (const entry of newEntries) {
    const result = dedupOperation(entry, existing);
    switch (result.op) {
      case 'ADD':
        await store.add(entry);
        existing.push(entry);
        added++;
        break;
      case 'UPDATE':
        if (result.target && result.merged) {
          await store.update(result.target.id, result.merged);
        }
        added++;
        break;
      case 'DELETE':
        if (result.target) {
          await store.delete(result.target.id);
          await store.add(entry);
          existing.push(entry);
          added++;
        }
        break;
      case 'NOOP':
        break;
    }
  }

  return added;
}

export async function handlePreCompact(
  input: HookInput,
  store: MemoryStore,
  tierManager: TierManager,
): Promise<void> {
  if (!input.transcript_path) return;

  try {
    const { extractFromTranscript } = await import('../llm/extract.js');
    const entries = await extractFromTranscript(input.transcript_path, 'pre-compact');
    if (entries.length === 0) return;

    const added = await addEntriesToStore(store, entries);
    if (added > 0) {
      const { rebuildAll } = await import('../core/index.js');
      await rebuildAll(store, tierManager);
    }
    console.error(`[memex] Pre-compact: extracted ${added} memories`);
  } catch {
    // LLM extraction not available or failed — fall back to regex
    try {
      const { extractFromFile } = await import('./generic.js');
      const entries = await extractFromFile(input.transcript_path);
      const added = await addEntriesToStore(store, entries);
      if (added > 0) {
        const { rebuildAll } = await import('../core/index.js');
        await rebuildAll(store, tierManager);
      }
    } catch {
      // no-op
    }
  }
}

export async function handleStop(
  input: HookInput,
  store: MemoryStore,
  tierManager: TierManager,
): Promise<void> {
  if (!input.last_assistant_message) return;

  try {
    const { extractMemories } = await import('../llm/extract.js');
    const { createEntry } = await import('../core/schema.js');
    const results = await extractMemories(input.last_assistant_message);
    if (results.length === 0) return;

    const entries = results.map((r) =>
      createEntry(r.content, r.category, {
        confidence: r.confidence,
        tags: r.tags,
        source: 'auto',
      }),
    );

    const added = await addEntriesToStore(store, entries);
    if (added > 0) {
      const { rebuildAll } = await import('../core/index.js');
      await rebuildAll(store, tierManager);
    }
    console.error(`[memex] Stop: extracted ${added} memories`);
  } catch {
    // LLM not available — no-op for lightweight stop handler
  }
}

export async function handleSessionEnd(
  input: HookInput,
  store: MemoryStore,
  tierManager: TierManager,
): Promise<void> {
  if (!input.transcript_path) return;

  try {
    const { extractFromTranscript } = await import('../llm/extract.js');
    const entries = await extractFromTranscript(input.transcript_path, 'session-end');
    const added = await addEntriesToStore(store, entries);

    if (added > 0) {
      const { rebuildAll } = await import('../core/index.js');
      await rebuildAll(store, tierManager);
    }

    // Check if consolidation is needed
    const { shouldConsolidate, consolidateEntries } = await import('../llm/consolidate.js');
    const entryCount = await store.count();
    if (shouldConsolidate(entryCount, added)) {
      try {
        const allEntries = await store.list({ status: 'active' });
        const consolidated = await consolidateEntries(allEntries);
        for (const entry of allEntries) {
          await store.delete(entry.id);
        }
        for (const entry of consolidated) {
          await store.add(entry);
        }
        const { rebuildAll } = await import('../core/index.js');
        await rebuildAll(store, tierManager);
        console.error(`[memex] Session-end: consolidated ${allEntries.length} -> ${consolidated.length}`);
      } catch {
        // consolidation is best-effort
      }
    }

    console.error(`[memex] Session-end: extracted ${added} memories`);
  } catch {
    // Fall back to regex-based extraction
    try {
      const { extractFromFile } = await import('./generic.js');
      const entries = await extractFromFile(input.transcript_path);
      const added = await addEntriesToStore(store, entries);
      if (added > 0) {
        const { rebuildAll } = await import('../core/index.js');
        await rebuildAll(store, tierManager);
      }
    } catch {
      // no-op
    }
  }
}

export async function handleSessionStart(
  _input: HookInput,
  tierManager: TierManager,
): Promise<string> {
  const l1 = await tierManager.getL1();
  if (!l1) return '';

  const topics = await tierManager.listL2Topics();
  const snippets: string[] = [];

  for (const topic of topics.slice(0, 5)) {
    const content = await tierManager.getL2(topic);
    if (content) {
      const preview = content.split('\n').slice(0, 10).join('\n');
      snippets.push(preview);
    }
  }

  const parts = ['# memex context', '', l1];
  if (snippets.length > 0) {
    parts.push('', '---', '');
    parts.push(...snippets);
  }

  return parts.join('\n');
}

export async function installHooks(projectDir: string): Promise<void> {
  const claudeDir = join(projectDir, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = await readFile(settingsPath, 'utf-8');
      settings = JSON.parse(raw);
    } catch {
      // start fresh if corrupt
    }
  }

  const hooks = (settings.hooks as Record<string, unknown[]>) ?? {};

  const memexHooks: Record<string, unknown[]> = {
    PreCompact: [
      {
        command: 'memex extract --from-stdin --trigger pre-compact',
        timeout: 30,
      },
    ],
    Stop: [
      {
        command: 'memex extract --from-stdin --trigger stop',
        async: true,
      },
    ],
    SessionEnd: [
      {
        command: 'memex extract --from-stdin --trigger session-end',
        timeout: 60,
      },
    ],
    SessionStart: [
      {
        command: 'memex inject --claude-context',
        timeout: 10,
      },
    ],
  };

  for (const [event, hookList] of Object.entries(memexHooks)) {
    const existing = (hooks[event] as unknown[]) ?? [];
    const hasMemex = existing.some(
      (h) => typeof h === 'object' && h !== null && 'command' in h && String((h as { command: string }).command).startsWith('memex '),
    );
    if (!hasMemex) {
      hooks[event] = [...existing, ...hookList];
    }
  }

  settings.hooks = hooks;

  await mkdir(claudeDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function dispatchHook(
  trigger: string,
  store: MemoryStore,
  tierManager: TierManager,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const payload: HookInput = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

  switch (trigger) {
    case 'pre-compact':
      await handlePreCompact(payload, store, tierManager);
      break;
    case 'stop':
      await handleStop(payload, store, tierManager);
      break;
    case 'session-end':
      await handleSessionEnd(payload, store, tierManager);
      break;
    case 'session-start': {
      const context = await handleSessionStart(payload, tierManager);
      if (context) console.log(context);
      break;
    }
    default:
      console.error(`[memex] Unknown trigger: ${trigger}`);
  }
}
