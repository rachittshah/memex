import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { createDefaultConfig } from '../core/schema.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new .memex directory')
    .option('--claude', 'Install Claude Code hooks into .claude/settings.json')
    .option('--force', 'Overwrite existing .memex directory')
    .action(async (opts) => {
      const parentOpts = program.opts();
      const memexDir = parentOpts.dir ? resolve(parentOpts.dir) : join(process.cwd(), '.memex');

      if (existsSync(memexDir) && !opts.force) {
        console.error(chalk.yellow('Warning:'), `.memex already exists at ${memexDir}`);
        console.error('Use --force to overwrite.');
        process.exit(1);
      }

      // Create directory structure
      const topicsDir = join(memexDir, 'topics');
      const archiveDir = join(memexDir, 'archive');
      await mkdir(topicsDir, { recursive: true });
      await mkdir(archiveDir, { recursive: true });

      // Write config.json
      const config = createDefaultConfig(memexDir);
      await writeFile(join(memexDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');

      // Write initial index.md
      await writeFile(
        join(memexDir, 'index.md'),
        '# Memex\n\nProject memory index. Managed by memex.\n',
        'utf-8',
      );

      console.log(chalk.green('Initialized .memex at'), memexDir);
      console.log(`  ${chalk.dim('config.json')}  — configuration`);
      console.log(`  ${chalk.dim('index.md')}     — L1 memory index`);
      console.log(`  ${chalk.dim('topics/')}      — L2 topic files`);
      console.log(`  ${chalk.dim('archive/')}     — L3 entry store`);

      // Install Claude hooks
      if (opts.claude) {
        await installClaudeHooks();
      }
    });
}

async function installClaudeHooks(): Promise<void> {
  const claudeDir = join(process.cwd(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = await readFile(settingsPath, 'utf-8');
      settings = JSON.parse(raw);
    } catch {
      // start fresh if corrupt
    }
  }

  const hooks = (settings.hooks as Record<string, unknown[]>) ?? {};

  const memexHooks: Record<string, unknown> = {
    PreCompact: [
      {
        command: 'memex extract --from-stdin --trigger pre-compact',
        timeout: 30,
      },
    ],
    Stop: [
      {
        command: 'memex extract --from-stdin --trigger stop',
        async: true,
      },
    ],
    SessionEnd: [
      {
        command: 'memex extract --from-stdin --trigger session-end',
        timeout: 60,
      },
    ],
    SessionStart: [
      {
        command: 'memex inject --claude-context',
        timeout: 10,
      },
    ],
  };

  // Merge: add memex hooks without overwriting existing ones
  for (const [event, hookList] of Object.entries(memexHooks)) {
    const existing = (hooks[event] as unknown[]) ?? [];
    hooks[event] = [...existing, ...(hookList as unknown[])];
  }

  settings.hooks = hooks;

  await mkdir(claudeDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  console.log(chalk.green('Installed Claude Code hooks into'), settingsPath);
}
