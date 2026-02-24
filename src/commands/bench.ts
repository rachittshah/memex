import { Command } from 'commander';
import chalk from 'chalk';
import { runBenchmark } from '../bench/runner.js';
import { aggregateMetrics } from '../bench/evaluator.js';
import { formatReport, exportJSON, exportMarkdown } from '../bench/report.js';

const ALL_BASELINES = ['none', 'naive', 'l1', 'l2', 'full'];

export function registerBenchCommand(program: Command): void {
  program
    .command('bench')
    .description('Run LoCoMo benchmark harness')
    .option('--quick', 'Run quick subset (first 2 conversations)')
    .option('--baselines <list>', 'Comma-separated baselines to run (none,naive,l1,l2,full)', 'l1,full')
    .option('--export <path>', 'Export results to file (JSON or Markdown based on extension)')
    .option('--ci', 'CI mode: exit non-zero if mean F1 below threshold')
    .option('--threshold <n>', 'CI regression threshold for mean F1', '0.3')
    .action(async (opts) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error(chalk.red('ANTHROPIC_API_KEY environment variable is required for benchmarks.'));
        console.error('Set it with: export ANTHROPIC_API_KEY=sk-...');
        process.exit(1);
      }

      const baselines = opts.baselines
        .split(',')
        .map((b: string) => b.trim())
        .filter((b: string) => ALL_BASELINES.includes(b));

      if (baselines.length === 0) {
        console.error(chalk.red('No valid baselines specified.'));
        console.error(`Valid baselines: ${ALL_BASELINES.join(', ')}`);
        process.exit(1);
      }

      console.log(chalk.bold('LoCoMo Benchmark'));
      console.log(chalk.dim(`Baselines: ${baselines.join(', ')}`));
      console.log(chalk.dim(`Mode: ${opts.quick ? 'quick' : 'full'}`));
      console.log();

      const runs = await runBenchmark({
        quick: !!opts.quick,
        baselines,
        exportPath: opts.export,
        ciThreshold: opts.ci ? parseFloat(opts.threshold) : undefined,
      });

      const aggregate = aggregateMetrics(runs);
      const report = formatReport(runs, aggregate);
      console.log(report);

      // Export if requested
      if (opts.export) {
        const path = opts.export as string;
        if (path.endsWith('.md')) {
          await exportMarkdown(runs, aggregate, path);
          console.log(chalk.dim(`Results exported to ${path}`));
        } else {
          await exportJSON(runs, path.endsWith('.json') ? path : path + '.json');
          console.log(chalk.dim(`Results exported to ${path}`));
        }
      }

      // CI mode
      if (opts.ci) {
        const threshold = parseFloat(opts.threshold);
        if (aggregate.meanF1 < threshold) {
          console.error(
            chalk.red(`CI FAIL: Mean F1 ${aggregate.meanF1.toFixed(3)} < threshold ${threshold}`),
          );
          process.exit(1);
        } else {
          console.log(
            chalk.green(`CI PASS: Mean F1 ${aggregate.meanF1.toFixed(3)} >= threshold ${threshold}`),
          );
        }
      }
    });
}
