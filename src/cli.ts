#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { registerInitCommand } from './commands/init.js';
import { registerStatusCommand } from './commands/status.js';
import { registerAddCommand } from './commands/add.js';
import { registerSearchCommand } from './commands/search.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerPruneCommand } from './commands/prune.js';
import { registerExportCommand } from './commands/export.js';
import { registerConsolidateCommand } from './commands/consolidate.js';
import { registerExtractCommand } from './commands/extract.js';
import { registerBenchCommand } from './commands/bench.js';
import { registerServeCommand } from './commands/serve.js';

/**
 * Resolve the .memex directory by checking --dir option,
 * then walking up from cwd to filesystem root.
 * Returns null if not found.
 */
export function resolveMemexDir(opts: { dir?: string }): string | null {
  if (opts.dir) {
    const abs = resolve(opts.dir);
    return existsSync(abs) ? abs : null;
  }

  let current = process.cwd();
  while (true) {
    const candidate = join(current, '.memex');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return null;
}

const program = new Command();
program
  .name('memex')
  .description('OSS Memory Manager for AI Coding Assistants')
  .version('0.1.0')
  .option('--dir <path>', 'Override memex directory (default: .memex in cwd)');

registerInitCommand(program);
registerStatusCommand(program);
registerAddCommand(program);
registerSearchCommand(program);
registerAuditCommand(program);
registerPruneCommand(program);
registerExportCommand(program);
registerConsolidateCommand(program);
registerExtractCommand(program);
registerBenchCommand(program);
registerServeCommand(program);

program.parse();
