import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/core/store.js';
import { createEntry } from '../src/core/schema.js';

let testDir: string;
let store: MemoryStore;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'memex-test-'));
  const archiveDir = join(testDir, 'archive');
  store = new MemoryStore(archiveDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  it('add() creates a JSON file and get() retrieves it', async () => {
    const entry = createEntry('Use ESM modules', 'pattern');
    await store.add(entry);
    const retrieved = await store.get(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(entry.id);
    expect(retrieved!.content).toBe('Use ESM modules');
  });

  it('get() returns null for nonexistent ID', async () => {
    const result = await store.get('nonexistent-id');
    expect(result).toBeNull();
  });

  it('update() merges partial data and updates timestamp', async () => {
    const entry = createEntry('Original content', 'decision');
    await store.add(entry);

    const before = entry.updated;
    // small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));

    const updated = await store.update(entry.id, { content: 'Updated content', confidence: 0.9 });
    expect(updated.content).toBe('Updated content');
    expect(updated.confidence).toBe(0.9);
    expect(updated.id).toBe(entry.id); // id never changes
    expect(updated.updated).not.toBe(before);
  });

  it('update() throws for nonexistent entry', async () => {
    await expect(store.update('no-such-id', { content: 'x' })).rejects.toThrow('Entry not found');
  });

  it('delete() removes the file', async () => {
    const entry = createEntry('To be deleted', 'gotcha');
    await store.add(entry);
    expect(await store.get(entry.id)).not.toBeNull();
    await store.delete(entry.id);
    expect(await store.get(entry.id)).toBeNull();
  });

  it('delete() does not throw for nonexistent entry', async () => {
    await expect(store.delete('no-such-id')).resolves.toBeUndefined();
  });

  it('list() returns all entries', async () => {
    const e1 = createEntry('First', 'pattern');
    const e2 = createEntry('Second', 'gotcha');
    await store.add(e1);
    await store.add(e2);
    const all = await store.list();
    expect(all).toHaveLength(2);
    const ids = all.map((e) => e.id);
    expect(ids).toContain(e1.id);
    expect(ids).toContain(e2.id);
  });

  it('list() filters by status', async () => {
    const active = createEntry('Active', 'pattern');
    const stale = createEntry('Stale', 'pattern', { status: 'stale' });
    await store.add(active);
    await store.add(stale);
    const result = await store.list({ status: 'active' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(active.id);
  });

  it('list() filters by category', async () => {
    const pattern = createEntry('A pattern', 'pattern');
    const gotcha = createEntry('A gotcha', 'gotcha');
    await store.add(pattern);
    await store.add(gotcha);
    const result = await store.list({ category: 'gotcha' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(gotcha.id);
  });

  it('touch() increments access_count and updates last_accessed', async () => {
    const entry = createEntry('Touchable', 'tool');
    await store.add(entry);
    expect(entry.access_count).toBe(0);

    await new Promise((r) => setTimeout(r, 10));
    await store.touch(entry.id);

    const touched = await store.get(entry.id);
    expect(touched!.access_count).toBe(1);
    expect(new Date(touched!.last_accessed).getTime()).toBeGreaterThan(
      new Date(entry.last_accessed).getTime(),
    );
  });

  it('touch() throws for nonexistent entry', async () => {
    await expect(store.touch('no-such-id')).rejects.toThrow('Entry not found');
  });

  it('count() returns number of entries', async () => {
    expect(await store.count()).toBe(0);
    await store.add(createEntry('one', 'pattern'));
    await store.add(createEntry('two', 'gotcha'));
    expect(await store.count()).toBe(2);
  });

  it('concurrent writes do not corrupt data', async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      createEntry(`Concurrent entry ${i}`, 'pattern'),
    );
    // Write all entries concurrently
    await Promise.all(entries.map((e) => store.add(e)));
    const all = await store.list();
    expect(all).toHaveLength(20);
    // Every entry should be retrievable
    for (const entry of entries) {
      const retrieved = await store.get(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe(entry.content);
    }
  });
});
