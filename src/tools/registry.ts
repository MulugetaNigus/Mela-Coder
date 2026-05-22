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
              `  ${param.name} (${param.type}, ${param.required ? 'required' : 'optional'}): ${param.description}`
          )
          .join('\n');
        return `${tool.name} : ${tool.description}\n${params}`;
      })
      .join('\n\n');
  }
}
