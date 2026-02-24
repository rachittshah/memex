# memex

OSS Memory Manager for AI Coding Assistants — filesystem-native, tool-agnostic, LLM-optional.

Current AI coding assistants (Claude Code, Cursor, Aider, Windsurf, Codex) all have memory systems, but they're all broken in the same ways: memory files bloat over time, stale entries waste context tokens, there's no deduplication, no decay, no quality scoring, and no cross-tool portability. **memex** fixes all of that.

## Features

- **L1/L2/L3 cache hierarchy** — always-loaded index, on-demand topic files, searchable archive
- **Jaccard dedup** — 4-operation model (ADD/UPDATE/DELETE/NOOP) with similarity-based dedup
- **Configurable decay** — half-life per category (preferences never expire, project context decays in 14 days)
- **Cross-tool export** — Claude Code, Cursor, Aider, AGENTS.md from a single source of truth
- **Claude Code hooks** — auto-extract memories on PreCompact, Stop, SessionEnd, SessionStart
- **MCP server mode** — mid-conversation memory access via `memex serve`
- **Code scanning** — ast-grep/semgrep detect conventions directly from source code
- **Memory validation** — cross-reference memories against actual code, flag contradictions
- **LoCoMo benchmark** — built-in harness to measure memory quality with F1 scoring
- **LLM-optional** — core features (add, search, audit, prune, export) work without an API key

## Quick Start

### Install from npm

```bash
npm install -g memex-ai
```

### Initialize in your project

```bash
cd your-project
memex init
```

This creates a `.memex/` directory:

```
.memex/
├── config.json   — configuration (thresholds, decay rates)
├── index.md      — L1 memory index (always loaded, ~50-80 lines)
├── topics/       — L2 topic files (loaded on-demand, <100 lines each)
└── archive/      — L3 JSON entries (full metadata, searchable)
```

### Add memories

```bash
memex add "Always use TypeScript strict mode" --category preference --tags "typescript,config"
memex add "API uses JWT in httpOnly cookies" --category decision --tags "auth,security" --confidence 0.85
memex add "Python 3.14 selected by uv despite >=3.12 constraint" --category gotcha --tags "python,uv"
```

Duplicate detection runs automatically — similar entries merge instead of duplicating.

### Search, audit, and prune

```bash
memex search "typescript"          # Fuzzy search across all tiers
memex status                       # Dashboard: counts, staleness, token budget
memex audit                        # Score entries, flag stale/duplicate
memex prune --dry-run              # Preview what would be removed
memex prune                        # Archive entries below score threshold
```

### Export to your tools

```bash
memex export --claude              # → .claude/memory/MEMORY.md + CLAUDE.md
memex export --cursor              # → .cursor/rules/*.mdc
memex export --aider               # → CONVENTIONS.md
memex export --agents-md           # → AGENTS.md (universal format)
memex export --all                 # All of the above
```

### Scan codebase for conventions

```bash
memex scan                         # Auto-detect languages, scan with ast-grep
memex scan --backend semgrep       # Use semgrep instead
memex scan ./src --lang typescript # Scan specific dir/language
memex scan --dry-run               # Preview without saving
```

Detects patterns like: async/await vs promises, interface vs type alias, error handling style, import conventions, test patterns, and more — across TypeScript, JavaScript, Python, Go, and Rust.

### Validate memories against code

```bash
memex validate                     # Check all memories against codebase
memex validate --backend semgrep   # Use semgrep for validation
memex validate --json              # Machine-readable output
```

Flags memories that are contradicted by actual code (e.g., memory says "uses interfaces" but code has mostly type aliases).

## Local Development Setup

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **Git**

### Clone and install

```bash
git clone https://github.com/rachittshah/memex.git
cd memex
npm install
```

### Build

```bash
npm run build        # Compile TypeScript → dist/
npm run dev          # Watch mode (recompiles on changes)
```

### Run locally

```bash
# Run directly from source
node dist/cli.js --help

# Or link globally for development
npm link
memex --help
```

### Test

```bash
npm test             # Run all 88 tests
npm run test:watch   # Watch mode
npm run lint         # Type-check without emitting
```

### Project structure

