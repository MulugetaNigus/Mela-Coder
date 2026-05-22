import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { cap, resolveWorkspacePath, walkFiles } from './toolUtils';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php', '.c', '.cpp', '.h', '.hpp']);

async function searchCode(pattern: RegExp, directory: unknown): Promise<string[]> {
  const root = resolveWorkspacePath(directory);
  const matches: string[] = [];
  await walkFiles(root, async filePath => {
    if (!CODE_EXTENSIONS.has(path.extname(filePath))) return;
    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[index]) && matches.length < 100) {
        matches.push(`${path.relative(process.cwd(), filePath)}:${index + 1}: ${lines[index].trim()}`);
      }
    }
  });
  return matches;
}

export const findSymbolTool: ToolDefinition = {
  name: 'find_symbol',
  description: 'Find definitions or references of a function, class, variable, or type by text patterns.',
  params: [
    { name: 'symbol', type: 'string', required: true, description: 'Symbol name to find.' },
    { name: 'directory', type: 'string', required: false, description: 'Directory to search. Defaults to ".".' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.symbol !== 'string') throw new Error('symbol must be a string');
      const escaped = params.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b(class|function|const|let|var|interface|type|def|func|struct|enum)?\\s*${escaped}\\b`, 'g');
      const matches = await searchCode(pattern, params.directory);
      return { success: true, output: matches.length ? matches.join('\n') : `No matches found for symbol ${params.symbol}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to find symbol' };
    }
  }
};

export const getDefinitionTool: ToolDefinition = {
  name: 'get_definition',
  description: 'Find likely definitions of a symbol near a given file and line.',
  params: [
    { name: 'symbol', type: 'string', required: true, description: 'Symbol to resolve.' },
    { name: 'path', type: 'string', required: false, description: 'Reference file path for context.' },
    { name: 'line', type: 'number', required: false, description: 'Reference line number.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.symbol !== 'string') throw new Error('symbol must be a string');
      const escaped = params.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b(class|function|const|let|var|interface|type|def|func|struct|enum)\\s+${escaped}\\b|\\b${escaped}\\s*[:=]\\s*`, 'g');
      const matches = await searchCode(pattern, '.');
      return { success: true, output: matches.length ? matches.join('\n') : `No likely definition found for ${params.symbol}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to get definition' };
    }
  }
};

export const getReferencesTool: ToolDefinition = {
  name: 'get_references',
  description: 'Find references to a symbol across the codebase.',
  params: [
    { name: 'symbol', type: 'string', required: true, description: 'Symbol to search for.' },
    { name: 'directory', type: 'string', required: false, description: 'Directory to search. Defaults to ".".' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.symbol !== 'string') throw new Error('symbol must be a string');
      const escaped = params.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = await searchCode(new RegExp(`\\b${escaped}\\b`, 'g'), params.directory);
      return { success: true, output: matches.length ? matches.join('\n') : `No references found for ${params.symbol}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to get references' };
    }
  }
};

export const semanticSearchTool: ToolDefinition = {
  name: 'semantic_search',
  description: 'Natural-language-ish search by scoring files for query terms. Embeddings are not required.',
  params: [
    { name: 'query', type: 'string', required: true, description: 'Natural language query.' },
    { name: 'directory', type: 'string', required: false, description: 'Directory to search. Defaults to ".".' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.query !== 'string') throw new Error('query must be a string');
      const terms = params.query.toLowerCase().split(/[^a-z0-9_]+/).filter(term => term.length > 2);
      const scored: Array<{ file: string; score: number; preview: string }> = [];
      await walkFiles(resolveWorkspacePath(params.directory), async filePath => {
        if (!CODE_EXTENSIONS.has(path.extname(filePath)) && !['.md', '.json'].includes(path.extname(filePath))) return;
        const content = await fs.readFile(filePath, 'utf8').catch(() => '');
        const lower = content.toLowerCase();
        const score = terms.reduce((sum, term) => sum + (lower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length ?? 0), 0);
        if (score > 0) scored.push({ file: path.relative(process.cwd(), filePath), score, preview: content.split(/\r?\n/).find(line => terms.some(term => line.toLowerCase().includes(term)))?.trim() ?? '' });
      }, 2000);
      scored.sort((a, b) => b.score - a.score);
      const output = scored.slice(0, 20).map(item => `${item.file} (score ${item.score})\n  ${item.preview}`).join('\n');
      return { success: true, output: output ? cap(output) : `No semantic matches found for ${params.query}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Semantic search failed' };
    }
  }
};
