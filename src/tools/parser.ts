export interface ParsedToolCall {
  name: string;
  params: Record<string, string | number | boolean>;
}

export interface ParseResult {
  thinking: string | null;
  toolCall: ParsedToolCall | null;
  toolCalls: ParsedToolCall[];
  text: string | null;
  isDone: boolean;
  isError: string | null;
}

// ─── XML Parser (legacy, kept for internal tool compatibility) ────────────────

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function coerceValue(value: string): string | number | boolean {
  const trimmed = decodeXmlEntities(value.trim());
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return Number(trimmed);
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;
  return trimmed;
}

export function parseModelResponse(raw: string): ParseResult {
  if (typeof raw !== 'string') {
    return {
      thinking: null,
      toolCall: null,
      toolCalls: [],
      text: null,
      isDone: false,
      isError: `Invalid model response: expected string, got ${typeof raw}`
    };
  }

  const thinkMatches = Array.from(raw.matchAll(/<think>([\s\S]*?)<\/think>/gi));
  const thinking = thinkMatches.length
    ? thinkMatches.map(match => match[1].trim()).filter(Boolean).join('\n\n')
    : null;
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const errorMatch = cleaned.match(/<error>([\s\S]*?)<\/error>/i);
  const toolMatch = cleaned.match(/<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/i);
  let toolCall: ParsedToolCall | null = null;

  if (toolMatch) {
    const [, name, body] = toolMatch;
    const params: Record<string, string | number | boolean> = {};
    const paramMatches = Array.from(body.matchAll(/<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/g));
    for (const match of paramMatches) {
      params[match[1]] = coerceValue(match[2]);
    }
    toolCall = { name, params };
  }

  const withoutTerminalTags = cleaned
    .replace(/<done\s*\/>/gi, '')
    .replace(/<error>[\s\S]*?<\/error>/gi, '')
    .replace(/<tool_call\s+name=["'][^"']+["']\s*>[\s\S]*?<\/tool_call>/gi, '')
    .trim();

  return {
    thinking,
    toolCall,
    toolCalls: toolCall ? [toolCall] : [],
    text: toolCall ? null : withoutTerminalTags || null,
    isDone: /<done\s*\/>/i.test(cleaned),
    isError: errorMatch ? errorMatch[1].trim() : null
  };
}

// ─── Mela Fenced-Block Parser ─────────────────────────────────────────────────

// Matches fenced tool blocks: ```tool_name\ncontent``` (handles any line ending)
const FENCED_TOOL_RE = /```(\w+)[ \t]*\r?\n?([\s\S]*?)```/g;

/**
 * Parse Mela model response which uses backtick-fenced tool blocks
 * instead of XML. Returns the same ParseResult interface.
 *
 * Supported tool formats:
 *   ```read_file\n/path/to/file\n```
 *   ```write_file\n/path\ncontent\n```
 *   ```run_cmd\ncommand\n```
 *   ```list_files\n/path\n```
 *   ```done\n``` or text with "done" indicator
 */
export function parseMelaResponse(raw: string): ParseResult {
  if (typeof raw !== 'string') {
    return {
      thinking: null,
      toolCall: null,
      toolCalls: [],
      text: null,
      isDone: false,
      isError: `Invalid model response: expected string, got ${typeof raw}`
    };
  }

  // Check for <think> tags (some models may still use them)
  const thinkMatches = Array.from(raw.matchAll(/<think>([\s\S]*?)<\/think>/gi));
  const thinking = thinkMatches.length
    ? thinkMatches.map(match => match[1].trim()).filter(Boolean).join('\n\n')
    : null;
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Check for done indicators
  const isDone = /\[done\]/i.test(cleaned) || /<done\s*\/>/i.test(cleaned);

  // Check for error
  const errorMatch = cleaned.match(/<error>([\s\S]*?)<\/error>/i) || cleaned.match(/\[error\]\s*(.+?)(?:\n|$)/i);
  const isError = errorMatch ? (errorMatch[1] || errorMatch[0]).trim() : null;

  // Find fenced tool blocks
  FENCED_TOOL_RE.lastIndex = 0;
  const matches = Array.from(cleaned.matchAll(FENCED_TOOL_RE));
  const toolCalls: ParsedToolCall[] = [];

  if (matches.length > 0) {
    for (const match of matches) {
      const [, name, content] = match;
      const params = parseFencedToolParams(name, content);
      toolCalls.push({ name, params });
    }

    return {
      thinking,
      toolCall: toolCalls[0],
      toolCalls,
      text: null,
      isDone,
      isError
    };
  }

  // No tool call — extract visible text
  const withoutDone = cleaned
    .replace(/\[done\]/gi, '')
    .replace(/<done\s*\/>/gi, '')
    .trim();

  return {
    thinking,
    toolCall: null,
    toolCalls: [],
    text: withoutDone || null,
    isDone,
    isError
  };
}

