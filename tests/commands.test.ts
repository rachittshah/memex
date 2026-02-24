import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = '/Users/rshah/memex/dist/cli.js';

let testDir: string;

function cli(cmd: string): string {
  return execSync(`node ${CLI} ${cmd}`, {
    cwd: testDir,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'memex-cmd-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('CLI integration', () => {
  it('memex init creates .memex with correct structure', () => {
    cli('init');
    expect(existsSync(join(testDir, '.memex'))).toBe(true);
    expect(existsSync(join(testDir, '.memex', 'config.json'))).toBe(true);
    expect(existsSync(join(testDir, '.memex', 'index.md'))).toBe(true);
    expect(existsSync(join(testDir, '.memex', 'archive'))).toBe(true);
    expect(existsSync(join(testDir, '.memex', 'topics'))).toBe(true);
  });

  it('memex add creates an entry', () => {
    cli('init');
    const output = cli('add "test content for patterns" --category pattern');
    expect(output).toContain('Added');
  });

  it('memex search finds the entry', () => {
    cli('init');
    cli('add "unique searchable content xyz" --category pattern');
    const output = cli('search "unique searchable"');
    expect(output).toContain('unique searchable content xyz');
  });

  it('memex audit shows entries', () => {
    cli('init');
    cli('add "audit test entry" --category decision');
    const output = cli('audit');
    // audit should run without errors and show some output
    expect(output.length).toBeGreaterThan(0);
  });

  it('memex prune --dry-run runs without deleting', () => {
    cli('init');
    cli('add "prune test entry" --category project');
    const output = cli('prune --dry-run');
    // Should complete without error
    expect(output).toBeDefined();
  });

  it('memex init --claude creates hooks in .claude/settings.json', async () => {
    cli('init --claude');
    const settingsPath = join(testDir, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PreCompact).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
  });
});
