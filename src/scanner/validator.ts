/**
 * Memory validator — cross-references memories against actual code.
 * Uses ast-grep/semgrep to check if code patterns described in memories
 * still hold true in the codebase.
 */
import { type MemoryEntry } from '../core/schema.js';
import type { ScannerBackend, ScanOptions } from './scanner.js';
import { scan, detectLanguages, detectBackend } from './scanner.js';
import { ALL_PATTERNS, type CodePattern } from './patterns.js';
import { computeScore } from '../algorithms/scoring.js';

export type ValidationStatus = 'confirmed' | 'contradicted' | 'unverifiable';

export interface ValidationResult {
  entry: MemoryEntry;
  status: ValidationStatus;
  reason: string;
  score: number;
  codeEvidence?: {
    matchCount: number;
    antiMatchCount: number;
    files: string[];
  };
}

/**
 * Keywords that map memory content to pattern categories.
 */
const KEYWORD_TO_PATTERNS: { keywords: RegExp; patternNames: string[] }[] = [
  { keywords: /async[\s/]await|async functions/i, patternNames: ['async-await'] },
  { keywords: /arrow\s*function/i, patternNames: ['arrow-functions'] },
  { keywords: /try[\s/]catch|error\s*handling/i, patternNames: ['try-catch-error-handling'] },
  { keywords: /interface(?!s\s+vs)/i, patternNames: ['interface-over-type'] },
  { keywords: /type\s*alias/i, patternNames: ['type-aliases'] },
  { keywords: /\benum\b/i, patternNames: ['enum-usage'] },
  { keywords: /named\s*export/i, patternNames: ['named-exports'] },
  { keywords: /default\s*export/i, patternNames: ['default-exports'] },
  { keywords: /describe.*it\b|test\s*suite/i, patternNames: ['describe-it-tests'] },
  { keywords: /console\.error/i, patternNames: ['console-error-logging'] },
  { keywords: /optional\s*chain/i, patternNames: ['optional-chaining'] },
  { keywords: /nullish\s*coalesc/i, patternNames: ['nullish-coalescing'] },
  { keywords: /type\s*hint|return\s*type/i, patternNames: ['type-hints'] },
  { keywords: /dataclass/i, patternNames: ['dataclass'] },
  { keywords: /context\s*manager|with\s*statement/i, patternNames: ['context-manager'] },
  { keywords: /list\s*comprehension/i, patternNames: ['list-comprehension'] },
  { keywords: /f-string/i, patternNames: ['f-strings'] },
  { keywords: /error.*return.*nil|nil\s*check/i, patternNames: ['error-return-check'] },
  { keywords: /\bdefer\b/i, patternNames: ['defer-cleanup'] },
  { keywords: /\?\s*operator|question\s*mark.*propagat/i, patternNames: ['result-question-mark'] },
  { keywords: /match\s*express/i, patternNames: ['match-expressions'] },
  { keywords: /derive.*macro/i, patternNames: ['derive-macros'] },
];

/**
 * Try to find a matching code pattern for a memory entry.
 */
function findRelevantPatterns(entry: MemoryEntry): CodePattern[] {
  const content = entry.content.toLowerCase();
  const matched: CodePattern[] = [];

  for (const { keywords, patternNames } of KEYWORD_TO_PATTERNS) {
    if (keywords.test(content)) {
      for (const name of patternNames) {
        const pat = ALL_PATTERNS.find((p) => p.name === name);
        if (pat) matched.push(pat);
      }
    }
  }

  return matched;
}

/**
 * Validate memories against the codebase.
 */
export async function validate(
  entries: MemoryEntry[],
  dir: string,
  options?: { backend?: ScannerBackend },
): Promise<ValidationResult[]> {
  // Only validate active pattern/decision/gotcha entries
  const validatable = entries.filter(
    (e) => e.status === 'active' &&
    ['pattern', 'decision', 'gotcha'].includes(e.category),
  );

  // Run a full scan to get current code state
  let backend: 'ast-grep' | 'semgrep';
  try {
    backend = options?.backend === 'semgrep' ? 'semgrep' :
              options?.backend === 'ast-grep' ? 'ast-grep' : await detectBackend();
  } catch {
    // No backend available — everything is unverifiable
    return validatable.map((entry) => ({
      entry,
      status: 'unverifiable' as const,
      reason: 'No scanner backend available (install @ast-grep/napi or semgrep)',
      score: computeScore(entry),
    }));
  }

  const languages = await detectLanguages(dir);
  const scanResults = await scan({ dir, languages, backend });

  // Build lookup: pattern name → scan result
  const scanMap = new Map<string, { matchCount: number; antiMatchCount: number; files: string[] }>();
  for (const r of scanResults) {
    scanMap.set(r.pattern.name, {
      matchCount: r.matchCount,
      antiMatchCount: r.antiMatchCount,
      files: r.files,
    });
  }

  const results: ValidationResult[] = [];

  for (const entry of validatable) {
    const score = computeScore(entry);
    const relevantPatterns = findRelevantPatterns(entry);

    if (relevantPatterns.length === 0) {
      // Can't map this memory to a code pattern
      results.push({
        entry,
        status: 'unverifiable',
        reason: 'Cannot map to a code pattern for verification',
        score,
      });
      continue;
    }

    // Check each relevant pattern
    let confirmed = false;
    let contradicted = false;
    let evidence: { matchCount: number; antiMatchCount: number; files: string[] } | undefined;

    for (const pat of relevantPatterns) {
      const data = scanMap.get(pat.name);
      if (!data) continue;

      evidence = data;

      if (data.matchCount >= pat.minMatches) {
        // Pattern exists in code
        if (data.antiMatchCount > data.matchCount) {
          contradicted = true;
        } else {
          confirmed = true;
        }
      } else {
        // Pattern not found in sufficient quantity
        contradicted = true;
      }
    }

    if (confirmed && !contradicted) {
      results.push({
        entry,
        status: 'confirmed',
        reason: `Pattern verified in codebase (${evidence?.matchCount} matches in ${evidence?.files.length} files)`,
        score,
        codeEvidence: evidence,
      });
    } else if (contradicted) {
      results.push({
        entry,
        status: 'contradicted',
        reason: evidence
          ? `Code contradicts memory (${evidence.matchCount} matches vs ${evidence.antiMatchCount} anti-matches)`
          : 'Pattern not found in codebase',
        score,
        codeEvidence: evidence,
      });
    } else {
      results.push({
        entry,
        status: 'unverifiable',
        reason: 'No code evidence found',
        score,
      });
    }
  }

  return results;
}
