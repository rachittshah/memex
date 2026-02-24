/**
 * Scanner benchmark — compares ast-grep vs semgrep performance.
 * Measures speed, match counts, and pattern coverage on a given codebase.
 */
import { performance } from 'node:perf_hooks';
import { scan, detectLanguages, type ScanResult } from '../scanner/scanner.js';
import type { SupportedLang } from '../scanner/patterns.js';
import { getPatternsForLang } from '../scanner/patterns.js';

export interface BackendResult {
  backend: 'ast-grep' | 'semgrep';
  languages: SupportedLang[];
  durationMs: number;
  patternCount: number;
  totalMatches: number;
  patternsDetected: number;
  results: ScanResult[];
}

export interface PatternComparison {
  name: string;
  astGrepMatches: number | null;
  semgrepMatches: number | null;
  agreement: 'match' | 'close' | 'divergent' | 'exclusive';
}

export interface ScannerBenchResult {
  dir: string;
  languages: SupportedLang[];
  astGrep: BackendResult | null;
  semgrep: BackendResult | null;
  patterns: PatternComparison[];
  summary: {
    speedRatio: number | null;
    coverageAstGrep: number;
    coverageSemgrep: number;
    agreementRate: number;
  };
}

async function runBackend(
  backend: 'ast-grep' | 'semgrep',
  dir: string,
  languages: SupportedLang[],
): Promise<BackendResult | null> {
  const start = performance.now();
  try {
    const results = await scan({ dir, languages, backend });
    const elapsed = performance.now() - start;

    let totalPatterns = 0;
    for (const lang of languages) {
      totalPatterns += getPatternsForLang(lang).length;
    }

    return {
      backend,
      languages,
      durationMs: Math.round(elapsed),
      patternCount: totalPatterns,
      totalMatches: results.reduce((sum, r) => sum + r.matchCount, 0),
      patternsDetected: results.length,
      results,
    };
  } catch {
    return null;
  }
}

function classifyAgreement(a: number | null, b: number | null): PatternComparison['agreement'] {
  if (a === null || b === null) return 'exclusive';
  if (a === b) return 'match';
  const max = Math.max(a, b);
  if (max === 0) return 'match';
  const diff = Math.abs(a - b) / max;
  if (diff <= 0.2) return 'close';
  return 'divergent';
}

export async function benchmarkScanners(dir: string): Promise<ScannerBenchResult> {
  const allLanguages = await detectLanguages(dir);

  // ast-grep only supports TS/JS
  const astGrepLangs = allLanguages.filter(
    (l): l is 'typescript' | 'javascript' => l === 'typescript' || l === 'javascript',
  );

  // Run sequentially for fair timing comparison
  const astGrepResult = astGrepLangs.length > 0
    ? await runBackend('ast-grep', dir, astGrepLangs)
    : null;
  const semgrepResult = await runBackend('semgrep', dir, allLanguages);

  // Build pattern comparison (only for shared languages, deduplicated by name)
  const sharedLangs = astGrepLangs; // ast-grep is the smaller set
  const comparisons: PatternComparison[] = [];
  const seen = new Set<string>();

  for (const lang of sharedLangs) {
    const patterns = getPatternsForLang(lang);
    for (const pat of patterns) {
      if (seen.has(pat.name)) continue;
      seen.add(pat.name);

      // Sum matches across all results for this pattern name
      const agMatches = astGrepResult?.results
        .filter((r) => r.pattern.name === pat.name)
        .reduce((sum, r) => sum + r.matchCount, 0) ?? null;
      const sgMatches = semgrepResult?.results
        .filter((r) => r.pattern.name === pat.name)
        .reduce((sum, r) => sum + r.matchCount, 0) ?? null;

      const agCount = astGrepResult ? (agMatches ?? 0) : null;
      const sgCount = semgrepResult ? (sgMatches ?? 0) : null;

      comparisons.push({
        name: pat.name,
        astGrepMatches: agCount,
        semgrepMatches: sgCount,
        agreement: classifyAgreement(agCount, sgCount),
      });
    }
  }

  // Summary stats
  const agreementCount = comparisons.filter(
    (c) => c.agreement === 'match' || c.agreement === 'close',
  ).length;

  let totalSharedPatterns = 0;
  for (const lang of sharedLangs) {
    totalSharedPatterns += getPatternsForLang(lang).length;
  }

  let totalAllPatterns = 0;
  for (const lang of allLanguages) {
    totalAllPatterns += getPatternsForLang(lang).length;
  }

  return {
    dir,
    languages: allLanguages,
    astGrep: astGrepResult,
    semgrep: semgrepResult,
    patterns: comparisons,
    summary: {
      speedRatio:
        astGrepResult && semgrepResult && semgrepResult.durationMs > 0
          ? semgrepResult.durationMs / astGrepResult.durationMs
          : null,
      coverageAstGrep: totalSharedPatterns > 0 && astGrepResult
        ? astGrepResult.patternsDetected / totalSharedPatterns
        : 0,
      coverageSemgrep: totalAllPatterns > 0 && semgrepResult
        ? semgrepResult.patternsDetected / totalAllPatterns
        : 0,
      agreementRate: comparisons.length > 0 ? agreementCount / comparisons.length : 0,
    },
  };
}

