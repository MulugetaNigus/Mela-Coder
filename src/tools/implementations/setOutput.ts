import type { ToolDefinition, ToolResult } from '../registry';

/**
 * set_output tool - For sub-agents to report their findings.
 * This is intentionally kept separate from the main tool registry
 * and only registered for sub-agents.
 */
export const setOutputTool: ToolDefinition = {
  name: 'set_output',
  description: 'Report the results of your sub-agent task. Call this when you have gathered enough information. Pass your findings as structured data.',
  params: [
    { name: 'data', type: 'string', required: false, description: 'JSON stringified data object with your findings.' },
    { name: 'message', type: 'string', required: false, description: 'Simple text message with your results.' }
  ],
  async execute(params): Promise<ToolResult> {
    const data = typeof params.data === 'string' ? params.data : '';
    const message = typeof params.message === 'string' ? params.message : '';
    return {
      success: true,
      output: data || message || 'Task complete (no output provided).'
    };
  }
};
