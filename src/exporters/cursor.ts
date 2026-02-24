import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryStore } from '../core/store.js';
import type { TierManager } from '../core/tiers.js';

export async function exportToCursor(
  store: MemoryStore,
  tierManager: TierManager,
  outputDir: string,
): Promise<string[]> {
  const topics = await tierManager.listL2Topics();
  const rulesDir = join(outputDir, '.cursor', 'rules');
  await mkdir(rulesDir, { recursive: true });

  const createdFiles: string[] = [];

  for (const topic of topics) {
    const content = await tierManager.getL2(topic);
    if (!content) continue;

    const mdc = [
      '---',
      `description: ${topic} memory entries`,
      `globs: ["**/*"]`,
      '---',
      content,
    ].join('\n');

    const filePath = join(rulesDir, `${topic}.mdc`);
    await writeFile(filePath, mdc, 'utf-8');
    createdFiles.push(filePath);
  }

  return createdFiles;
}
