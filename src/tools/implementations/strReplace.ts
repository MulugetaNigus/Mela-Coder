import { promises as fs } from 'node:fs';
import type { ToolDefinition, ToolResult } from '../registry';
import { renderDiff, resolveWorkspacePath } from './toolUtils';
import { promptDiff } from '../../ui/diff';

export const strReplaceTool: ToolDefinition = {
  name: 'str_replace',
  description: 'Replace an exact string match in a file with a new string. For multiple replacements, call this tool multiple times. Each call applies a single replacement.',
  params: [
    { name: 'path', type: 'string', required: true, description: 'Path to the file to edit.' },
    { name: 'oldString', type: 'string', required: true, description: 'The exact string to replace. Must be an exact match including whitespace.' },
    { name: 'newString', type: 'string', required: true, description: 'The replacement string. Can be empty to delete the matched text.' },
    { name: 'allowMultiple', type: 'boolean', required: false, description: 'If true, replaces ALL occurrences. If false/omitted, only replaces the first occurrence.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const filePath = typeof params.path === 'string' ? params.path : '';
      const oldString = typeof params.oldString === 'string' ? params.oldString : '';
      const newString = typeof params.newString === 'string' ? params.newString : '';
      const allowMultiple = params.allowMultiple === true;

      if (!filePath) throw new Error('path must be a string');
      if (!oldString) throw new Error('oldString must be a non-empty string');
      if (typeof params.newString !== 'string') throw new Error('newString must be a string (can be empty)');

      const resolvedPath = resolveWorkspacePath(filePath);
      const oldContent = await fs.readFile(resolvedPath, 'utf8');

      const count = oldContent.split(oldString).length - 1;
      if (count === 0) {
        return { success: false, output: '', error: `oldString was not found in file: ${JSON.stringify(oldString.slice(0, 100))}` };
      }

      if (count > 1 && !allowMultiple) {
        return { success: false, output: '', error: `oldString matched ${count} times. Set allowMultiple=true or provide a more specific string.` };
      }

      let newContent = '';
      if (allowMultiple) {
        newContent = oldContent.split(oldString).join(newString);
      } else {
        newContent = oldContent.replace(oldString, newString);
      }

      const decision = await promptDiff(oldContent, newContent, filePath);
      if (decision === 'skip') {
        return { success: false, output: '', error: `[SKIPPED] User declined applying the changes to ${filePath}` };
      }
      if (decision === 'abort') {
        return { success: false, output: '', error: `[ABORTED] User aborted the modification to ${filePath}` };
      }

      const tmpPath = `${resolvedPath}.tmp`;
      await fs.writeFile(tmpPath, newContent, 'utf8');
      await fs.rename(tmpPath, resolvedPath);

      const occurrences = allowMultiple ? count : 1;
      return {
        success: true,
        output: `Edited ${filePath} (replaced ${occurrences} occurrence(s))\n${renderDiff(oldString, newString)}`
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return { success: false, output: '', error: `File not found: ${params.path}` };
      }
      return { success: false, output: '', error: err?.message ?? 'Failed to apply replacement' };
    }
  }
};
