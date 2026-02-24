import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface LoCoMoTurn {
  speaker: string;
  text: string;
  session: number;
}

export interface LoCoMoQAPair {
  question: string;
  answer: string;
  type: string;
}

export interface LoCoMoConversation {
  id: string;
  turns: LoCoMoTurn[];
  qa_pairs: LoCoMoQAPair[];
}

export interface ParsedSession {
  turns: LoCoMoTurn[];
}

const DATASET_URL =
  'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json';

function getCacheDir(): string {
  return join(homedir(), '.memex', 'bench-cache');
}

function getCachePath(): string {
  return join(getCacheDir(), 'locomo10.json');
}

export async function downloadDataset(): Promise<string> {
  const cacheDir = getCacheDir();
  const cachePath = getCachePath();

  // Check if already cached
  try {
    const existing = await readFile(cachePath, 'utf-8');
    if (existing.length > 0) return cachePath;
  } catch {
    // not cached yet
  }

  await mkdir(cacheDir, { recursive: true });

  const response = await fetch(DATASET_URL);
  if (!response.ok) {
    throw new Error(`Failed to download LoCoMo dataset: ${response.status} ${response.statusText}`);
  }

  const data = await response.text();
  await writeFile(cachePath, data, 'utf-8');
  return cachePath;
}

export async function loadDataset(quick?: boolean): Promise<LoCoMoConversation[]> {
  const cachePath = await downloadDataset();
  const raw = await readFile(cachePath, 'utf-8');
  const data = JSON.parse(raw) as LoCoMoConversation[];

  if (quick) {
    return data.slice(0, 2);
  }

  return data;
}

export function parseConversation(conv: LoCoMoConversation): { sessions: ParsedSession[] } {
  const sessionMap = new Map<number, LoCoMoTurn[]>();

  for (const turn of conv.turns) {
    const list = sessionMap.get(turn.session) ?? [];
    list.push(turn);
    sessionMap.set(turn.session, list);
  }

  // Sort by session number
  const sessionNumbers = [...sessionMap.keys()].sort((a, b) => a - b);
  const sessions: ParsedSession[] = sessionNumbers.map((num) => ({
    turns: sessionMap.get(num)!,
  }));

  return { sessions };
}