```
src/
├── cli.ts                  # CLI entry point (commander.js)
├── core/
│   ├── schema.ts           # MemoryEntry types, validation, factories
│   ├── store.ts            # CRUD for L3 archive (atomic JSON writes)
│   ├── tiers.ts            # L1/L2 tier management (markdown files)
│   └── index.ts            # Index builder (L1 generation from L2/L3)
├── algorithms/
│   ├── scoring.ts          # Effective score: confidence × access × decay
│   ├── dedup.ts            # Jaccard similarity + 4-op model
│   ├── decay.ts            # Half-life decay calculator
│   └── promote.ts          # Tier promotion/demotion logic
├── llm/
│   ├── extract.ts          # LLM-powered memory extraction from transcripts
│   └── consolidate.ts      # LLM-powered merge and dedup
├── exporters/
│   ├── claude.ts           # CLAUDE.md + MEMORY.md export
│   ├── cursor.ts           # .cursor/rules/*.mdc export
│   ├── aider.ts            # CONVENTIONS.md export
│   └── agents-md.ts        # AGENTS.md universal export
├── hooks/
│   ├── claude-code.ts      # Claude Code hook handlers
│   ├── mcp-server.ts       # MCP server mode (JSON-RPC over stdio)
│   └── generic.ts          # Generic transcript extraction
├── scanner/
│   ├── patterns.ts         # Built-in ast-grep/semgrep patterns (TS, Python, Go, Rust)
│   ├── scanner.ts          # Code scanning engine (ast-grep + semgrep backends)
│   └── validator.ts        # Memory validation against code
├── bench/
│   ├── locomo.ts           # LoCoMo dataset loader
│   ├── runner.ts           # Benchmark execution engine
│   ├── evaluator.ts        # F1 scoring + metrics
│   ├── baselines.ts        # Baseline implementations (+ scan baseline)
│   └── report.ts           # Results formatting
└── commands/
    ├── init.ts, status.ts, add.ts, search.ts
    ├── audit.ts, prune.ts, export.ts, scan.ts, validate.ts
    ├── consolidate.ts, extract.ts, bench.ts, serve.ts
tests/
    ├── schema.test.ts      # 9 tests
    ├── store.test.ts       # 13 tests
    ├── scoring.test.ts     # 6 tests
    ├── dedup.test.ts       # 15 tests
    ├── decay.test.ts       # 11 tests
    ├── tiers.test.ts       # 19 tests
    ├── exporters.test.ts   # 9 tests
    └── commands.test.ts    # 6 tests (CLI integration)
```

## Claude Code Integration

### Auto-install hooks

```bash
memex init --claude
```

This installs hooks into `.claude/settings.json` that fire on Claude Code lifecycle events:

| Hook | Event | What memex does |
|------|-------|-----------------|
| `PreCompact` | Before context compression | Extracts memories from conversation about to be compressed (highest-signal moment) |
| `Stop` (async) | After Claude responds | Background extraction from last assistant message |
| `SessionEnd` | Session terminates | Final extraction + consolidation check |
| `SessionStart` | Session begins | Injects L1 index + relevant L2 topics into context |

memex writes to `.claude/memory/MEMORY.md` so it works alongside Claude Code's native auto-memory — it's **additive**, not a replacement.

### MCP Server

For deeper integration, run memex as an MCP server:

```bash
memex serve
```

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "memex": {
      "command": "memex",
      "args": ["serve"]
    }
  }
}
```

This gives Claude access to `memory_search`, `memory_add`, and `memory_stats` tools mid-conversation.

## LLM-Powered Features

These features require an Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm install @anthropic-ai/sdk     # Optional dependency
```

### Extract memories from transcripts

```bash
memex extract --file transcript.jsonl
cat transcript.json | memex extract --from-stdin --trigger session-end
```

### Consolidate (merge + dedup)

```bash
memex consolidate              # LLM merges overlapping entries
memex consolidate --dry-run    # Preview without applying
```

## LoCoMo Benchmark

