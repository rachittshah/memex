import { writeFile } from 'node:fs/promises';
import type { BenchmarkRun } from './runner.js';
import type { AggregateMetrics } from './evaluator.js';

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function fmtNum(n: number, decimals = 3): string {
  return n.toFixed(decimals);
}

function colorize(f1: number, text: string): string {
  // Use ANSI codes directly to avoid async chalk import in sync function
  if (f1 >= 0.5) return `\x1b[32m${text}\x1b[0m`; // green
  if (f1 >= 0.3) return `\x1b[33m${text}\x1b[0m`; // yellow
  return `\x1b[31m${text}\x1b[0m`; // red
}

export function formatReport(runs: BenchmarkRun[], aggregate: AggregateMetrics): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('=== LoCoMo Benchmark Results ===');
  lines.push('');

  // Header
  const header = [
    pad('Baseline', 12),
    pad('Conv', 8),
    pad('F1', 8),
    pad('Prec', 8),
    pad('Recall', 8),
    pad('Tokens', 8),
    pad('Memories', 8),
  ].join(' | ');

  const separator = '-'.repeat(header.length);

  lines.push(header);
  lines.push(separator);

  // Rows
  for (const run of runs) {
    const f1Str = fmtNum(run.f1);
    const row = [
      pad(run.baseline, 12),
      pad(run.conversationId.slice(0, 6), 8),
      pad(colorize(run.f1, f1Str), 8 + 9), // +9 for ANSI escape codes
      pad(fmtNum(run.precision), 8),
      pad(fmtNum(run.recall), 8),
      pad(fmtNum(run.tokenEfficiency), 8),
      pad(String(run.memoryCount), 8),
    ].join(' | ');
    lines.push(row);
  }

  lines.push(separator);

  // Summary
  lines.push('');
  lines.push('--- Aggregate ---');
  lines.push(`  Mean F1:             ${fmtNum(aggregate.meanF1)}`);
  lines.push(`  Median F1:           ${fmtNum(aggregate.medianF1)}`);
  lines.push(`  Std Dev:             ${fmtNum(aggregate.stdDev)}`);
  lines.push(`  Mean Token Eff:      ${fmtNum(aggregate.meanTokenEfficiency)}`);
  lines.push(`  Total Memories:      ${aggregate.totalMemories}`);
  lines.push('');

  return lines.join('\n');
}

export async function exportJSON(runs: BenchmarkRun[], path: string): Promise<void> {
  await writeFile(path, JSON.stringify(runs, null, 2), 'utf-8');
}

export async function exportMarkdown(
  runs: BenchmarkRun[],
  aggregate: AggregateMetrics,
  path: string,
): Promise<void> {
  const lines: string[] = [];

  lines.push('# LoCoMo Benchmark Results');
  lines.push('');
  lines.push('| Baseline | Conversation | F1 | Precision | Recall | Token Eff | Memories |');
  lines.push('|----------|-------------|-----|-----------|--------|-----------|----------|');

  for (const run of runs) {
    lines.push(
      `| ${run.baseline} | ${run.conversationId.slice(0, 8)} | ${fmtNum(run.f1)} | ${fmtNum(run.precision)} | ${fmtNum(run.recall)} | ${fmtNum(run.tokenEfficiency)} | ${run.memoryCount} |`,
    );
  }

  lines.push('');
  lines.push('## Aggregate');
  lines.push('');
  lines.push(`- **Mean F1:** ${fmtNum(aggregate.meanF1)}`);
  lines.push(`- **Median F1:** ${fmtNum(aggregate.medianF1)}`);
  lines.push(`- **Std Dev:** ${fmtNum(aggregate.stdDev)}`);
  lines.push(`- **Mean Token Efficiency:** ${fmtNum(aggregate.meanTokenEfficiency)}`);
  lines.push(`- **Total Memories:** ${aggregate.totalMemories}`);
  lines.push('');

  await writeFile(path, lines.join('\n'), 'utf-8');
}
