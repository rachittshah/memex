import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start memex MCP server (stdio)')
    .action(async () => {
      const parentOpts = program.opts();
      const memexDir = resolveMemexDir(parentOpts);

      if (!memexDir) {
        console.error(chalk.red('Error:'), 'No .memex directory found. Run `memex init` first.');
        process.exit(1);
      }

      const { startMcpServer } = await import('../hooks/mcp-server.js');
      startMcpServer(memexDir);
    });
}