Measure memory quality against the [LoCoMo dataset](https://github.com/snap-research/locomo) (10 long-term conversations, 300 turns each):

```bash
memex bench                          # Full benchmark
memex bench --quick                  # Quick (2 conversations)
memex bench --baselines none,naive   # Compare against baselines
memex bench --export results.json    # Export results
memex bench --ci --threshold 0.65    # CI mode (exit 1 if F1 < 65%)
```

Baselines: `none` (no memory), `naive` (full text), `l1` (index only), `l2` (index + topics), `full` (all tiers).

## Memory Schema

Each entry in the archive:

```json
{
  "id": "uuid",
  "content": "Always use TypeScript strict mode",
  "category": "preference",
  "confidence": 0.95,
  "access_count": 3,
  "last_accessed": "2025-02-24T06:30:00.000Z",
  "created": "2025-02-20T10:00:00.000Z",
  "updated": "2025-02-24T06:30:00.000Z",
  "decay_days": Infinity,
  "source": "manual",
  "tags": ["typescript", "config"],
  "related_files": [],
  "status": "active"
}
```

### Categories and decay

| Category | Half-life | Use case |
|----------|-----------|----------|
| `preference` | Never | User preferences, permanent conventions |
| `decision` | 90 days | Architectural/design choices |
| `pattern` | 60 days | Recurring approaches, conventions |
| `tool` | 45 days | Tool-specific knowledge |
| `gotcha` | 30 days | Bugs, pitfalls, warnings |
| `project` | 14 days | Project context (fast-moving) |

### Scoring

```
effective_score = confidence × max(1, log2(access_count + 1)) × decay_factor
```

- Entries scoring below 0.3 are flagged as **stale**
- Entries scoring below 0.1 are flagged as **critical** and pruned

### Tier promotion

| Transition | Condition |
|------------|-----------|
| L3 → L2 | `access_count > 3` and `confidence > 0.7` |
| L2 → L1 | `access_count > 10` (cross-project pattern) |
| L1 → L2 | Not accessed for 30 days |
| L2 → L3 | Effective score < 0.3 |

## CLI Reference

```
memex init [--claude] [--force]      Initialize .memex directory
memex status                         Dashboard with health metrics
memex add <text> [options]           Add a memory entry
  --category <cat>                     pattern|decision|gotcha|preference|project|tool
  --tags <tags>                        Comma-separated tags
  --confidence <n>                     0.0-1.0 (default: 0.7)
memex search <query> [options]       Fuzzy search across tiers
  --category <cat>                     Filter by category
  --limit <n>                          Max results (default: 10)
memex audit [--json]                 Score and flag entries
memex prune [options]                Remove low-scoring entries
  --threshold <n>                      Score threshold (default: 0.1)
  --dry-run                            Preview without removing
  --hard                               Permanently delete (vs archive)
memex export [options]               Export to tool formats
  --claude / --cursor / --aider / --agents-md / --all
memex consolidate [--dry-run]        LLM-powered merge (needs API key)
memex extract [options]              Extract from transcripts (needs API key)
  --from-stdin                         Read from stdin (hook mode)
  --file <path>                        Read from file
  --trigger <event>                    pre-compact|stop|session-end
memex bench [options]                Run LoCoMo benchmark
  --quick                              2 conversations only
  --baselines <list>                   Comma-separated baselines
  --ci --threshold <n>                 CI mode with F1 threshold
memex scan [dir] [options]          Scan codebase for conventions
  --backend <backend>                  ast-grep | semgrep | auto
  --lang <languages>                   Comma-separated languages
  --min-matches <n>                    Minimum matches to report
  --dry-run                            Preview without saving
memex validate [dir] [options]      Validate memories against code
  --backend <backend>                  ast-grep | semgrep | auto
  --json                               Machine-readable output
memex serve                          Start MCP server (stdio)
```

## Design Decisions

- **Filesystem-native** — agents using simple file operations outperform complex memory solutions. No databases, no Docker.
- **4-op dedup model** — ADD/UPDATE/DELETE/NOOP with Jaccard similarity is the sweet spot for memory consolidation
- **< 150 lines auto-loaded** — modular rules reduce noise by 40%, theme-based organization beats chronological
- **Pattern detection at 2+ occurrences** — recurring items auto-promote to higher tiers
- **Code-aware scanning** — ast-grep/semgrep detect conventions directly from source code, not just conversations

## License

MIT
