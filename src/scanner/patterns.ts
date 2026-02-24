/**
 * Built-in ast-grep patterns for detecting code conventions.
 * Each pattern group detects a specific convention category.
 */

export interface CodePattern {
  /** Human-readable name */
  name: string;
  /** ast-grep pattern string */
  pattern: string;
  /** Language(s) this applies to */
  languages: SupportedLang[];
  /** Memory category to assign */
  category: 'pattern' | 'decision' | 'gotcha';
  /** Description template — $COUNT is replaced with match count */
  description: string;
  /** Tags to attach to created memory */
  tags: string[];
  /** Minimum matches to consider it a convention */
  minMatches: number;
  /** Optional anti-pattern (contradicts this convention) */
  antiPattern?: string;
  /** Anti-pattern description */
  antiDescription?: string;
}

export type SupportedLang = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

/**
 * Maps file extensions to supported languages.
 */
export const EXT_TO_LANG: Record<string, SupportedLang> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

export const LANG_EXTENSIONS: Record<SupportedLang, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
};

// ── TypeScript / JavaScript Patterns ─────────────────────────────────────

const tsPatterns: CodePattern[] = [
  {
    name: 'async-await',
    pattern: 'async function $FUNC($$$PARAMS) { $$$BODY }',
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Codebase uses async/await pattern ($COUNT instances found)',
    tags: ['async', 'conventions'],
    minMatches: 3,
    antiPattern: '$PROMISE.then($$$)',
    antiDescription: 'Mixed: also uses .then() promise chains ($COUNT instances)',
  },
  {
    name: 'arrow-functions',
    pattern: 'const $NAME = ($$$PARAMS) => $$$BODY',
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Prefers arrow function expressions ($COUNT instances)',
    tags: ['functions', 'conventions'],
    minMatches: 5,
  },
  {
    name: 'try-catch-error-handling',
    pattern: 'try { $$$BODY } catch ($ERR) { $$$HANDLER }',
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Uses try/catch for error handling ($COUNT instances)',
    tags: ['error-handling', 'conventions'],
    minMatches: 3,
  },
  {
    name: 'interface-over-type',
    pattern: 'interface $NAME { $$$BODY }',
    languages: ['typescript'],
    category: 'pattern',
    description: 'Prefers interface declarations over type aliases ($COUNT interfaces)',
    tags: ['typescript', 'types', 'conventions'],
    minMatches: 3,
    antiPattern: 'type $NAME = { $$$BODY }',
    antiDescription: 'Mixed: also uses type aliases ($COUNT type aliases)',
  },
  {
    name: 'type-aliases',
    pattern: 'type $NAME = $$$TYPE',
    languages: ['typescript'],
    category: 'pattern',
    description: 'Uses TypeScript type aliases ($COUNT instances)',
    tags: ['typescript', 'types', 'conventions'],
    minMatches: 3,
  },
  {
    name: 'enum-usage',
    pattern: 'enum $NAME { $$$MEMBERS }',
    languages: ['typescript'],
    category: 'decision',
    description: 'Uses TypeScript enums ($COUNT instances)',
    tags: ['typescript', 'types', 'conventions'],
    minMatches: 2,
  },
  {
    name: 'named-exports',
    pattern: 'export { $$$NAMES }',
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Uses named exports ($COUNT instances)',
    tags: ['modules', 'conventions'],
    minMatches: 3,
  },
  {
    name: 'default-exports',
    pattern: 'export default $$$EXPR',
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Uses default exports ($COUNT instances)',
    tags: ['modules', 'conventions'],
    minMatches: 3,
  },
  {
    name: 'describe-it-tests',
    pattern: "describe($NAME, () => { $$$BODY })",
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Tests use describe/it blocks ($COUNT test suites)',
    tags: ['testing', 'conventions'],
    minMatches: 2,
  },
  {
    name: 'console-error-logging',
    pattern: 'console.error($$$ARGS)',
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Uses console.error for error logging ($COUNT instances)',
    tags: ['logging', 'error-handling'],
    minMatches: 3,
  },
  {
    name: 'optional-chaining',
    pattern: '$OBJ?.$PROP',
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Uses optional chaining operator ($COUNT instances)',
    tags: ['typescript', 'conventions'],
    minMatches: 5,
  },
  {
    name: 'nullish-coalescing',
    pattern: '$LEFT ?? $RIGHT',
    languages: ['typescript', 'javascript'],
    category: 'pattern',
    description: 'Uses nullish coalescing operator ($COUNT instances)',
    tags: ['typescript', 'conventions'],
    minMatches: 3,
  },
];

