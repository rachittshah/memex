import { Command } from 'commander';
import { join } from 'node:path';
import chalk from 'chalk';
import Fuse from 'fuse.js';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { VALID_CATEGORIES } from '../core/schema.js';
import type { MemoryCategory, MemoryEntry } from '../core/schema.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search memory entries')
    .argument('<query>', 'Search query')
    .option('--tier <tier>', 'Filter by tier: all, l1, l2, l3', 'all')
    .option('--category <cat>', `Filter by category (${VALID_CATEGORIES.join(', ')})`)
    .option('--limit <n>', 'Max results', '10')
    .action(async (query: string, opts) => {
      const memexDir = resolveMemexDir(program.opts());
      if (!memexDir) {
        console.error(chalk.red('No .memex directory found.'), 'Run `memex init` first.');
        process.exit(1);
      }

      const store = new MemoryStore(join(memexDir, 'archive'));
      let entries = await store.loadAll();

      // Filter by category
      if (opts.category) {
        const cat = opts.category as MemoryCategory;
        if (!VALID_CATEGORIES.includes(cat)) {
          console.error(chalk.red(`Invalid category: ${cat}`));
          process.exit(1);
        }
        entries = entries.filter((e) => e.category === cat);
      }

      // Filter active only
      entries = entries.filter((e) => e.status === 'active');

      if (entries.length === 0) {
        console.log(chalk.yellow('No entries to search.'));
        return;
      }

      const fuse = new Fuse(entries, {
        keys: ['content', 'tags'],
        threshold: 0.4,
        includeScore: true,
      });

      const limit = parseInt(opts.limit, 10) || 10;
      const results = fuse.search(query, { limit });

      if (results.length === 0) {
        console.log(chalk.yellow('No matches found.'));
        return;
      }

      console.log(chalk.bold(`Found ${results.length} result(s):\n`));

      for (const result of results) {
        const entry = result.item;
        const score = result.score !== undefined ? (1 - result.score).toFixed(2) : '?';
        const snippet = entry.content.length > 60
          ? entry.content.slice(0, 57) + '...'
          : entry.content;

        console.log(
          chalk.dim(`[${score}]`),
          chalk.cyan(entry.category.padEnd(11)),
          chalk.dim(`(${entry.status})`),
          snippet,
          chalk.dim(`#${entry.id.slice(0, 8)}`),
        );

        // Touch entry to track access
        await store.touch(entry.id);
      }
    });
}
