import type { ToolDefinition, ToolResult } from '../registry';
import { runCommand } from './toolUtils';

export const showDiffTool: ToolDefinition = {
  name: 'show_diff',
  description: 'Pretty-print a git diff for review.',
  params: [{ name: 'path', type: 'string', required: false, description: 'Optional file path.' }],
  async execute(params): Promise<ToolResult> {
    const cmd = typeof params.path === 'string' ? `git diff -- ${JSON.stringify(params.path)}` : 'git diff';
    const result = await runCommand(cmd, 30000);
    return { success: result.success, output: result.output, error: result.error };
  }
};

export const doneTool: ToolDefinition = {
  name: 'done',
  description: 'Signal that the task is complete. Prefer emitting <done/> directly.',
  params: [{ name: 'summary', type: 'string', required: false, description: 'Optional completion summary.' }],
  async execute(params): Promise<ToolResult> {
    return { success: true, output: typeof params.summary === 'string' ? params.summary : 'Task complete.' };
  }
};
