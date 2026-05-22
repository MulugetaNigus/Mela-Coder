import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { resolveWorkspacePath } from './toolUtils';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write complete content to a file at the given path.',
  params: [
    { name: 'path', type: 'string', required: true, description: 'Absolute or relative file path.' },
    { name: 'content', type: 'string', required: true, description: 'Full file content to write.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.path !== 'string') throw new Error('path must be a string');
      if (typeof params.content !== 'string') throw new Error('content must be a string');
      const filePath = resolveWorkspacePath(params.path);
      const tmpPath = `${filePath}.tmp`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(tmpPath, params.content, 'utf8');
      await fs.rename(tmpPath, filePath);
      const bytes = Buffer.byteLength(params.content, 'utf8');
      const preview = params.content.split(/\r?\n/).slice(0, 5).join('\n');
      return { success: true, output: `Written ${bytes} bytes to ${params.path}\nResolved: ${filePath}\nPreview:\n${preview}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to write file' };
    }
  }
};
