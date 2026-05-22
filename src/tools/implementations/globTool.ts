import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { resolveWorkspacePath, SKIP_DIRS, globToRegExp } from './toolUtils';

async function getMtime(filePath: string): Promise<Date> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtime;
  } catch {
    return new Date(0);
  }
}

export const globTool: ToolDefinition = {
  name: 'glob',
  description: 'Search for files matching a glob pattern. Returns matching file paths sorted by modification time (most recent first). Supports * (single segment), ** (multi-segment), ? (single char), {a,b} (alternation).',
  params: [
    { name: 'pattern', type: 'string', required: true, description: 'Glob pattern to match files against (e.g., "*.js", "src/**/*.ts", "**/test_*.go").' },
    { name: 'cwd', type: 'string', required: false, description: 'Optional working directory to search within, relative to project root. Defaults to ".".' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const pattern: string = typeof params.pattern === 'string' ? params.pattern : '';
      const cwd: string = typeof params.cwd === 'string' ? params.cwd : '.';
      if (!pattern) throw new Error('pattern must be a string');

      const root = resolveWorkspacePath(cwd);
      const regex = globToRegExp(pattern);
      const matches: string[] = [];

      async function walk(dir: string): Promise<void> {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return; // skip unreadable directories
        }

        for (const entry of entries) {
          if (SKIP_DIRS.has(entry.name)) continue;
          if (entry.name.startsWith('.') && !pattern.startsWith('.')) continue;

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(process.cwd(), fullPath);

          if (entry.isDirectory()) {
            if (pattern.includes('**')) {
              await walk(fullPath);
            }
            const hasDirPrefix = pattern.includes('/');
            if (hasDirPrefix && !pattern.includes('**')) {
              await walk(fullPath);
            }
          } else if (entry.isFile()) {
            if (regex.test(relativePath) || regex.test(entry.name)) {
              matches.push(relativePath);
            }
          }
        }
      }

      await walk(root);

      // Sort by modification time, most recent first
      const withMtimes = await Promise.all(
        matches.map(async (filePath) => ({
          path: filePath,
          mtime: await getMtime(path.resolve(process.cwd(), filePath))
        }))
      );
      withMtimes.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const sorted = withMtimes.map(m => m.path);
      if (sorted.length === 0) {
        return { success: true, output: `No files found matching pattern: ${pattern}` };
      }

      return { success: true, output: sorted.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to search with glob' };
    }
  }
};
