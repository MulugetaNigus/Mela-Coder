import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { resolveWorkspacePath } from './toolUtils';

const SKIP_NAMES = new Set(['node_modules', '.git', 'dist', '__pycache__']);

export const listDirTool: ToolDefinition = {
  name: 'list_dir',
  description: 'List directory contents as an indented tree.',
  params: [
    { name: 'path', type: 'string', required: false, description: 'Directory path. Defaults to ".".' },
    { name: 'depth', type: 'number', required: false, description: 'Maximum tree depth. Defaults to 2.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const inputPath = typeof params.path === 'string' ? params.path : '.';
      const root = resolveWorkspacePath(inputPath);
      const depth = typeof params.depth === 'number' ? params.depth : 2;
      const lines: string[] = [];
      let count = 0;
      let omitted = 0;

      async function walk(dir: string, level: number, prefix: string): Promise<void> {
        if (level > depth) return;
        const entries = (await fs.readdir(dir, { withFileTypes: true }))
          .filter(entry => !SKIP_NAMES.has(entry.name) && !entry.name.endsWith('.pyc'))
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index];
          if (count >= 200) {
            omitted++;
            continue;
          }
          const fullPath = path.join(dir, entry.name);
          const isLast = index === entries.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const name = `${entry.name}${entry.isDirectory() ? '/' : ''}`;
          lines.push(`${prefix}${connector}${name}`);
          count++;
          if (entry.isDirectory()) await walk(fullPath, level + 1, `${prefix}${isLast ? '    ' : '│   '}`);
        }
      }

      const stat = await fs.stat(root);
      if (!stat.isDirectory()) return { success: false, output: '', error: `Directory not found: ${inputPath}` };
      lines.push(`${inputPath.replace(/\/$/, '') || '.'}/`);
      await walk(root, 1, '');
      if (omitted) lines.push(`[${omitted} entries omitted]`);
      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { success: false, output: '', error: `Directory not found: ${String(params.path ?? '.')}` };
      return { success: false, output: '', error: err?.message ?? 'Failed to list directory' };
    }
  }
};
