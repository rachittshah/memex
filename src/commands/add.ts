import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { createEntry, VALID_CATEGORIES } from '../core/schema.js';
import { dedupOperation } from '../algorithms/dedup.js';
import type { MemoryCategory } from '../core/schema.js';

export function registerAddCommand(program: Command): void {
  program
    .command('add')
    .description('Add a new memory entry')
    .argument('<text>', 'Memory content text')
    .option('--category <cat>', `Category (${VALID_CATEGORIES.join(', ')})`, 'pattern')
    .option('--tags <tags>', 'Comma-separated tags', '')
    .option('--confidence <n>', 'Confidence score 0-1', '0.8')
    .option('--source <src>', 'Source: auto or manual', 'manual')
    .action(async (text: string, opts) => {
      const memexDir = resolveMemexDir(program.opts());
      if (!memexDir) {
        console.error(chalk.red('No .memex directory found.'), 'Run `memex init` first.');
        process.exit(1);
      }

      const category = opts.category as MemoryCategory;
      if (!VALID_CATEGORIES.includes(category)) {
        console.error(chalk.red(`Invalid category: ${category}`));
        console.error(`Valid categories: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }

      const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      const confidence = parseFloat(opts.confidence);
      if (isNaN(confidence) || confidence < 0 || confidence > 1) {
        console.error(chalk.red('Confidence must be between 0 and 1'));
        process.exit(1);
      }

      const entry = createEntry(text, category, {
        confidence,
        tags,
        source: opts.source,
      });

      const store = new MemoryStore(join(memexDir, 'archive'));
      const existing = await store.loadAll();
      const result = dedupOperation(entry, existing);

      switch (result.op) {
        case 'ADD':
          await store.add(entry);
          console.log(chalk.green('Added'), entry.id.slice(0, 8), chalk.dim(`[${category}]`));
          break;

        case 'UPDATE':
          if (result.target && result.merged) {
            await store.update(result.target.id, result.merged);
            console.log(
              chalk.blue('Updated existing entry'),
              result.target.id.slice(0, 8),
              chalk.dim(`[${category}]`),
            );
          }
          break;

        case 'NOOP':
          console.log(
            chalk.yellow('Duplicate detected, skipping.'),
            result.target ? chalk.dim(`Matches ${result.target.id.slice(0, 8)}`) : '',
          );
          break;

        case 'DELETE':
          if (result.target) {
            await store.delete(result.target.id);
            await store.add(entry);
            console.log(
              chalk.red('Replaced contradictory entry'),
              result.target.id.slice(0, 8),
              chalk.dim('->'),
              entry.id.slice(0, 8),
            );
          }
          break;
      }
    });
}
