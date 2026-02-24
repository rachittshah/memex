import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { validate, type ValidationStatus } from '../scanner/validator.js';
import type { ScannerBackend } from '../scanner/scanner.js';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate [dir]')
    .description('Validate memories against actual code using ast-grep/semgrep')
    .option('--backend <backend>', 'Scanner backend: ast-grep, semgrep, auto (default: auto)', 'auto')
    .option('--json', 'Output as JSON')
    .action(async (dir, opts) => {
      const parentOpts = program.opts();
      const memexDir = resolveMemexDir(parentOpts);

      if (!memexDir) {
        console.error(chalk.red('Error:'), 'No .memex directory found. Run `memex init` first.');
        process.exit(1);
      }

      const scanDir = dir ? resolve(dir) : process.cwd();
      const store = new MemoryStore(resolve(memexDir, 'archive'));
      const entries = await store.list({ status: 'active' });

      if (entries.length === 0) {
        console.log(chalk.yellow('No active memories to validate.'));
        return;
      }

      console.log(chalk.dim(`Validating ${entries.length} memories against ${scanDir}...`));
      console.log();

      try {
        const results = await validate(entries, scanDir, {
          backend: opts.backend as ScannerBackend,
        });

        if (opts.json) {
          const output = results.map((r) => ({
            id: r.entry.id,
            content: r.entry.content.slice(0, 80),
            status: r.status,
            reason: r.reason,
            score: r.score,
            evidence: r.codeEvidence,
          }));
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        // Display results
        const statusIcon: Record<ValidationStatus, string> = {
          confirmed: chalk.green('CONFIRMED'),
          contradicted: chalk.red('CONTRADICTED'),
          unverifiable: chalk.dim('UNVERIFIABLE'),
        };

        const confirmed = results.filter((r) => r.status === 'confirmed');
        const contradicted = results.filter((r) => r.status === 'contradicted');
        const unverifiable = results.filter((r) => r.status === 'unverifiable');

        console.log(chalk.bold('Memory Validation'));
        console.log('─'.repeat(80));

        for (const r of results) {
          const content = r.entry.content.length > 55
            ? r.entry.content.slice(0, 55) + '...'
            : r.entry.content;
          const id = r.entry.id.slice(0, 8);
          console.log(`  ${statusIcon[r.status]}  ${chalk.dim(id)}  ${content}`);
          console.log(`    ${chalk.dim(r.reason)}`);
          if (r.codeEvidence) {
            console.log(chalk.dim(`    ${r.codeEvidence.matchCount} matches, ${r.codeEvidence.files.length} files`));
          }
        }

        console.log();
        console.log('─'.repeat(80));
        console.log(
          `${chalk.green(String(confirmed.length))} confirmed  ` +
          `${chalk.red(String(contradicted.length))} contradicted  ` +
          `${chalk.dim(String(unverifiable.length))} unverifiable`,
        );

        if (contradicted.length > 0) {
          console.log();
          console.log(chalk.yellow('Contradicted memories may be outdated. Consider:'));
          console.log(chalk.dim('  memex prune    — remove low-scoring entries'));
          console.log(chalk.dim('  memex audit    — review all entry scores'));
        }
      } catch (err) {
        console.error(chalk.red('Validation failed:'), (err as Error).message);
        process.exit(1);
      }
    });
}
