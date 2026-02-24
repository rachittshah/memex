import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { TierManager } from '../core/tiers.js';
import { computeScore } from '../algorithms/scoring.js';
import { rebuildAll } from '../core/index.js';
import type { MemexConfig } from '../core/schema.js';

async function loadConfig(memexDir: string): Promise<MemexConfig | null> {
  try {
    const raw = await readFile(join(memexDir, 'config.json'), 'utf-8');
    return JSON.parse(raw) as MemexConfig;
  } catch {
    return null;
  }
}

export function registerPruneCommand(program: Command): void {
  program
    .command('prune')
    .description('Remove entries below score threshold')
    .option('--threshold <number>', 'Score threshold (default: from config or 0.1)')
    .option('--dry-run', 'Show what would be removed without deleting')
    .option('--hard', 'Permanently delete files instead of archiving')
    .action(async (opts) => {
      const parentOpts = program.opts();
      const memexDir = resolveMemexDir(parentOpts);

      if (!memexDir) {
        console.error(chalk.red('Error:'), 'No .memex directory found. Run `memex init` first.');
        process.exit(1);
      }

      const config = await loadConfig(memexDir);
      const threshold = opts.threshold
        ? parseFloat(opts.threshold)
        : config?.thresholds.critical ?? 0.1;

      const store = new MemoryStore(resolve(memexDir, 'archive'));
      const tierManager = new TierManager(memexDir);
      const entries = await store.list({ status: 'active' });

      const toPrune = entries.filter((e) => computeScore(e) < threshold);

      if (toPrune.length === 0) {
        console.log(chalk.green('Nothing to prune.'), `All ${entries.length} entries score above ${threshold}.`);
        return;
      }

      if (opts.dryRun) {
        console.log(chalk.yellow('Dry run:'), `Would prune ${toPrune.length} of ${entries.length} entries (threshold: ${threshold})`);
        console.log();
        for (const entry of toPrune) {
          const score = computeScore(entry);
          console.log(`  ${chalk.red('x')} ${entry.id.slice(0, 8)}  ${score.toFixed(3)}  ${entry.content.slice(0, 50)}`);
        }
        return;
      }

      let removedCount = 0;
      let bytesFreed = 0;

      for (const entry of toPrune) {
        const contentSize = JSON.stringify(entry).length;
        if (opts.hard) {
          await store.delete(entry.id);
        } else {
          await store.update(entry.id, { status: 'archived' });
        }
        removedCount++;
        bytesFreed += contentSize;
      }

      // Rebuild indexes after pruning
      await rebuildAll(store, tierManager);

      const remaining = entries.length - removedCount;
      const action = opts.hard ? 'Deleted' : 'Archived';

      console.log(chalk.green(`Pruned ${removedCount} entries.`));
      console.log(`  ${action}:   ${removedCount}`);
      console.log(`  Remaining: ${remaining}`);
      console.log(`  Freed:     ~${(bytesFreed / 1024).toFixed(1)} KB`);
    });
}