export function stripParamLabel(s: string): string {
  return s.replace(/^(?:cmd|command|path|content|name|pattern|question|summary|old_str|new_str|old_string|new_string|oldString|newString|key|value|query|symbol|from|to|directory|cwd|url|file_glob|message)\s*[:=]\s*/i, '');
}

function parseFencedToolParams(name: string, content: string): Record<string, string | number | boolean> {
  const trimmed = content.trim();

  // JSON format: {"path":"...","content":"..."} — check before tool-specific parsing
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch { /* fall through to tool-specific parsing */ }
  }

  switch (name) {
    case 'write_file': {
      const lines = trimmed.split('\n');
      const filePath = stripParamLabel(lines[0]).trim();
      let fileContent = lines.slice(1).join('\n');
      fileContent = fileContent.replace(/^content\s*:\s*/i, '');
      return { path: filePath, content: fileContent.trim() };
    }

    case 'edit_file': {
      const lines = trimmed.split('\n');
      const filePath = stripParamLabel(lines[0]).trim();
      const body = lines.slice(1).join('\n');
      const markerMatch = body.match(/(?:^|\n)---OLD---\s*\n([\s\S]*?)\n---NEW---\s*\n([\s\S]*)$/);
      if (markerMatch) {
        return { path: filePath, old_str: markerMatch[1], new_str: markerMatch[2] };
      }
      return { path: filePath, old_str: stripParamLabel(lines[1] || '').trim(), new_str: stripParamLabel(lines[2] || '').trim() };
    }

    case 'str_replace': {
      const lines = trimmed.split('\n');
      const filePath = stripParamLabel(lines[0]).trim();
      const body = lines.slice(1).join('\n');
      const markerMatch = body.match(/(?:^|\n)---OLD---\s*\n([\s\S]*?)\n---NEW---\s*\n([\s\S]*)$/);
      if (markerMatch) {
        return { path: filePath, oldString: markerMatch[1], newString: markerMatch[2] };
      }
      return { path: filePath, oldString: stripParamLabel(lines[1] || '').trim(), newString: stripParamLabel(lines[2] || '').trim() };
    }

    case 'run_cmd':
    case 'execute_bash':
      return { cmd: stripParamLabel(trimmed) };

    case 'list_dir':
    case 'list_files':
      return { path: stripParamLabel(trimmed) || '.' };

    case 'done':
      return { summary: stripParamLabel(trimmed) || '' };

    case 'search_files':
    case 'grep': {
      const lines = trimmed.split('\n');
      return { pattern: stripParamLabel(lines[0] || '').trim(), directory: stripParamLabel(lines[1] || '.').trim() };
    }

    case 'glob': {
      const lines = trimmed.split('\n');
      return { pattern: stripParamLabel(lines[0] || '').trim(), cwd: stripParamLabel(lines[1] || '.').trim() };
    }

    case 'find_symbol':
      return { symbol: stripParamLabel(trimmed) };

    case 'semantic_search':
      return { query: stripParamLabel(trimmed) };

    case 'ask_user':
      return { question: stripParamLabel(trimmed) };

    case 'delete_file':
    case 'make_dir':
    case 'read_file':
      return { path: stripParamLabel(trimmed) };

    case 'copy_file':
    case 'rename_file': {
      const lines = trimmed.split('\n');
      return { from: stripParamLabel(lines[0] || '').trim(), to: stripParamLabel(lines[1] || '').trim() };
    }

    case 'remember': {
      const lines = trimmed.split('\n');
      return { key: stripParamLabel(lines[0] || '').trim(), value: stripParamLabel(lines.slice(1).join('\n')).trim() };
    }

    case 'recall':
      return { query: stripParamLabel(trimmed) };

    case 'web_search':
      return { query: stripParamLabel(trimmed) };

    case 'fetch_url':
    case 'read_github_issue':
    case 'read_github_file':
      return { url: stripParamLabel(trimmed) };

    case 'git_commit':
      return { message: stripParamLabel(trimmed) };

    case 'git_create_branch':
      return { name: stripParamLabel(trimmed) };

    case 'file_info':
      return { path: stripParamLabel(trimmed) };

    case 'find_files': {
      const lines = trimmed.split('\n');
      return { pattern: stripParamLabel(lines[0] || '').trim(), directory: stripParamLabel(lines[1] || '.').trim() };
    }

    case 'show_diff':
      return { path: stripParamLabel(trimmed) };

    case 'summarize_context':
      return { content: stripParamLabel(trimmed) };

    case 'get_definition':
    case 'get_references':
      return { symbol: stripParamLabel(trimmed) };

    case 'spawn_agents':
    case 'spawn_agent':
      return { agents: stripParamLabel(trimmed) };

    case 'task_notes':
      return { action: 'read', content: stripParamLabel(trimmed) };

    case 'write_todos':
      return { todos: stripParamLabel(trimmed) };

    case 'suggest_followups':
      return { followups: stripParamLabel(trimmed) };

    default: {
      if (typeof trimmed === 'string' && trimmed) {
        return { content: stripParamLabel(trimmed) };
      }
      return {};
    }
  }
}
