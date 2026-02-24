import { createInterface } from 'node:readline';
import { join } from 'node:path';
import Fuse from 'fuse.js';
import { MemoryStore } from '../core/store.js';
import { TierManager } from '../core/tiers.js';
import { createEntry, VALID_CATEGORIES } from '../core/schema.js';
import type { MemoryCategory } from '../core/schema.js';
import { scoreAll } from '../algorithms/scoring.js';
import { dedupOperation } from '../algorithms/dedup.js';
import { rebuildAll } from '../core/index.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface MemorySearchParams {
  query: string;
  limit?: number;
  category?: string;
}

interface MemoryAddParams {
  content: string;
  category: string;
  tags?: string[];
}

function sendResponse(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function errorResponse(id: string | number, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleToolsList(id: string | number): Promise<void> {
  sendResponse({
    jsonrpc: '2.0',
    id,
    result: {
      tools: [
        {
          name: 'memory_search',
          description: 'Search memory entries by keyword',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results (default 5)' },
              category: { type: 'string', description: 'Filter by category' },
            },
            required: ['query'],
          },
        },
        {
          name: 'memory_add',
          description: 'Add a new memory entry',
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Memory content' },
              category: {
                type: 'string',
                enum: ['pattern', 'decision', 'gotcha', 'preference', 'project', 'tool'],
                description: 'Memory category',
              },
              tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
            },
            required: ['content', 'category'],
          },
        },
        {
          name: 'memory_stats',
          description: 'Get memory store statistics',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    },
  });
}

async function handleToolCall(
  id: string | number,
  toolName: string,
  args: unknown,
  store: MemoryStore,
  tierManager: TierManager,
): Promise<void> {
  switch (toolName) {
    case 'memory_search': {
      const params = args as MemorySearchParams;
      const limit = params.limit ?? 5;
      let entries = await store.list({ status: 'active' });

      if (params.category && VALID_CATEGORIES.includes(params.category as MemoryCategory)) {
        entries = entries.filter((e) => e.category === params.category);
      }

      if (entries.length === 0) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ results: [] }, null, 2) }],
          },
        });
        return;
      }

      // Use Fuse.js for fuzzy search
      const fuse = new Fuse(entries, {
        keys: ['content', 'tags'],
        threshold: 0.4,
        includeScore: true,
      });

      const results = fuse.search(params.query, { limit });
      const matches = results.map((r) => ({
        id: r.item.id,
        content: r.item.content,
        category: r.item.category,
        confidence: r.item.confidence,
        tags: r.item.tags,
        score: r.score !== undefined ? 1 - r.score : undefined,
      }));

      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ results: matches }, null, 2) }],
        },
      });
      break;
    }

    case 'memory_add': {
      const params = args as MemoryAddParams;
      if (!VALID_CATEGORIES.includes(params.category as MemoryCategory)) {
        sendResponse(errorResponse(id, -32602, `Invalid category: ${params.category}. Must be one of: ${VALID_CATEGORIES.join(', ')}`));
        return;
      }

      const entry = createEntry(params.content, params.category as MemoryCategory, {
        source: 'auto',
        tags: params.tags,
      });

      // Dedup against existing entries
      const existing = await store.loadAll();
      const result = dedupOperation(entry, existing);

      let status: string;
      let resultId: string;

      switch (result.op) {
        case 'ADD':
          await store.add(entry);
          status = 'added';
          resultId = entry.id;
          break;
        case 'UPDATE':
          if (result.target && result.merged) {
            await store.update(result.target.id, result.merged);
            status = 'merged';
            resultId = result.target.id;
          } else {
            status = 'error';
            resultId = '';
          }
          break;
        case 'NOOP':
          status = 'duplicate';
          resultId = result.target?.id ?? '';
          break;
        case 'DELETE':
          if (result.target) {
            await store.delete(result.target.id);
            await store.add(entry);
            status = 'replaced';
            resultId = entry.id;
          } else {
            status = 'error';
            resultId = '';
          }
          break;
      }

      // Rebuild indexes after modification
      if (status === 'added' || status === 'merged' || status === 'replaced') {
        await rebuildAll(store, tierManager);
      }

      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ id: resultId, status }) }],
        },
      });
      break;
    }

    case 'memory_stats': {
      const entries = await store.loadAll();
      const scored = scoreAll(entries);
      const byCategory: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      let tokenEstimate = 0;

      for (const e of entries) {
        byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
        byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
        tokenEstimate += Math.ceil(e.content.length / 4);
      }

      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                total: entries.length,
                by_category: byCategory,
                by_status: byStatus,
                health: {
                  healthy: scored.filter((s) => s.flags === 'healthy').length,
                  stale: scored.filter((s) => s.flags === 'stale').length,
                  critical: scored.filter((s) => s.flags === 'critical').length,
                },
                token_estimate: tokenEstimate,
              }, null, 2),
            },
          ],
        },
      });
      break;
    }

    default:
      sendResponse(errorResponse(id, -32601, `Unknown tool: ${toolName}`));
  }
}

export function startMcpServer(memexDir: string): void {
  const store = new MemoryStore(join(memexDir, 'archive'));
  const tierManager = new TierManager(memexDir);

  const rl = createInterface({ input: process.stdin });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      sendResponse(errorResponse(0, -32700, 'Parse error'));
      return;
    }

    if (request.jsonrpc !== '2.0') {
      sendResponse(errorResponse(request.id ?? 0, -32600, 'Invalid Request'));
      return;
    }

    try {
      switch (request.method) {
        case 'initialize':
          sendResponse({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'memex', version: '0.1.0' },
            },
          });
          break;

        case 'tools/list':
          await handleToolsList(request.id);
          break;

        case 'tools/call': {
          const params = request.params as { name: string; arguments?: unknown };
          await handleToolCall(request.id, params.name, params.arguments ?? {}, store, tierManager);
          break;
        }

        case 'notifications/initialized':
          // Acknowledgement, no response needed
          break;

        default:
          sendResponse(errorResponse(request.id, -32601, `Method not found: ${request.method}`));
      }
    } catch (err) {
      sendResponse(errorResponse(request.id, -32603, `Internal error: ${err instanceof Error ? err.message : 'unknown'}`));
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  console.error('[memex] MCP server started on stdio');
}
