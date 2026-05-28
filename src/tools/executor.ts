import type { ParsedToolCall } from './parser';
import type { ToolRegistry, ToolResult } from './registry';
import { executeBashTool } from './implementations/executeBash';
import { classifyToolCall, PermissionGate, PermissionTier } from '../safety/permissions';

let activeGate = new PermissionGate();

export function setPermissionGate(gate: PermissionGate): void {
  activeGate = gate;
}

function normalizeScalar(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeParams(name: string, params: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    normalized[key] = normalizeScalar(value);
  }

  const alias = (target: string, aliases: string[]): void => {
    if (normalized[target] !== undefined) return;
    for (const key of aliases) {
      if (normalized[key] !== undefined) {
        normalized[target] = normalized[key];
        return;
      }
    }
  };

  alias('path', ['file_path', 'filepath', 'file', 'filename', 'target_file', 'target']);
  alias('cmd', ['command', 'shell', 'bash']);
  alias('directory', ['dir', 'cwd', 'path']);
  alias('cwd', ['directory', 'dir', 'path']);
  alias('pattern', ['query', 'text', 'regex', 'glob']);
  alias('query', ['pattern', 'text', 'search']);
  alias('url', ['href', 'link']);
  alias('symbol', ['name', 'identifier']);
  alias('message', ['summary', 'content']);
  alias('summary', ['message', 'content']);
  alias('old_str', ['oldString', 'old_string', 'old']);
  alias('new_str', ['newString', 'new_string', 'new']);
  alias('oldString', ['old_str', 'old_string', 'old']);
  alias('newString', ['new_str', 'new_string', 'new']);
  alias('replace_all', ['replaceAll', 'allowMultiple']);
  alias('allowMultiple', ['replace_all', 'replaceAll']);
  alias('from', ['source', 'src']);
  alias('to', ['destination', 'dest', 'target']);
  alias('job_id', ['jobId', 'id']);
  alias('start_line', ['startLine', 'start']);
  alias('end_line', ['endLine', 'end']);
  alias('max_chars', ['maxChars', 'limit']);
  alias('file_glob', ['fileGlob', 'glob']);

  if ((name === 'list_dir' || name === 'list_files') && typeof normalized.path !== 'string') normalized.path = '.';
  if (name === 'task_notes' && typeof normalized.action !== 'string') normalized.action = 'read';

  return normalized;
}

export async function executeTool(call: ParsedToolCall, registry: ToolRegistry): Promise<ToolResult> {
  const tool = registry.get(call.name);
  if (!tool) {
    return { success: false, output: '', error: `Unknown tool: "${call.name}"` };
  }
  call = { ...call, params: normalizeParams(call.name, call.params) };

  for (const param of tool.params.filter(p => p.required)) {
    if (!(param.name in call.params)) {
      return { success: false, output: '', error: `Missing required param: ${param.name}` };
    }
  }

  const tier = classifyToolCall(call.name, call.params);
  if (tier > PermissionTier.READ) {
    const path = String(call.params.path ?? call.params.file_path ?? call.params.old_str ?? call.params.cmd ?? call.params.command ?? '');
    const desc = path || String(call.params.content ?? '').slice(0, 60);
    const allowed = await activeGate.check(tier, `${call.name} → ${desc}`);
    if (!allowed) {
      return { success: false, output: '', error: `[BLOCKED] User denied permission: ${call.name} → ${desc}` };
    }
  }

  try {
    const result = await tool.execute(call.params);
    if (!result.success && call.name === 'execute_bash') {
      const retry = await autoFallback(result.error ?? result.output, call.params);
      if (retry) return retry;
    }
    return result;
  } catch (err: any) {
    return { success: false, output: '', error: err?.message ?? 'Tool execution failed' };
  }
}

async function autoFallback(errorText: string, params: Record<string, unknown>): Promise<ToolResult | null> {
  const match = errorText.match(/ (\S+): (?:command )?not found/);
  if (!match) return null;
  const cmd = match[1];
  const alternatives = COMMAND_ALTERNATIVES[cmd];
  if (!alternatives || alternatives.length === 0) return null;

  for (const alt of alternatives) {
    const altResult = await tryFallback(alt, params);
    if (altResult) return altResult;
  }
  return null;
}

async function tryFallback(alt: string, params: Record<string, unknown>): Promise<ToolResult | null> {
  const originalCmd = (typeof params.cmd === 'string' ? params.cmd : typeof params.command === 'string' ? params.command : '') as string;
  const firstWord = originalCmd.split(' ')[0];
  const fallbackCmd = originalCmd.replace(firstWord, alt);
  try {
    const result = await executeBashTool.execute({ ...params, cmd: fallbackCmd });
    if (result.success) {
      return { success: true, output: `[Auto-fallback: ${firstWord} → ${alt}]\n${result.output}` };
    }
  } catch {
    // Fallback failed, try next alternative
  }
  return null;
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

const ERROR_PATTERNS: Array<[RegExp, string]> = [
  [/TS\d{4}|TypeError|type error/i, 'TYPE_ERROR'],
  [/ECONNREFUSED|ENOTFOUND|ERR_CONNECTION|network error|fetch failed/i, 'NETWORK_ISSUE'],
  [/command not found|not found|no such file/i, 'MISSING_TOOL'],
  [/SyntaxError|parse error|Unexpected token/i, 'SYNTAX_ERROR'],
  [/Module not found|Cannot find module|import resolution/i, 'MODULE_ERROR'],
  [/ETIMEDOUT|timed out/i, 'TIMEOUT'],
  [/EACCES|permission denied/i, 'PERMISSION_ERROR'],
  [/ENOSPC|no space/i, 'DISK_SPACE'],
];

function categorizeError(output: string): string {
  for (const [pattern, tag] of ERROR_PATTERNS) {
    if (pattern.test(output)) return tag;
  }
  return '';
}

export function formatToolResult(toolName: string, result: ToolResult): string {
  const errorTag = !result.success ? categorizeError(result.error ?? result.output) : '';
  const tagStr = errorTag ? ` [${errorTag}]` : '';
  const base = result.success ? result.output : `[FAILED${tagStr}] ${result.error}\n${result.output ?? ''}`;
  return `<tool_result name="${toolName}" success="${result.success}">
${base}
</tool_result>`;
}
