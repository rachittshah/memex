import { readFile, writeFile, rename, unlink, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryEntry, MemoryStatus, MemoryCategory } from './schema.js';

export interface ListFilter {
  status?: MemoryStatus;
  category?: MemoryCategory;
}

export class MemoryStore {
  private archiveDir: string;

  constructor(archiveDir: string) {
    this.archiveDir = archiveDir;
  }

  private entryPath(id: string): string {
    return join(this.archiveDir, `${id}.json`);
  }

  private tmpPath(id: string): string {
    return join(this.archiveDir, `${id}.json.tmp`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.archiveDir, { recursive: true });
  }

  async add(entry: MemoryEntry): Promise<void> {
    await this.ensureDir();
    const tmp = this.tmpPath(entry.id);
    const dest = this.entryPath(entry.id);
    await writeFile(tmp, JSON.stringify(entry, null, 2), 'utf-8');
    await rename(tmp, dest);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    try {
      const data = await readFile(this.entryPath(id), 'utf-8');
      return JSON.parse(data) as MemoryEntry;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async update(id: string, partial: Partial<MemoryEntry>): Promise<MemoryEntry> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Entry not found: ${id}`);
    }
    const updated: MemoryEntry = {
      ...existing,
      ...partial,
      id, // never allow id override
      updated: new Date().toISOString(),
    };
    await this.add(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(this.entryPath(id));
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // already gone
      }
      throw err;
    }
  }

  async list(filter?: ListFilter): Promise<MemoryEntry[]> {
    const all = await this.loadAll();
    if (!filter) return all;
    return all.filter((entry) => {
      if (filter.status && entry.status !== filter.status) return false;
      if (filter.category && entry.category !== filter.category) return false;
      return true;
    });
  }

  async count(): Promise<number> {
    try {
      const files = await readdir(this.archiveDir);
      return files.filter((f) => f.endsWith('.json') && !f.endsWith('.tmp')).length;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw err;
    }
  }

  async loadAll(): Promise<MemoryEntry[]> {
    let files: string[];
    try {
      files = await readdir(this.archiveDir);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
    const entries: MemoryEntry[] = [];

    for (const file of jsonFiles) {
      try {
        const data = await readFile(join(this.archiveDir, file), 'utf-8');
        entries.push(JSON.parse(data) as MemoryEntry);
      } catch {
        // skip corrupt files
      }
    }

    return entries;
  }

  async touch(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Entry not found: ${id}`);
    }
    const now = new Date().toISOString();
    await this.update(id, {
      access_count: existing.access_count + 1,
      last_accessed: now,
    });
  }
}
