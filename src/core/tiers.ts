import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { MemoryEntry } from './schema.js';

export class TierManager {
  private memexDir: string;
  private indexPath: string;
  private topicsDir: string;

  constructor(memexDir: string) {
    this.memexDir = memexDir;
    this.indexPath = join(memexDir, 'index.md');
    this.topicsDir = join(memexDir, 'topics');
  }

  // ── L1: index.md ──────────────────────────────────────────────────────

  async getL1(): Promise<string> {
    try {
      return await readFile(this.indexPath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw err;
    }
  }

  async writeL1(content: string): Promise<void> {
    await mkdir(this.memexDir, { recursive: true });
    await writeFile(this.indexPath, content, 'utf-8');
  }

  // ── L2: topics/{topic}.md ─────────────────────────────────────────────

  async getL2(topic: string): Promise<string> {
    try {
      return await readFile(join(this.topicsDir, `${topic}.md`), 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw err;
    }
  }

  async writeL2(topic: string, content: string): Promise<void> {
    await mkdir(this.topicsDir, { recursive: true });
    await writeFile(join(this.topicsDir, `${topic}.md`), content, 'utf-8');
  }

  async listL2Topics(): Promise<string[]> {
    try {
      const files = await readdir(this.topicsDir);
      return files
        .filter((f) => f.endsWith('.md'))
        .map((f) => basename(f, '.md'));
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async deleteL2(topic: string): Promise<void> {
    try {
      await unlink(join(this.topicsDir, `${topic}.md`));
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }

  // ── Formatting ────────────────────────────────────────────────────────

  entryToMarkdown(entry: MemoryEntry): string {
    const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
    return `- ${entry.content}${tags}`;
  }

  markdownToSection(entries: MemoryEntry[], title: string): string {
    if (entries.length === 0) return '';
    const lines = entries.map((e) => this.entryToMarkdown(e));
    return `## ${title}\n${lines.join('\n')}\n`;
  }
}
