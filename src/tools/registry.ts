export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  params: ToolParam[];
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  all(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  toSystemPromptSchema(): string {
    return this.all()
      .map(tool => {
        const params = tool.params
          .map(
            param =>
              `    <param name="${escapeXml(param.name)}" type="${param.type}" required="${param.required}">${escapeXml(param.description)}</param>`
          )
          .join('\n');
        const exampleParams = tool.params
          .filter(param => param.required || param.name === 'start_line' || param.name === 'end_line')
          .map(param => `      <${param.name}>${exampleValue(param)}</${param.name}>`)
          .join('\n');

        return `<tool name="${escapeXml(tool.name)}">
  <description>${escapeXml(tool.description)}</description>
  <params>
${params}
  </params>
  <example>
    <tool_call name="${escapeXml(tool.name)}">
${exampleParams}
    </tool_call>
  </example>
</tool>`;
      })
      .join('\n\n');
  }
}

function exampleValue(param: ToolParam): string {
  if (param.name === 'path') return 'src/index.ts';
  if (param.name === 'content') return 'file content here';
  if (param.name === 'cmd') return 'npm install';
  if (param.name === 'question') return 'Which database should I use?';
  if (param.name === 'pattern') return 'createAgent';
  if (param.name === 'directory') return 'src';
  if (param.name === 'start_line') return '1';
  if (param.name === 'end_line') return '50';
  if (param.type === 'number') return '1';
  if (param.type === 'boolean') return 'false';
  return 'value';
}
