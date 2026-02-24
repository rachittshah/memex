import { Command } from 'commander';
import { join } from 'node:path';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { TierManager } from '../core/tiers.js';
import { rebuildAll } from '../core/index.js';
import { consolidateEntries } from '../llm/consolidate.js';

export function registerConsolidateCommand(program: Command): void {
  program
    .command('consolidate')
    .description('Consolidate and deduplicate entries using LLM')
    .option('--dry-run', 'Show proposed changes without applying')
    .action(async (opts) => {
      const memexDir = resolveMemexDir(program.opts());
      if (!memexDir) {
        console.error(chalk.red('No .memex directory found.'), 'Run `memex init` first.');
        process.exit(1);
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        console.error(chalk.red('ANTHROPIC_API_KEY environment variable is required.'));
        console.error('Set it with: export ANTHROPIC_API_KEY=sk-...');
        process.exit(1);
      }

      const store = new MemoryStore(join(memexDir, 'archive'));
      const entries = await store.list({ status: 'active' });

      if (entries.length === 0) {
        console.log(chalk.yellow('No active entries to consolidate.'));
        return;
      }

      console.log(chalk.dim(`Before: ${entries.length} entries`));
      console.log(chalk.dim('Consolidating...'));

      const consolidated = await consolidateEntries(entries);

      console.log(chalk.dim(`After:  ${consolidated.length} entries`));

      if (opts.dryRun) {
        console.log(chalk.yellow('\nDry run — no changes applied.'));
        const diff = entries.length - consolidated.length;
        if (diff > 0) {
          console.log(chalk.green(`Would reduce by ${diff} entries.`));
        } else {
          console.log(chalk.dim('No reduction possible.'));
        }
        return;
      }

      // Replace: delete all old entries, write consolidated ones
      for (const entry of entries) {
        await store.delete(entry.id);
      }
      for (const entry of consolidated) {
        await store.add(entry);
      }

      // Rebuild indexes
      const tierManager = new TierManager(memexDir);
      await rebuildAll(store, tierManager);

      const diff = entries.length - consolidated.length;
      if (diff > 0) {
        console.log(chalk.green(`Consolidated: reduced by ${diff} entries.`));
      } else {
        console.log(chalk.dim('No reduction achieved.'));
      }
    });
}
