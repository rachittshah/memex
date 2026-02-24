import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { scoreAll } from '../algorithms/scoring.js';
import type { MemexConfig, MemoryCategory, MemoryStatus } from '../core/schema.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show memory store status and health')
    .action(async () => {
      const memexDir = resolveMemexDir(program.opts());
      if (!memexDir) {
        console.error(chalk.red('No .memex directory found.'), 'Run `memex init` first.');
        process.exit(1);
      }

      // Load config
      let config: MemexConfig;
      try {
        const raw = await readFile(join(memexDir, 'config.json'), 'utf-8');
        config = JSON.parse(raw);
      } catch {
        console.error(chalk.red('Could not read config.json'));
        process.exit(1);
      }

      const store = new MemoryStore(join(memexDir, 'archive'));
      const entries = await store.loadAll();
      const scored = scoreAll(entries);

      // Count by category
      const byCategory: Record<string, number> = {};
      for (const e of entries) {
        byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      }

      // Count by status
      const byStatus: Record<string, number> = {};
      for (const e of entries) {
        byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
      }

      // Staleness
      const staleCount = scored.filter((s) => s.flags === 'stale').length;
      const criticalCount = scored.filter((s) => s.flags === 'critical').length;
      const healthyCount = scored.filter((s) => s.flags === 'healthy').length;

      // Token estimate (L1 + L2 chars / 4)
      let tokenEstimate = 0;
      try {
        const indexContent = await readFile(join(memexDir, 'index.md'), 'utf-8');
        tokenEstimate += indexContent.length;
      } catch { /* no index */ }

      // Rough L2 estimate from active entries
      for (const e of entries) {
        if (e.status === 'active') {
          tokenEstimate += e.content.length;
        }
      }
      tokenEstimate = Math.ceil(tokenEstimate / 4);

      // Output
      console.log(chalk.bold('Memex Status'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log(`  Total entries:   ${chalk.cyan(String(entries.length))}`);
      console.log();

      console.log(chalk.bold('  By category:'));
      for (const [cat, count] of Object.entries(byCategory)) {
        console.log(`    ${cat.padEnd(12)} ${chalk.cyan(String(count))}`);
      }
      console.log();

      console.log(chalk.bold('  By status:'));
      for (const [status, count] of Object.entries(byStatus)) {
        console.log(`    ${status.padEnd(12)} ${chalk.cyan(String(count))}`);
      }
      console.log();

      console.log(chalk.bold('  Health:'));
      console.log(`    healthy        ${chalk.green(String(healthyCount))}`);
      console.log(`    stale          ${chalk.yellow(String(staleCount))}`);
      console.log(`    critical       ${chalk.red(String(criticalCount))}`);
      console.log();

      console.log(`  Token budget:    ~${chalk.cyan(String(tokenEstimate))} tokens (L1+L2)`);
      console.log(`  Max L1 lines:    ${config.max_l1_lines}`);
      console.log(`  Max L2 lines:    ${config.max_l2_lines}`);
    });
}
