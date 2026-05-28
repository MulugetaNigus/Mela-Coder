export interface ParsedToolCall {
  name: string;
  params: Record<string, any>;
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
    text: withoutTerminalTags || null,
    isDone: /<done\s*\/>/i.test(cleaned),
    isError: errorMatch ? errorMatch[1].trim() : null
  };
}

// ─── Mela Fenced-Block Parser ─────────────────────────────────────────────────

// Matches triple-backtick fenced tool blocks: ```tool_name\ncontent```
const FENCED_TOOL_RE = /```(\w+)[ \t]*\r?\n?([\s\S]*?)```/g;

// Matches single-backtick fenced tool blocks: `tool_name\ncontent`
// Uses negative lookbehind to avoid matching inside triple backticks
const SINGLE_FENCED_TOOL_RE = /(?<!`)`(\w+)\r?\n?([\s\S]*?)`/g;

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
export function parseMelaResponse(raw: string, knownTools?: Set<string>): ParseResult {
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

  // Find fenced tool blocks (triple and single backtick)
  FENCED_TOOL_RE.lastIndex = 0;
  SINGLE_FENCED_TOOL_RE.lastIndex = 0;
  const tripleMatches = Array.from(cleaned.matchAll(FENCED_TOOL_RE));
  const singleMatches = Array.from(cleaned.matchAll(SINGLE_FENCED_TOOL_RE));
  const matches = [...tripleMatches, ...singleMatches];
  const toolCalls: ParsedToolCall[] = [];
  const toolSpans: Array<[number, number]> = [];

  if (matches.length > 0) {
    for (const match of matches) {
      const [, name, content] = match;
      // P1.1: Skip numeric-only names (e.g. "2026" from filenames in backticks)
      if (/^\d+$/.test(name)) continue;
      // P1.1: Skip names that aren't registered tools (prevents ghost tool calls)
      if (knownTools && knownTools.size > 0 && !knownTools.has(name)) continue;
      // Skip common language identifiers used in markdown code blocks
      if (['json', 'javascript', 'typescript', 'python', 'html', 'css', 'bash', 'sh',
           'sql', 'yaml', 'yml', 'xml', 'java', 'go', 'rust', 'ruby', 'php', 'c',
           'cpp', 'csharp', 'swift', 'kotlin', 'diff', 'plaintext', 'text', 'markdown',
           'md', 'toml', 'ini', 'log', 'csv', 'jsx', 'tsx'].includes(name)) continue;
      const params = parseFencedToolParams(name, content);
      toolCalls.push({ name, params });
      if (typeof match.index === 'number') {
        toolSpans.push([match.index, match.index + match[0].length]);
      }
    }

    if (toolCalls.length > 0) {
      const visibleText = removeRanges(cleaned, toolSpans)
        .replace(/\[done\]/gi, '')
        .replace(/<done\s*\/>/gi, '')
        .trim();
      return {
        thinking,
        toolCall: toolCalls[0],
        toolCalls,
        text: visibleText || null,
        isDone,
        isError
      };
    }
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

function removeRanges(value: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return value;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let result = '';
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start < cursor) continue;
    result += value.slice(cursor, start);
    cursor = end;
  }
  return result + value.slice(cursor);
}

export function stripParamLabel(s: string): string {
  return s.replace(/^(?:cmd|command|path|content|name|pattern|question|summary|old_str|new_str|old_string|new_string|oldString|newString|key|value|query|symbol|from|to|directory|cwd|url|file_glob|message)\s*[:=]\s*/i, '');
}

function stripWrappingQuotes(s: string): string {
  const trimmed = s.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function cleanScalar(s: string): string {
  return stripWrappingQuotes(stripParamLabel(s).trim());
}

function parseKvLines(lines: string[], base: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> {
  const params = { ...base };
  for (const line of lines) {
    const kvMatch = line.match(/^\s*([A-Za-z_][\w.-]*)\s*[:=]\s*(.+)$/);
    if (kvMatch) {
      const [, key, val] = kvMatch;
      params[key] = coerceValue(stripWrappingQuotes(val));
    }
  }
  return params;
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
      const filePath = cleanScalar(lines[0]);
      let fileContent = lines.slice(1).join('\n');
      fileContent = fileContent.replace(/^content\s*:\s*/i, '');
      return { path: filePath, content: fileContent.trim() };
    }

    case 'edit_file': {
      const lines = trimmed.split('\n');
      const filePath = cleanScalar(lines[0]);
      const body = lines.slice(1).join('\n');
      const markerMatch = body.match(/(?:^|\n)---OLD---\s*\n([\s\S]*?)\n---NEW---\s*\n([\s\S]*)$/);
      if (markerMatch) {
        let newStr = markerMatch[2];
        const options: Record<string, string | number | boolean> = {};
        const lines = newStr.split('\n');
        while (lines.length > 0) {
          const lastLine = lines[lines.length - 1].trim();
          const optMatch = lastLine.match(/^(replace_all|allowMultiple|replaceAll)\s*[:=]\s*(true|false)(?:\s+.*)?$/i);
          if (optMatch) {
            let key = optMatch[1].toLowerCase();
            if (key === 'replaceall' || key === 'replace_all') {
              key = 'replace_all';
            } else if (key === 'allowmultiple') {
              key = 'allowMultiple';
            }
            options[key] = coerceValue(optMatch[2]);
            lines.pop();
          } else if (lastLine === '') {
            lines.pop();
          } else {
            break;
          }
        }
        newStr = lines.join('\n');
        return { path: filePath, old_str: markerMatch[1], new_str: newStr, ...options };
      }
      return { path: filePath, old_str: cleanScalar(lines[1] || ''), new_str: cleanScalar(lines[2] || '') };
    }

    case 'str_replace': {
      const lines = trimmed.split('\n');
      const filePath = cleanScalar(lines[0]);
      const body = lines.slice(1).join('\n');
      const markerMatch = body.match(/(?:^|\n)---OLD---\s*\n([\s\S]*?)\n---NEW---\s*\n([\s\S]*)$/);
      if (markerMatch) {
        let newString = markerMatch[2];
        const options: Record<string, string | number | boolean> = {};
        const lines = newString.split('\n');
        while (lines.length > 0) {
          const lastLine = lines[lines.length - 1].trim();
          const optMatch = lastLine.match(/^(replace_all|allowMultiple|replaceAll)\s*[:=]\s*(true|false)(?:\s+.*)?$/i);
          if (optMatch) {
            let key = optMatch[1].toLowerCase();
            if (key === 'replaceall' || key === 'replace_all') {
              key = 'replace_all';
            } else if (key === 'allowmultiple') {
              key = 'allowMultiple';
            }
            options[key] = coerceValue(optMatch[2]);
            lines.pop();
          } else if (lastLine === '') {
            lines.pop();
          } else {
            break;
          }
        }
        newString = lines.join('\n');
        return { path: filePath, oldString: markerMatch[1], newString, ...options };
      }
      return { path: filePath, oldString: cleanScalar(lines[1] || ''), newString: cleanScalar(lines[2] || '') };
    }

    case 'run_cmd':
    case 'execute_bash':
      return { cmd: cleanScalar(trimmed) };

    case 'execute_long_running': {
      // Model may output just the command, or "cmd: <command>", or multi-line
      const lines = trimmed.split('\n');
      const firstLine = cleanScalar(lines[0]);
      if (lines.length === 1) return { cmd: firstLine };
      return parseKvLines(lines.slice(1), { cmd: firstLine });
    }

    case 'list_dir':
    case 'list_files': {
      const lines = trimmed.split('\n');
      return parseKvLines(lines.slice(1), { path: cleanScalar(lines[0] || '') || '.' });
    }

    case 'done':
      return { summary: cleanScalar(trimmed) || '' };

    case 'search_files':
    case 'grep': {
      const lines = trimmed.split('\n');
      return parseKvLines(lines.slice(2), { pattern: cleanScalar(lines[0] || ''), directory: cleanScalar(lines[1] || '.') });
    }

    case 'glob': {
      const lines = trimmed.split('\n');
      return parseKvLines(lines.slice(2), { pattern: cleanScalar(lines[0] || ''), cwd: cleanScalar(lines[1] || '.') });
    }

    case 'find_symbol':
      return { symbol: cleanScalar(trimmed) };

    case 'semantic_search':
      return { query: cleanScalar(trimmed) };

    case 'ask_user':
      return { question: cleanScalar(trimmed) };

    case 'read_file': {
      const lines = trimmed.split('\n');
      return parseKvLines(lines.slice(1), { path: cleanScalar(lines[0]) });
    }

    case 'delete_file':
    case 'make_dir':
      return { path: cleanScalar(trimmed) };

    case 'copy_file':
    case 'rename_file': {
      const lines = trimmed.split('\n');
      return parseKvLines(lines.slice(2), { from: cleanScalar(lines[0] || ''), to: cleanScalar(lines[1] || '') });
    }

    case 'remember': {
      const lines = trimmed.split('\n');
      return { key: cleanScalar(lines[0] || ''), value: cleanScalar(lines.slice(1).join('\n')) };
    }

    case 'recall':
      return { query: cleanScalar(trimmed) };

    case 'web_search':
      return { query: cleanScalar(trimmed) };

    case 'fetch_url':
    case 'read_github_issue':
    case 'read_github_file':
      return { url: cleanScalar(trimmed) };

    case 'git_commit':
      return { message: cleanScalar(trimmed) };

    case 'git_create_branch':
      return { name: cleanScalar(trimmed) };

    case 'file_info':
      return { path: cleanScalar(trimmed) };

    case 'find_files': {
      const lines = trimmed.split('\n');
      return parseKvLines(lines.slice(2), { pattern: cleanScalar(lines[0] || ''), directory: cleanScalar(lines[1] || '.') });
    }

    case 'show_diff':
      return { path: cleanScalar(trimmed) };

    case 'summarize_context':
      return { content: cleanScalar(trimmed) };

    case 'get_definition':
    case 'get_references':
      return { symbol: cleanScalar(trimmed) };

    case 'spawn_agents':
    case 'spawn_agent':
      return { agents: cleanScalar(trimmed) };

    case 'task_notes':
      return parseKvLines(trimmed.split('\n'), { action: 'read', content: cleanScalar(trimmed) });

    case 'write_todos':
      return { todos: cleanScalar(trimmed) };

    case 'suggest_followups':
      return { followups: cleanScalar(trimmed) };

    default: {
      // Try to extract known param patterns: "cmd: value", "path: value", etc.
      const kvMatch = trimmed.match(/^(cmd|command|path|file_path|query|url|pattern|message|symbol|key|name)\s*[:=]\s*([\s\S]+)$/i);
      if (kvMatch) {
        return { [kvMatch[1].toLowerCase()]: coerceValue(stripWrappingQuotes(kvMatch[2])) };
      }
      // Fallback: treat entire content as 'cmd' for command-like tools, or 'content' for others
      if (name.includes('execute') || name.includes('run') || name.includes('bash') || name.includes('cmd') || name.includes('shell') || name.includes('job') || name.includes('long')) {
        return { cmd: cleanScalar(trimmed) };
      }
      if (typeof trimmed === 'string' && trimmed) {
        return { content: cleanScalar(trimmed) };
      }
      return {};
    }
  }
}