// ── Python Patterns ──────────────────────────────────────────────────────

const pyPatterns: CodePattern[] = [
  {
    name: 'type-hints',
    pattern: 'def $FUNC($$$PARAMS) -> $RETURN: $$$BODY',
    languages: ['python'],
    category: 'pattern',
    description: 'Uses type hints on function signatures ($COUNT instances)',
    tags: ['python', 'types', 'conventions'],
    minMatches: 3,
  },
  {
    name: 'dataclass',
    pattern: '@dataclass\nclass $NAME: $$$BODY',
    languages: ['python'],
    category: 'decision',
    description: 'Uses @dataclass for data models ($COUNT instances)',
    tags: ['python', 'data-models'],
    minMatches: 2,
  },
  {
    name: 'context-manager',
    pattern: 'with $EXPR as $VAR: $$$BODY',
    languages: ['python'],
    category: 'pattern',
    description: 'Uses context managers (with statements) ($COUNT instances)',
    tags: ['python', 'resource-management'],
    minMatches: 3,
  },
  {
    name: 'list-comprehension',
    pattern: '[$EXPR for $VAR in $ITER]',
    languages: ['python'],
    category: 'pattern',
    description: 'Uses list comprehensions ($COUNT instances)',
    tags: ['python', 'conventions'],
    minMatches: 3,
  },
  {
    name: 'f-strings',
    pattern: "f'$$$'",
    languages: ['python'],
    category: 'pattern',
    description: 'Uses f-strings for formatting ($COUNT instances)',
    tags: ['python', 'conventions'],
    minMatches: 5,
  },
];

// ── Go Patterns ──────────────────────────────────────────────────────────

const goPatterns: CodePattern[] = [
  {
    name: 'error-return-check',
    pattern: 'if $ERR != nil { return $$$RET }',
    languages: ['go'],
    category: 'pattern',
    description: 'Uses standard Go error return pattern ($COUNT instances)',
    tags: ['go', 'error-handling'],
    minMatches: 3,
  },
  {
    name: 'defer-cleanup',
    pattern: 'defer $EXPR($$$)',
    languages: ['go'],
    category: 'pattern',
    description: 'Uses defer for cleanup ($COUNT instances)',
    tags: ['go', 'resource-management'],
    minMatches: 2,
  },
  {
    name: 'struct-tags',
    pattern: 'type $NAME struct { $$$FIELDS }',
    languages: ['go'],
    category: 'pattern',
    description: 'Defines struct types ($COUNT instances)',
    tags: ['go', 'types'],
    minMatches: 2,
  },
];

// ── Rust Patterns ────────────────────────────────────────────────────────

const rustPatterns: CodePattern[] = [
  {
    name: 'result-question-mark',
    pattern: '$EXPR?',
    languages: ['rust'],
    category: 'pattern',
    description: 'Uses ? operator for error propagation ($COUNT instances)',
    tags: ['rust', 'error-handling'],
    minMatches: 3,
  },
  {
    name: 'match-expressions',
    pattern: 'match $EXPR { $$$ARMS }',
    languages: ['rust'],
    category: 'pattern',
    description: 'Uses match expressions for control flow ($COUNT instances)',
    tags: ['rust', 'conventions'],
    minMatches: 3,
  },
  {
    name: 'derive-macros',
    pattern: '#[derive($$$TRAITS)]',
    languages: ['rust'],
    category: 'pattern',
    description: 'Uses derive macros ($COUNT instances)',
    tags: ['rust', 'conventions'],
    minMatches: 2,
  },
];

/**
 * All built-in patterns indexed by language.
 */
export const ALL_PATTERNS: CodePattern[] = [
  ...tsPatterns,
  ...pyPatterns,
  ...goPatterns,
  ...rustPatterns,
];

/**
 * Get patterns applicable to a given language.
 */
export function getPatternsForLang(lang: SupportedLang): CodePattern[] {
  return ALL_PATTERNS.filter((p) => p.languages.includes(lang));
}
