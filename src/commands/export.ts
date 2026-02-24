import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { TierManager } from '../core/tiers.js';
import { exportToClaude } from '../exporters/claude.js';
import { exportToCursor } from '../exporters/cursor.js';
import { exportToAider } from '../exporters/aider.js';
import { exportToAgentsMd } from '../exporters/agents-md.js';

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Export memory to tool-specific formats')
    .option('--claude', 'Export to Claude Code format (.claude/memory/MEMORY.md + CLAUDE.md)')
    .option('--cursor', 'Export to Cursor format (.cursor/rules/*.mdc)')
    .option('--aider', 'Export to Aider format (CONVENTIONS.md)')
    .option('--agents-md', 'Export to universal AGENTS.md format')
    .option('--all', 'Run all exporters')
    .option('--output <dir>', 'Output directory (default: cwd)')
    .action(async (opts) => {
      const parentOpts = program.opts();
      const memexDir = resolveMemexDir(parentOpts);

      if (!memexDir) {
        console.error(chalk.red('Error:'), 'No .memex directory found. Run `memex init` first.');
        process.exit(1);
      }

      const outputDir = opts.output ? resolve(opts.output) : process.cwd();
      const store = new MemoryStore(resolve(memexDir, 'archive'));
      const tierManager = new TierManager(memexDir);

      const runAll = opts.all;
      const anySelected = opts.claude || opts.cursor || opts.aider || opts.agentsMd;

      if (!runAll && !anySelected) {
        console.error(chalk.yellow('No exporter selected.'), 'Use --claude, --cursor, --aider, --agents-md, or --all.');
        process.exit(1);
      }

      const generated: string[] = [];

      if (runAll || opts.claude) {
        const result = await exportToClaude(store, tierManager, outputDir);
        generated.push(result.memoryMdPath);
        if (result.claudeMdPath) generated.push(result.claudeMdPath);
        console.log(chalk.green('Claude:'), `${result.memoryMdPath} (${result.lineCount} lines)`);
        if (result.claudeMdPath) {
          console.log(chalk.green('Claude:'), result.claudeMdPath);
        }
      }

      if (runAll || opts.cursor) {
        const files = await exportToCursor(store, tierManager, outputDir);
        generated.push(...files);
        console.log(chalk.green('Cursor:'), `${files.length} .mdc files`);
        for (const f of files) {
          console.log(chalk.dim(`  ${f}`));
        }
      }

      if (runAll || opts.aider) {
        const path = await exportToAider(store, tierManager, outputDir);
        generated.push(path);
        console.log(chalk.green('Aider:'), path);
      }

      if (runAll || opts.agentsMd) {
        const path = await exportToAgentsMd(store, tierManager, outputDir);
        generated.push(path);
        console.log(chalk.green('AGENTS.md:'), path);
      }

      console.log();
      console.log(`Generated ${generated.length} file(s).`);
    });
}
