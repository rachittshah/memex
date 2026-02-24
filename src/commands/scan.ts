import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { TierManager } from '../core/tiers.js';
import { rebuildAll } from '../core/index.js';
import { scan, detectLanguages, type ScannerBackend } from '../scanner/scanner.js';
import { dedupOperation } from '../algorithms/dedup.js';
import type { SupportedLang } from '../scanner/patterns.js';

export function registerScanCommand(program: Command): void {
  program
    .command('scan [dir]')
    .description('Scan codebase with ast-grep/semgrep to discover conventions and patterns')
    .option('--backend <backend>', 'Scanner backend: ast-grep, semgrep, auto (default: auto)', 'auto')
    .option('--lang <languages>', 'Comma-separated languages to scan (default: auto-detect)')
    .option('--min-matches <n>', 'Minimum pattern matches to create a memory', '0')
    .option('--dry-run', 'Show discovered patterns without saving')
    .option('--exclude <dirs>', 'Comma-separated directories to exclude')
    .action(async (dir, opts) => {
      const parentOpts = program.opts();
      const memexDir = resolveMemexDir(parentOpts);
      const scanDir = dir ? resolve(dir) : process.cwd();

      if (!memexDir && !opts.dryRun) {
        console.error(chalk.red('Error:'), 'No .memex directory found. Run `memex init` first, or use --dry-run.');
        process.exit(1);
      }

      const backend = opts.backend as ScannerBackend;
      const languages = opts.lang
        ? (opts.lang as string).split(',').map((l: string) => l.trim() as SupportedLang)
        : undefined;
      const minMatches = parseInt(opts.minMatches) || undefined;
      const exclude = opts.exclude
        ? (opts.exclude as string).split(',').map((d: string) => d.trim())
        : undefined;

      // Detect languages
      const detectedLangs = languages ?? await detectLanguages(scanDir);
      console.log(chalk.dim(`Scanning ${scanDir}`));
      console.log(chalk.dim(`Languages: ${detectedLangs.join(', ') || 'none detected'}`));
      console.log(chalk.dim(`Backend: ${backend}`));
      console.log();

      try {
        const results = await scan({
          dir: scanDir,
          languages,
          backend,
          exclude,
          minMatches,
        });

        if (results.length === 0) {
          console.log(chalk.yellow('No conventions detected.'));
          console.log(chalk.dim('Try lowering --min-matches or scanning a larger codebase.'));
          return;
        }

        console.log(chalk.bold(`Found ${results.length} convention(s):`));
        console.log();

        let newCount = 0;
        let updateCount = 0;
        let skipCount = 0;

        for (const result of results) {
          const icon = result.antiMatchCount > 0 ? chalk.yellow('~') : chalk.green('+');
          const count = chalk.dim(`(${result.matchCount} matches in ${result.files.length} files)`);
          console.log(`  ${icon} ${result.entry.content} ${count}`);

          if (!opts.dryRun && memexDir) {
            // Dedup against existing entries
            const store = new MemoryStore(resolve(memexDir, 'archive'));
            const existing = await store.loadAll();
            const { op, target, merged } = dedupOperation(result.entry, existing);

            switch (op) {
              case 'ADD':
                await store.add(result.entry);
                newCount++;
                console.log(chalk.dim(`    → Added ${result.entry.id.slice(0, 8)}`));
                break;
              case 'UPDATE':
                if (target && merged) {
                  await store.update(target.id, merged);
                  updateCount++;
                  console.log(chalk.dim(`    → Updated ${target.id.slice(0, 8)}`));
                }
                break;
              case 'NOOP':
                skipCount++;
                console.log(chalk.dim('    → Already known, skipped'));
                break;
              case 'DELETE':
                if (target) {
                  await store.delete(target.id);
                  await store.add(result.entry);
                  newCount++;
                  console.log(chalk.dim(`    → Replaced contradictory ${target.id.slice(0, 8)}`));
                }
                break;
            }
          }
        }

        console.log();
        if (opts.dryRun) {
          console.log(chalk.dim('Dry run — no entries saved. Remove --dry-run to persist.'));
        } else if (memexDir) {
          console.log(`${chalk.green(String(newCount))} new, ${chalk.blue(String(updateCount))} updated, ${chalk.dim(String(skipCount))} skipped`);

          // Rebuild indexes
          const store = new MemoryStore(resolve(memexDir, 'archive'));
          const tierManager = new TierManager(memexDir);
          await rebuildAll(store, tierManager);
          console.log(chalk.dim('Indexes rebuilt.'));
        }
      } catch (err) {
        console.error(chalk.red('Scan failed:'), (err as Error).message);
        process.exit(1);
      }
    });
}