export function formatScannerBench(result: ScannerBenchResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('=== Scanner Benchmark: ast-grep vs semgrep ===');
  lines.push('');
  lines.push(`Directory:  ${result.dir}`);
  lines.push(`Languages:  ${result.languages.join(', ')}`);
  lines.push('');

  // Backend summary table
  lines.push('--- Backend Performance ---');
  lines.push('');
  lines.push(
    `${'Backend'.padEnd(12)} | ${'Time'.padEnd(10)} | ${'Patterns'.padEnd(10)} | ${'Detected'.padEnd(10)} | ${'Matches'.padEnd(10)} | ${'Languages'.padEnd(20)}`,
  );
  lines.push('-'.repeat(82));

  if (result.astGrep) {
    lines.push(
      `${'ast-grep'.padEnd(12)} | ${(result.astGrep.durationMs + 'ms').padEnd(10)} | ${String(result.astGrep.patternCount).padEnd(10)} | ${String(result.astGrep.patternsDetected).padEnd(10)} | ${String(result.astGrep.totalMatches).padEnd(10)} | ${result.astGrep.languages.join(', ').padEnd(20)}`,
    );
  } else {
    lines.push(`${'ast-grep'.padEnd(12)} | ${'N/A'.padEnd(10)} | (not available)`.padEnd(82));
  }

  if (result.semgrep) {
    lines.push(
      `${'semgrep'.padEnd(12)} | ${(result.semgrep.durationMs + 'ms').padEnd(10)} | ${String(result.semgrep.patternCount).padEnd(10)} | ${String(result.semgrep.patternsDetected).padEnd(10)} | ${String(result.semgrep.totalMatches).padEnd(10)} | ${result.semgrep.languages.join(', ').padEnd(20)}`,
    );
  } else {
    lines.push(`${'semgrep'.padEnd(12)} | ${'N/A'.padEnd(10)} | (not available)`.padEnd(82));
  }

  lines.push('');

  // Pattern comparison (only if both backends ran)
  if (result.patterns.length > 0) {
    lines.push('--- Pattern Comparison (shared languages) ---');
    lines.push('');
    lines.push(
      `${'Pattern'.padEnd(28)} | ${'ast-grep'.padEnd(10)} | ${'semgrep'.padEnd(10)} | ${'Agreement'.padEnd(10)}`,
    );
    lines.push('-'.repeat(66));

    for (const p of result.patterns) {
      const ag = p.astGrepMatches !== null ? String(p.astGrepMatches) : 'N/A';
      const sg = p.semgrepMatches !== null ? String(p.semgrepMatches) : 'N/A';
      const emoji =
        p.agreement === 'match' ? '\x1b[32m=\x1b[0m' :
        p.agreement === 'close' ? '\x1b[33m~\x1b[0m' :
        p.agreement === 'divergent' ? '\x1b[31m!\x1b[0m' :
        '\x1b[90m-\x1b[0m';
      lines.push(
        `${p.name.padEnd(28)} | ${ag.padEnd(10)} | ${sg.padEnd(10)} | ${emoji} ${p.agreement}`,
      );
    }

    lines.push('');
  }

  // Summary
  lines.push('--- Summary ---');
  lines.push('');

  if (result.summary.speedRatio !== null) {
    const faster = result.summary.speedRatio > 1 ? 'ast-grep' : 'semgrep';
    const ratio = result.summary.speedRatio > 1
      ? result.summary.speedRatio.toFixed(1)
      : (1 / result.summary.speedRatio).toFixed(1);
    lines.push(`  Speed:      ${faster} is ${ratio}x faster`);
  } else {
    lines.push('  Speed:      Only one backend available');
  }

  lines.push(`  Coverage:   ast-grep ${(result.summary.coverageAstGrep * 100).toFixed(0)}% | semgrep ${(result.summary.coverageSemgrep * 100).toFixed(0)}%`);
  lines.push(`  Agreement:  ${(result.summary.agreementRate * 100).toFixed(0)}% of shared patterns match or are close`);

  // Semgrep-only languages
  const semgrepOnly = result.languages.filter(
    (l) => l !== 'typescript' && l !== 'javascript',
  );
  if (semgrepOnly.length > 0) {
    lines.push(`  Semgrep-only languages: ${semgrepOnly.join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function formatScannerBenchMarkdown(result: ScannerBenchResult): string {
  const lines: string[] = [];

  lines.push('# Scanner Benchmark: ast-grep vs semgrep');
  lines.push('');
  lines.push(`**Directory:** \`${result.dir}\``);
  lines.push(`**Languages:** ${result.languages.join(', ')}`);
  lines.push('');

  // Backend performance
  lines.push('## Backend Performance');
  lines.push('');
  lines.push('| Backend | Time | Patterns | Detected | Matches | Languages |');
  lines.push('|---------|------|----------|----------|---------|-----------|');

  if (result.astGrep) {
    lines.push(
      `| ast-grep | ${result.astGrep.durationMs}ms | ${result.astGrep.patternCount} | ${result.astGrep.patternsDetected} | ${result.astGrep.totalMatches} | ${result.astGrep.languages.join(', ')} |`,
    );
  } else {
    lines.push('| ast-grep | N/A | - | - | - | (not available) |');
  }

  if (result.semgrep) {
    lines.push(
      `| semgrep | ${result.semgrep.durationMs}ms | ${result.semgrep.patternCount} | ${result.semgrep.patternsDetected} | ${result.semgrep.totalMatches} | ${result.semgrep.languages.join(', ')} |`,
    );
  } else {
    lines.push('| semgrep | N/A | - | - | - | (not available) |');
  }

  lines.push('');

  // Pattern comparison
  if (result.patterns.length > 0) {
    lines.push('## Pattern Comparison');
    lines.push('');
    lines.push('| Pattern | ast-grep | semgrep | Agreement |');
    lines.push('|---------|----------|---------|-----------|');

    for (const p of result.patterns) {
      const ag = p.astGrepMatches !== null ? String(p.astGrepMatches) : 'N/A';
      const sg = p.semgrepMatches !== null ? String(p.semgrepMatches) : 'N/A';
      lines.push(`| ${p.name} | ${ag} | ${sg} | ${p.agreement} |`);
    }

    lines.push('');
  }

  // Summary
  lines.push('## Summary');
  lines.push('');

  if (result.summary.speedRatio !== null) {
    const faster = result.summary.speedRatio > 1 ? 'ast-grep' : 'semgrep';
    const ratio = result.summary.speedRatio > 1
      ? result.summary.speedRatio.toFixed(1)
      : (1 / result.summary.speedRatio).toFixed(1);
    lines.push(`- **Speed:** ${faster} is ${ratio}x faster`);
  }

  lines.push(`- **Coverage:** ast-grep ${(result.summary.coverageAstGrep * 100).toFixed(0)}% | semgrep ${(result.summary.coverageSemgrep * 100).toFixed(0)}%`);
  lines.push(`- **Agreement:** ${(result.summary.agreementRate * 100).toFixed(0)}% of shared patterns match or are close`);

  const semgrepOnly = result.languages.filter(
    (l) => l !== 'typescript' && l !== 'javascript',
  );
  if (semgrepOnly.length > 0) {
    lines.push(`- **Semgrep-only languages:** ${semgrepOnly.join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}
