import type { ParsedToolCall } from './parser';
import type { ToolRegistry, ToolResult } from './registry';

export async function executeTool(call: ParsedToolCall, registry: ToolRegistry): Promise<ToolResult> {
  const tool = registry.get(call.name);
  if (!tool) {
    return { success: false, output: '', error: `Unknown tool: "${call.name}"` };
  }

  for (const param of tool.params.filter(p => p.required)) {
    if (!(param.name in call.params)) {
      return { success: false, output: '', error: `Missing required param: ${param.name}` };
    }
  }

  try {
    return await tool.execute(call.params);
  } catch (err: any) {
    return { success: false, output: '', error: err?.message ?? 'Tool execution failed' };
  }
}

const COMMAND_ALTERNATIVES: Record<string, string[]> = {
  python: ['python3', 'python3.10', 'python3.11', 'python3.12'],
  node: ['nodejs'],
  npm: ['yarn', 'pnpm'],
  pip: ['pip3'],
  java: ['java17', 'java11'],
  javac: ['javac17', 'javac11'],
  go: ['go1.21', 'go1.22'],
  cargo: ['rustc'],
  gem: ['bundle'],
  php: ['php8.1', 'php8.2'],
  ruby: ['ruby3.0', 'ruby3.1'],
};

function suggestCommandAlternatives(errorText: string): string {
  const match = errorText.match(/ (\S+): (?:command )?not found/);
  if (!match) return '';
  const cmd = match[1];
  const alternatives = COMMAND_ALTERNATIVES[cmd];
  if (!alternatives) return '';
  return `\nHINT: "${cmd}" was not found. Try: ${alternatives.map(a => `\`${a}\``).join(', ')}. Do not ask the user — try one of these automatically.`;
}

export function formatToolResult(toolName: string, result: ToolResult): string {
  const base = result.success ? result.output : `[FAILED] ${result.error}\n${result.output ?? ''}`;
  const hint = !result.success && toolName === 'execute_bash' ? suggestCommandAlternatives(base) : '';
  return `<tool_result name="${toolName}" success="${result.success}">
${base}${hint}
</tool_result>`;
}
