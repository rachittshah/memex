import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../core/store.js';
import { TierManager } from '../core/tiers.js';
import { rebuildAll } from '../core/index.js';
import { extractMemories } from '../llm/extract.js';
import { createEntry } from '../core/schema.js';
import { loadDataset, parseConversation } from './locomo.js';
import type { LoCoMoConversation, LoCoMoTurn } from './locomo.js';
import { computeF1, computePrecision, computeRecall, tokenize } from './evaluator.js';
import { noneBaseline, naiveBaseline, l1Baseline, l2Baseline, fullBaseline } from './baselines.js';

export interface BenchmarkConfig {
  quick: boolean;
  baselines: string[]; // 'none' | 'naive' | 'l1' | 'l2' | 'full'
  exportPath?: string;
  ciThreshold?: number;
}

export interface BenchmarkRun {
  baseline: string;
  conversationId: string;
  f1: number;
  precision: number;
  recall: number;
  tokenEfficiency: number;
  memoryCount: number;
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

async function answerWithContext(
  client: InstanceType<any>,
  question: string,
  context: string,
): Promise<string> {
  if (!context.trim()) {
    return '';
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Answer the question using ONLY the context provided. Be concise.

Context:
${context}

Question: ${question}

Answer:`,
      },
    ],
  });

  return (
    response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('') || ''
  );
}

function turnsToText(turns: LoCoMoTurn[]): string {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');
}

async function getContext(
  baselineName: string,
  turns: LoCoMoTurn[],
  store: MemoryStore,
  tierManager: TierManager,
  query: string,
): Promise<string> {
  switch (baselineName) {
    case 'none':
      return noneBaseline();
    case 'naive':
      return naiveBaseline(turns);
    case 'l1':
      return l1Baseline(tierManager);
    case 'l2':
      return l2Baseline(tierManager);
    case 'full':
      return fullBaseline(store, tierManager, query);
    default:
      throw new Error(`Unknown baseline: ${baselineName}`);
  }
}

async function processConversation(
  client: InstanceType<any>,
  conv: LoCoMoConversation,
  baselineName: string,
): Promise<BenchmarkRun> {
  // Create temp directory for this run
  const tmpDir = await mkdtemp(join(tmpdir(), 'memex-bench-'));
  const memexDir = join(tmpDir, '.memex');
  const archiveDir = join(memexDir, 'archive');

  const store = new MemoryStore(archiveDir);
  const tierManager = new TierManager(memexDir);

  try {
    const { sessions } = parseConversation(conv);
    const allTurns: LoCoMoTurn[] = [];

    // Feed turns session-by-session (simulate real usage)
    for (const session of sessions) {
      allTurns.push(...session.turns);

      // Run extraction on this session's text
      const sessionText = turnsToText(session.turns);
      const extractions = await extractMemories(sessionText);

      for (const extraction of extractions) {
        const entry = createEntry(extraction.content, extraction.category, {
          confidence: extraction.confidence,
          tags: extraction.tags,
          source: 'auto',
        });
        await store.add(entry);
      }

      // Rebuild index after each session
      await rebuildAll(store, tierManager);
    }

    // Score QA pairs
    const memoryCount = await store.count();
    let totalF1 = 0;
    let totalPrecision = 0;
    let totalRecall = 0;
    let qaCount = 0;

    for (const qa of conv.qa_pairs) {
      const context = await getContext(baselineName, allTurns, store, tierManager, qa.question);
      const predicted = await answerWithContext(client, qa.question, context);

      const predTokens = tokenize(predicted);
      const truthTokens = tokenize(qa.answer);

      const f1 = computeF1(predicted, qa.answer);
      const precision = computePrecision(predTokens, truthTokens);
      const recall = computeRecall(predTokens, truthTokens);

      totalF1 += f1;
      totalPrecision += precision;
      totalRecall += recall;
      qaCount++;
    }

    const avgF1 = qaCount > 0 ? totalF1 / qaCount : 0;
    const avgPrecision = qaCount > 0 ? totalPrecision / qaCount : 0;
    const avgRecall = qaCount > 0 ? totalRecall / qaCount : 0;

    // Token efficiency: ratio of memory tokens to full conversation tokens
    const fullText = turnsToText(allTurns);
    const fullTokens = fullText.split(/\s+/).length;
    const memoryTokens = (await tierManager.getL1()).split(/\s+/).length;
    const tokenEfficiency = fullTokens > 0 ? memoryTokens / fullTokens : 0;

    return {
      baseline: baselineName,
      conversationId: conv.id,
      f1: avgF1,
      precision: avgPrecision,
      recall: avgRecall,
      tokenEfficiency,
      memoryCount,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkRun[]> {
  const client = await getAnthropicClient();
  const conversations = await loadDataset(config.quick);
  const runs: BenchmarkRun[] = [];

  for (const baselineName of config.baselines) {
    for (const conv of conversations) {
      console.log(`  Running ${baselineName} on conversation ${conv.id}...`);
      const run = await processConversation(client, conv, baselineName);
      runs.push(run);
    }
  }

  return runs;
}
