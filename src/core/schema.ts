import { v4 as uuidv4 } from 'uuid';

// ── Types ──────────────────────────────────────────────────────────────────

export type MemoryCategory = 'pattern' | 'decision' | 'gotcha' | 'preference' | 'project' | 'tool';
export type MemoryStatus = 'active' | 'stale' | 'archived';
export type MemorySource = 'auto' | 'manual';

export interface MemoryEntry {
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  access_count: number;
  last_accessed: string;
  created: string;
  updated: string;
  decay_days: number;
  source: MemorySource;
  tags: string[];
  related_files: string[];
  status: MemoryStatus;
}

export interface MemexConfig {
  version: string;
  created: string;
  memex_dir: string;
  thresholds: {
    stale: number;
    critical: number;
    dedup: number;
  };
  decay_half_lives: Record<MemoryCategory, number>;
  max_l1_lines: number;
  max_l2_lines: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const VALID_CATEGORIES: MemoryCategory[] = ['pattern', 'decision', 'gotcha', 'preference', 'project', 'tool'];
export const VALID_STATUSES: MemoryStatus[] = ['active', 'stale', 'archived'];
export const VALID_SOURCES: MemorySource[] = ['auto', 'manual'];

export const DEFAULT_HALF_LIVES: Record<MemoryCategory, number> = {
  preference: Infinity,
  decision: 90,
  pattern: 60,
  gotcha: 30,
  project: 14,
  tool: 45,
};

// ── Factory Functions ──────────────────────────────────────────────────────

export interface CreateEntryOpts {
  confidence?: number;
  source?: MemorySource;
  tags?: string[];
  related_files?: string[];
  decay_days?: number;
  status?: MemoryStatus;
}

export function createEntry(
  content: string,
  category: MemoryCategory,
  opts: CreateEntryOpts = {},
): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    content,
    category,
    confidence: opts.confidence ?? 0.8,
    access_count: 0,
    last_accessed: now,
    created: now,
    updated: now,
    decay_days: opts.decay_days ?? DEFAULT_HALF_LIVES[category],
    source: opts.source ?? 'manual',
    tags: opts.tags ?? [],
    related_files: opts.related_files ?? [],
    status: opts.status ?? 'active',
  };
}

export function createDefaultConfig(memexDir: string): MemexConfig {
  return {
    version: '1.0.0',
    created: new Date().toISOString(),
    memex_dir: memexDir,
    thresholds: {
      stale: 0.3,
      critical: 0.1,
      dedup: 0.6,
    },
    decay_half_lives: { ...DEFAULT_HALF_LIVES },
    max_l1_lines: 80,
    max_l2_lines: 100,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

export function validateEntry(entry: MemoryEntry): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!entry.id || typeof entry.id !== 'string') {
    errors.push('id must be a non-empty string');
  }
  if (!entry.content || typeof entry.content !== 'string') {
    errors.push('content must be a non-empty string');
  }
  if (!VALID_CATEGORIES.includes(entry.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (typeof entry.confidence !== 'number' || entry.confidence < 0 || entry.confidence > 1) {
    errors.push('confidence must be a number between 0.0 and 1.0');
  }
  if (typeof entry.access_count !== 'number' || entry.access_count < 0) {
    errors.push('access_count must be a non-negative number');
  }
  if (!entry.last_accessed || isNaN(Date.parse(entry.last_accessed))) {
    errors.push('last_accessed must be a valid ISO-8601 date string');
  }
  if (!entry.created || isNaN(Date.parse(entry.created))) {
    errors.push('created must be a valid ISO-8601 date string');
  }
  if (!entry.updated || isNaN(Date.parse(entry.updated))) {
    errors.push('updated must be a valid ISO-8601 date string');
  }
  if (typeof entry.decay_days !== 'number' || (entry.decay_days < 0 && entry.decay_days !== Infinity)) {
    errors.push('decay_days must be a non-negative number or Infinity');
  }
  if (!VALID_SOURCES.includes(entry.source)) {
    errors.push(`source must be one of: ${VALID_SOURCES.join(', ')}`);
  }
  if (!Array.isArray(entry.tags)) {
    errors.push('tags must be an array');
  }
  if (!Array.isArray(entry.related_files)) {
    errors.push('related_files must be an array');
  }
  if (!VALID_STATUSES.includes(entry.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}
