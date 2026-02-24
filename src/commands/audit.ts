import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { scoreAll } from '../algorithms/scoring.js';
import { tokenize, jaccardSimilarity } from '../algorithms/dedup.js';
import type { MemoryEntry } from '../core/schema.js';

interface DuplicatePair {
  a: MemoryEntry;
  b: MemoryEntry;
  similarity: number;
}

function findDuplicates(entries: MemoryEntry[], threshold: number): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const tokenCache = new Map<string, string[]>();

  for (const entry of entries) {
    tokenCache.set(entry.id, tokenize(entry.content));
  }

  for (let i = 0; i < entries.length; i++) {
    const tokA = tokenCache.get(entries[i].id)!;
    for (let j = i + 1; j < entries.length; j++) {
      const tokB = tokenCache.get(entries[j].id)!;
      const sim = jaccardSimilarity(tokA, tokB);
      if (sim > threshold) {
        pairs.push({ a: entries[i], b: entries[j], similarity: sim });
      }
    }
  }

  return pairs.sort((x, y) => y.similarity - x.similarity);
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 1) + '\u2026' : str;
}

function flagColor(flag: string): string {
  switch (flag) {
    case 'healthy': return chalk.green(flag);
    case 'stale': return chalk.yellow(flag);
    case 'critical': return chalk.red(flag);
    default: return flag;
  }
}

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('Score all entries and flag problems')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts) => {
      const parentOpts = program.opts();
      const memexDir = resolveMemexDir(parentOpts);

      if (!memexDir) {
        console.error(chalk.red('Error:'), 'No .memex directory found. Run `memex init` first.');
        process.exit(1);
      }

      const store = new MemoryStore(resolve(memexDir, 'archive'));
      const entries = await store.list({ status: 'active' });

      if (entries.length === 0) {
        console.log(chalk.dim('No active entries to audit.'));
        return;
      }

      const scored = scoreAll(entries);
      const duplicates = findDuplicates(entries, 0.6);

      const healthyCount = scored.filter((s) => s.flags === 'healthy').length;
      const staleCount = scored.filter((s) => s.flags === 'stale').length;
      const criticalCount = scored.filter((s) => s.flags === 'critical').length;

      if (opts.json) {
        const output = {
          entries: scored.map((s) => ({
            id: s.entry.id,
            content: s.entry.content,
            category: s.entry.category,
            score: Math.round(s.score * 1000) / 1000,
            flag: s.flags,
          })),
          duplicates: duplicates.map((d) => ({
            a: d.a.id,
            b: d.b.id,
            similarity: Math.round(d.similarity * 1000) / 1000,
          })),
          summary: {
            total: entries.length,
            healthy: healthyCount,
            stale: staleCount,
            critical: criticalCount,
            duplicate_pairs: duplicates.length,
          },
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Table output
      const idW = 10;
      const contentW = 42;
      const catW = 12;
      const scoreW = 7;
      const flagW = 10;

      console.log(
        chalk.dim(
          'ID'.padEnd(idW) +
          'Content'.padEnd(contentW) +
          'Category'.padEnd(catW) +
          'Score'.padEnd(scoreW) +
          'Flag',
        ),
      );
      console.log(chalk.dim('\u2500'.repeat(idW + contentW + catW + scoreW + flagW)));

      for (const s of scored) {
        const id = s.entry.id.slice(0, 8);
        const content = truncate(s.entry.content, 40);
        const score = s.score.toFixed(3);
        console.log(
          `${id.padEnd(idW)}${content.padEnd(contentW)}${s.entry.category.padEnd(catW)}${score.padEnd(scoreW)}${flagColor(s.flags)}`,
        );
      }

      console.log();

      if (duplicates.length > 0) {
        console.log(chalk.yellow('Duplicate pairs (Jaccard > 0.6):'));
        for (const d of duplicates) {
          console.log(
            `  ${d.a.id.slice(0, 8)} <-> ${d.b.id.slice(0, 8)}  similarity: ${d.similarity.toFixed(3)}`,
          );
          console.log(chalk.dim(`    A: ${truncate(d.a.content, 60)}`));
          console.log(chalk.dim(`    B: ${truncate(d.b.content, 60)}`));
        }
        console.log();
      }

      console.log(chalk.bold('Summary:'));
      console.log(`  Total:      ${entries.length}`);
      console.log(`  Healthy:    ${chalk.green(String(healthyCount))}`);
      console.log(`  Stale:      ${chalk.yellow(String(staleCount))}`);
      console.log(`  Critical:   ${chalk.red(String(criticalCount))}`);
      console.log(`  Duplicates: ${duplicates.length} pairs`);
    });
}
