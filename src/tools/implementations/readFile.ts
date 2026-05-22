import { promises as fs } from 'node:fs';
import type { ToolDefinition, ToolResult } from '../registry';
import { resolveWorkspacePath } from './toolUtils';

function formatLines(lines: string[], offset: number): string {
  return lines.map((line, index) => `${String(offset + index).padStart(4, ' ')} | ${line}`).join('\n');
}

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file at the given path.',
  params: [
    { name: 'path', type: 'string', required: true, description: 'Absolute or relative file path.' },
    { name: 'start_line', type: 'number', required: false, description: 'Start line (1-indexed). Omit for full file.' },
    { name: 'end_line', type: 'number', required: false, description: 'End line (inclusive). Omit for full file.' }
  ],
  async execute(params): Promise<ToolResult> {
    let filePath = '';
    try {
      if (typeof params.path !== 'string') throw new Error('path must be a string');
      filePath = resolveWorkspacePath(params.path);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      const startLine = typeof params.start_line === 'number' ? Math.max(1, params.start_line) : undefined;
      const endLine = typeof params.end_line === 'number' ? Math.max(1, params.end_line) : undefined;

      if (startLine || endLine) {
        const start = startLine ?? 1;
        const end = endLine ?? lines.length;
        return { success: true, output: formatLines(lines.slice(start - 1, end), start) };
      }

      if (lines.length > 500) {
        const omitted = lines.length - 100;
        return {
          success: true,
          output: `${formatLines(lines.slice(0, 100), 1)}\n[File truncated. ${omitted} more lines. Use start_line/end_line to read more.]`
        };
      }

      return { success: true, output: formatLines(lines, 1) };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { success: false, output: '', error: `File not found: ${String(params.path)}\nResolved: ${filePath}` };
      if (err?.code === 'EISDIR') return { success: false, output: '', error: 'Path is a directory. Use list_dir.' };
      return { success: false, output: '', error: err?.message ?? 'Failed to read file' };
    }
  }
};
