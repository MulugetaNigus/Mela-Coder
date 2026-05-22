import type { ToolDefinition, ToolResult, ToolRegistry } from '../registry';

export function createGetToolDefinitionsTool(registry: ToolRegistry): ToolDefinition {
  return {
    name: 'get_tool_definitions',
    description: 'Get the full parameter schema of all available tools. Use this when a tool call fails with "Missing required param" to check the exact parameter names, types, and descriptions that each tool expects.',
    params: [
      {
        name: 'tool_name',
        type: 'string',
        required: false,
        description: 'Optional tool name to filter. Returns only that tool\'s schema if provided, otherwise returns all tools.'
      }
    ],
    async execute(params): Promise<ToolResult> {
      const all = registry.all();
      const filter = typeof params.tool_name === 'string' && params.tool_name.trim()
        ? all.filter(t => t.name === params.tool_name)
        : all;

      if (typeof params.tool_name === 'string' && params.tool_name.trim() && filter.length === 0) {
        return { success: false, output: '', error: `Unknown tool: "${params.tool_name}"` };
      }

      const lines: string[] = [];
      for (const tool of filter) {
        lines.push(`\n${tool.name}`);
        lines.push(`  Description: ${tool.description}`);
        lines.push(`  Parameters:`);
        if (tool.params.length === 0) {
          lines.push(`    (none)`);
        } else {
          for (const param of tool.params) {
            const req = param.required ? 'required' : 'optional';
            lines.push(`    ${param.name} (${param.type}, ${req}): ${param.description}`);
          }
        }
      }

      return { success: true, output: lines.join('\n') };
    }
  };
}
