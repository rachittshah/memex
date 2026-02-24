/**
 * Code scanner — detects conventions and patterns from source code.
 * Supports two backends: ast-grep (@ast-grep/napi) and semgrep (CLI).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { createEntry, type MemoryEntry } from '../core/schema.js';
import type { CodePattern, SupportedLang } from './patterns.js';
import { EXT_TO_LANG, LANG_EXTENSIONS, getPatternsForLang } from './patterns.js';

export type ScannerBackend = 'ast-grep' | 'semgrep' | 'auto';

export interface ScanOptions {
  /** Directory to scan */
  dir: string;
  /** Languages to scan for (auto-detect if empty) */
  languages?: SupportedLang[];
  /** Scanner backend */
  backend?: ScannerBackend;
  /** Directories to exclude */
  exclude?: string[];
  /** Minimum matches to create a memory */
  minMatches?: number;
}

export interface ScanResult {
  pattern: CodePattern;
  matchCount: number;
  antiMatchCount: number;
  files: string[];
  entry: MemoryEntry;
}

const DEFAULT_EXCLUDE = [
  'node_modules', 'dist', 'build', '.git', '__pycache__',
  'venv', '.venv', 'target', 'vendor', '.next', 'coverage',
];

// ── File Discovery ───────────────────────────────────────────────────────

async function findSourceFiles(
  dir: string,
  languages: SupportedLang[],
  exclude: string[],
): Promise<Map<SupportedLang, string[]>> {
  const result = new Map<SupportedLang, string[]>();
  for (const lang of languages) {
    result.set(lang, []);
  }

  const validExts = new Set<string>();
  for (const lang of languages) {
    for (const ext of LANG_EXTENSIONS[lang]) {
      validExts.add(ext);
    }
  }

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude.includes(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (validExts.has(ext)) {
          const lang = EXT_TO_LANG[ext];
          if (lang) {
            result.get(lang)?.push(full);
          }
        }
      }
    }
  }

  await walk(dir);
  return result;
}

/**
 * Auto-detect languages present in a directory.
 */
export async function detectLanguages(dir: string): Promise<SupportedLang[]> {
  const found = new Set<SupportedLang>();
  const allLangs: SupportedLang[] = ['typescript', 'javascript', 'python', 'go', 'rust'];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 3) return; // Don't go too deep for detection
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (DEFAULT_EXCLUDE.includes(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory() && depth < 3) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        const lang = EXT_TO_LANG[ext];
        if (lang) found.add(lang);
      }
    }
  }

  await walk(dir, 0);
  return Array.from(found);
}

// ── ast-grep Backend ─────────────────────────────────────────────────────

interface AstGrepMatch {
  file: string;
  line: number;
}

// Languages supported by @ast-grep/napi built-in parsers
const AST_GREP_SUPPORTED: Set<SupportedLang> = new Set(['typescript', 'javascript']);

