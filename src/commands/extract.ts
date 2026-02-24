import { Command } from 'commander';
import { join } from 'node:path';
import chalk from 'chalk';
import { resolveMemexDir } from '../cli.js';
import { MemoryStore } from '../core/store.js';
import { TierManager } from '../core/tiers.js';
import { rebuildAll } from '../core/index.js';
import { dedupOperation } from '../algorithms/dedup.js';
import { extractFromTranscript, extractFromStdin } from '../llm/extract.js';
import { extractFromFile } from '../hooks/generic.js';
import { shouldConsolidate, consolidateEntries } from '../llm/consolidate.js';

export function registerExtractCommand(program: Command): void {
  program
    .command('extract')
    .description('Extract memories from conversation transcripts')
    .option('--from-stdin', 'Read conversation from stdin (hook mode)')
    .option('--file <path>', 'Read conversation from file')
    .option('--trigger <event>', 'Hook trigger event (pre-compact, stop, session-end)')
    .action(async (opts) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error(chalk.red('ANTHROPIC_API_KEY environment variable is required.'));
        console.error('Set it with: export ANTHROPIC_API_KEY=sk-...');
        process.exit(1);
      }

      const memexDir = resolveMemexDir(program.opts());
      if (!memexDir) {
        console.error(chalk.red('No .memex directory found.'), 'Run `memex init` first.');
        process.exit(1);
      }

      const store = new MemoryStore(join(memexDir, 'archive'));
      const existing = await store.loadAll();
      let newEntries;

      try {
        if (opts.fromStdin) {
          newEntries = await extractFromStdin();
        } else if (opts.file) {
          newEntries = await extractFromFile(opts.file);
        } else {
          console.error(chalk.red('Specify --from-stdin or --file <path>'));
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red('Extraction failed:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }

      if (!newEntries || newEntries.length === 0) {
        console.error(chalk.dim('No memories extracted.'));
        return;
      }

      // Dedup and add
      let addedCount = 0;
      for (const entry of newEntries) {
        const result = dedupOperation(entry, existing);
        switch (result.op) {
          case 'ADD':
            await store.add(entry);
            existing.push(entry);
            addedCount++;
            break;
          case 'UPDATE':
            if (result.target && result.merged) {
              await store.update(result.target.id, result.merged);
            }
            addedCount++;
            break;
          case 'DELETE':
            if (result.target) {
              await store.delete(result.target.id);
              await store.add(entry);
              existing.push(entry);
              addedCount++;
            }
            break;
          case 'NOOP':
            break;
        }
      }

      console.error(chalk.green(`Extracted ${addedCount} memories from ${newEntries.length} candidates.`));

      // Rebuild index
      const tierManager = new TierManager(memexDir);
      await rebuildAll(store, tierManager);

      // Check if consolidation is needed (session-end trigger)
      if (opts.trigger === 'session-end') {
        const entryCount = await store.count();
        if (shouldConsolidate(entryCount, addedCount)) {
          console.error(chalk.dim('Running auto-consolidation...'));
          try {
            const allEntries = await store.list({ status: 'active' });
            const consolidated = await consolidateEntries(allEntries);
            for (const entry of allEntries) {
              await store.delete(entry.id);
            }
            for (const entry of consolidated) {
              await store.add(entry);
            }
            await rebuildAll(store, tierManager);
            console.error(chalk.dim(`Consolidated: ${allEntries.length} -> ${consolidated.length}`));
          } catch (err) {
            console.error(chalk.dim('Auto-consolidation skipped:'), err instanceof Error ? err.message : err);
          }
        }
      }
    });
}
