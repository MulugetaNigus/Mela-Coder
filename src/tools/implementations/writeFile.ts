import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { resolveWorkspacePath } from './toolUtils';
import { promptDiff } from '../../ui/diff';

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

      let oldContent = '';
      try {
        oldContent = await fs.readFile(filePath, 'utf8');
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }

      const decision = await promptDiff(oldContent, params.content, params.path);
      if (decision === 'skip') {
        return { success: false, output: '', error: `[SKIPPED] User declined applying the changes to ${params.path}` };
      }
      if (decision === 'abort') {
        return { success: false, output: '', error: `[ABORTED] User aborted the modification to ${params.path}` };
      }

      const tmpPath = `${filePath}.tmp`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(tmpPath, params.content, 'utf8');
      await fs.rename(tmpPath, filePath);
      const bytes = Buffer.byteLength(params.content, 'utf8');
      const lines = params.content.split(/\r?\n/).length;
      return { success: true, output: `Written ${bytes} bytes to ${params.path}\nResolved: ${filePath}\nLines: ${lines}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to write file' };
    }
  }
};