async function scanWithAstGrep(
  files: string[],
  pattern: string,
  lang: SupportedLang,
): Promise<AstGrepMatch[]> {
  if (!AST_GREP_SUPPORTED.has(lang)) {
    throw new Error(
      `ast-grep napi does not support ${lang}. Use --backend semgrep for Python/Go/Rust.`,
    );
  }

  try {
    const napi = await import('@ast-grep/napi');

    const langMap: Record<string, unknown> = {
      typescript: napi.Lang.TypeScript,
      javascript: napi.Lang.JavaScript,
    };

    const astLang = langMap[lang];
    if (!astLang) return [];

    const matches: AstGrepMatch[] = [];

    for (const file of files) {
      try {
        const source = await readFile(file, 'utf-8');
        const root = napi.parse(astLang as Parameters<typeof napi.parse>[0], source);
        const nodes = root.root().findAll(pattern);
        for (const node of nodes) {
          matches.push({
            file,
            line: node.range().start.line + 1,
          });
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    return matches;
  } catch {
    throw new Error(
      'ast-grep not available. Install: npm install @ast-grep/napi\n' +
      'Or use --backend semgrep instead.',
    );
  }
}

// ── Semgrep Backend ──────────────────────────────────────────────────────

function getSemgrepEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  // Ensure common Python bin dirs are in PATH so semgrep/pysemgrep are found
  const home = process.env.HOME ?? '';
  const extraPaths = [
    `${home}/Library/Python/3.9/bin`,
    `${home}/Library/Python/3.10/bin`,
    `${home}/Library/Python/3.11/bin`,
    `${home}/Library/Python/3.12/bin`,
    `${home}/Library/Python/3.13/bin`,
    `${home}/.local/bin`,
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  env.PATH = [...extraPaths, env.PATH ?? ''].join(':');
  return env;
}

function semgrepLangId(lang: SupportedLang): string {
  const map: Record<SupportedLang, string> = {
    typescript: 'ts',
    javascript: 'js',
    python: 'python',
    go: 'go',
    rust: 'rust',
  };
  return map[lang];
}

async function scanWithSemgrep(
  dir: string,
  pattern: string,
  lang: SupportedLang,
): Promise<AstGrepMatch[]> {
  const env = getSemgrepEnv();
  try {
    // Check if semgrep is installed
    execSync('semgrep --version', { stdio: 'pipe', env });
  } catch {
    throw new Error(
      'semgrep not available. Install: pip install semgrep\n' +
      'Or use --backend ast-grep instead.',
    );
  }

  try {
    const langId = semgrepLangId(lang);
    const result = execSync(
      `semgrep --pattern '${pattern.replace(/'/g, "\\'")}' --lang ${langId} --json --quiet ${dir}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000, env },
    );

    const parsed = JSON.parse(result);
    const results = parsed.results ?? [];
    return results.map((r: { path: string; start: { line: number } }) => ({
      file: r.path,
      line: r.start.line,
    }));
  } catch {
    // Pattern may not be valid for semgrep — return empty
    return [];
  }
}

// ── Detect Available Backend ─────────────────────────────────────────────

export async function detectBackend(): Promise<'ast-grep' | 'semgrep'> {
  // Try ast-grep first (faster, no network)
  try {
    await import('@ast-grep/napi');
    return 'ast-grep';
  } catch {
    // not installed
  }

  // Try semgrep CLI
  try {
    execSync('semgrep --version', { stdio: 'pipe', env: getSemgrepEnv() });
    return 'semgrep';
  } catch {
    // not installed
  }

  throw new Error(
    'No scanner backend available.\n' +
    'Install one of:\n' +
    '  npm install @ast-grep/napi    (recommended, fast)\n' +
    '  pip install semgrep           (alternative)',
  );
}

// ── Main Scanner ─────────────────────────────────────────────────────────

async function countMatches(
  backend: ScannerBackend,
  files: string[],
  dir: string,
  pattern: string,
  lang: SupportedLang,
): Promise<{ count: number; files: string[] }> {
  let matches: AstGrepMatch[];

  if (backend === 'semgrep') {
    matches = await scanWithSemgrep(dir, pattern, lang);
  } else {
    matches = await scanWithAstGrep(files, pattern, lang);
  }

  const uniqueFiles = [...new Set(matches.map((m) => m.file))];
  return { count: matches.length, files: uniqueFiles };
}

export async function scan(options: ScanOptions): Promise<ScanResult[]> {
  const {
    dir,
    exclude = DEFAULT_EXCLUDE,
    minMatches: globalMin,
  } = options;

  // Detect or resolve backend
  let backend: 'ast-grep' | 'semgrep';
  if (options.backend === 'auto' || !options.backend) {
    backend = await detectBackend();
  } else {
    backend = options.backend;
  }

  // Detect or use provided languages
  const languages = options.languages?.length
    ? options.languages
    : await detectLanguages(dir);

  if (languages.length === 0) {
    return [];
  }

  // Find source files
  const filesByLang = await findSourceFiles(dir, languages, exclude);

  const results: ScanResult[] = [];

  for (const lang of languages) {
    const files = filesByLang.get(lang) ?? [];
    if (files.length === 0) continue;

    const patterns = getPatternsForLang(lang);

    for (const pat of patterns) {
      const threshold = globalMin ?? pat.minMatches;

      const { count, files: matchFiles } = await countMatches(
        backend, files, dir, pat.pattern, lang,
      );

      if (count < threshold) continue;

      // Check anti-pattern if defined
      let antiCount = 0;
      if (pat.antiPattern) {
        const anti = await countMatches(
          backend, files, dir, pat.antiPattern, lang,
        );
        antiCount = anti.count;
      }

      // Build description
      let description = pat.description.replace('$COUNT', String(count));
      if (antiCount > 0 && pat.antiDescription) {
        description += '. ' + pat.antiDescription.replace('$COUNT', String(antiCount));
      }

      // Determine confidence based on prevalence and consistency
      let confidence = Math.min(0.95, 0.5 + (count / 20) * 0.3);
      if (antiCount > 0) {
        const ratio = count / (count + antiCount);
        confidence *= ratio; // Reduce confidence if anti-pattern exists
      }
      confidence = Math.round(confidence * 100) / 100;

      const relativeFiles = matchFiles.map((f) => relative(dir, f));

      const entry = createEntry(description, pat.category, {
        confidence,
        source: 'auto',
        tags: [...pat.tags, `lang:${lang}`, 'code-scan'],
        related_files: relativeFiles.slice(0, 10), // Cap at 10 files
      });

      results.push({
        pattern: pat,
        matchCount: count,
        antiMatchCount: antiCount,
        files: relativeFiles,
        entry,
      });
    }
  }

  // Sort by match count (most prevalent conventions first)
  results.sort((a, b) => b.matchCount - a.matchCount);

  return results;
}
