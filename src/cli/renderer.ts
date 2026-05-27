import type { AgentEvent } from '../agent/loop';

interface ChalkLike {
  dim(value: string): string;
  gray(value: string): string;
  white(value: string): string;
  cyan(value: string): string;
  green(value: string): string;
  yellow(value: string): string;
  red(value: string): string;
  blue(value: string): string;
  magenta(value: string): string;
  bold(value: string): string;
}

const fallbackChalk = {} as ChalkLike;
fallbackChalk.dim = value => value;
fallbackChalk.gray = value => value;
fallbackChalk.white = value => value;
fallbackChalk.cyan = value => value;
fallbackChalk.green = value => value;
fallbackChalk.yellow = value => value;
fallbackChalk.red = value => value;
fallbackChalk.blue = value => value;
fallbackChalk.magenta = value => value;
fallbackChalk.bold = value => value;

let chalkPromise: Promise<ChalkLike> | null = null;

async function getChalk(): Promise<ChalkLike> {
  if (!chalkPromise) {
    chalkPromise = (Function('specifier', 'return import(specifier)')('chalk') as Promise<{ default: ChalkLike }>)
      .then(module => module.default)
      .catch(() => fallbackChalk);
  }
  return chalkPromise;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function truncateValue(value: string, max = 500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n${'…'.repeat(3)} [truncated]`;
}

function summarizeToolOutput(name: string, output: string, debug: boolean): string {
  if (debug) return output;
  const lines = output.split('\n').map(line => line.trimEnd());
  if (name === 'edit_file' || name === 'str_replace') return output;
  if (name === 'list_dir') return output;
  if (name === 'git_status' || name === 'git_diff' || name === 'show_diff') return lines.slice(0, 20).join('\n');
  if (name === 'read_file' || name === 'search_files' || name === 'find_files') {
    const sliced = lines.slice(0, 15);
    if (lines.length > 15) sliced.push('…');
    return sliced.join('\n');
  }
  if (name === 'ask_user') return '';
  return lines.slice(0, 8).join('\n');
}

function shouldSuppressThinkingLine(line: string): boolean {
  // Suppress lines that are primarily tool call references (visual noise since tool_call event handles this)
  const toolRefRe = /^(?:i['']ll|let me|i need to|now|i should|i will|i['']m going to)\s+(call|use|run|read|write|list|search)\s+[\w`]/i;
  if (toolRefRe.test(line.trim())) return true;
  // Suppress lines that are just tool fence markers
  if (/^```?\w+/.test(line.trim())) return true;
  // Suppress standalone 'Thought' lines — they're handled with proper formatting in stream_chunk
  if (/^Thought\s*[·:]/.test(line.trim())) return true;
  return false;
}

function formatParamValue(value: unknown): string {
  if (typeof value === 'string') return truncateValue(value.replace(/\n/g, '\\n'), 160);
  return truncateValue(JSON.stringify(value) ?? String(value), 160);
}

function formatFileTree(output: string, chalk: ChalkLike): string {
  const lines = output.split('\n').map(l => l.trimEnd()).filter(l => l);
  return lines.map(line => {
    const trimmed = line.trim();
    const indent = line.length - trimmed.length;
    const spaces = '  '.repeat(Math.floor(indent / 2));
    if (trimmed.endsWith('/')) {
      return `${spaces}${chalk.blue(trimmed)}`;
    }
    if (trimmed.startsWith('.') || trimmed.startsWith('├') || trimmed.startsWith('└') || trimmed.startsWith('│')) {
      return `${chalk.dim(trimmed)}`;
    }
    return `${spaces}${chalk.gray(trimmed)}`;
  }).join('\n');
}

function renderToolCallPrefix(name: string, params: Record<string, unknown>): string {
  const path = (params.file_path ?? params.path ?? '') as string;
  switch (name) {
    case 'read_file':
      return `Read ${path || params.path || ''}`;
    case 'write_file':
      return `Write ${path || ''}`;
    case 'edit_file':
    case 'str_replace':
      return `Edit ${path || ''}`;
    case 'delete_file':
      return `Delete ${path || ''}`;
    case 'glob':
    case 'search_files':
    case 'grep':
      return `Search "${String(params.pattern ?? params.path ?? '')}"`;
    case 'find_files':
      return `Find "${String(params.pattern ?? '')}"`;
    case 'execute_bash':
    case 'run_cmd':
      return String(params.cmd ?? params.command ?? '').slice(0, 60);
    case 'list_dir':
    case 'list_files':
      return `List ${path || '.'}`;
    case 'read_github_issue':
    case 'read_github_file':
    case 'fetch_url':
      return `Fetch ${String(params.url ?? '').slice(0, 50)}`;
    case 'git_status':
    case 'git_diff':
    case 'git_log':
      return name.replace('git_', '');
    default:
      return name;
  }
}

function renderMarkdown(text: string, chalk: ChalkLike, insideCodeBlockRef?: { value: boolean }): string {
  let result = text;

  if (insideCodeBlockRef) {
    const trimmed = result.trim();
    if (trimmed.startsWith('```')) {
      insideCodeBlockRef.value = !insideCodeBlockRef.value;
      if (insideCodeBlockRef.value) {
        // Opening fence — subtle dim separator
        return chalk.dim('  ╌╌╌');
      } else {
        // Closing fence — subtle dim separator
        return chalk.dim('  ╌╌╌');
      }
    }
    if (insideCodeBlockRef.value) {
      // Render code line in green for visual distinction
      return chalk.green(result);
    }
  }

  // Normalize list indentation: strip leading whitespace from list marker lines
  // so consecutive items align consistently regardless of model formatting
  result = result.replace(/^[ \t]+(?=[-*+]\s)/gm, '');
  result = result.replace(/^[ \t]+(?=\d+\.\s)/gm, '');

  // Headers first
  result = result.replace(/^######\s+(.+)$/gm, chalk.dim('$1'));
  result = result.replace(/^#####\s+(.+)$/gm, chalk.bold(chalk.dim('$1')));
  result = result.replace(/^####\s+(.+)$/gm, chalk.bold('$1'));
  result = result.replace(/^###\s+(.+)$/gm, chalk.bold('$1'));
  result = result.replace(/^##\s+(.+)$/gm, chalk.bold(chalk.cyan('$1')));
  result = result.replace(/^#\s+(.+)$/gm, chalk.bold(chalk.cyan('$1')));

  // Horizontal rules
  result = result.replace(/^---$/gm, chalk.dim('─'.repeat(40)));
  result = result.replace(/^\*\*\*$/gm, chalk.dim('─'.repeat(40)));

  // List bullets (handle leading whitespace)
  result = result.replace(/^(\s*)[-*+]\s+/gm, (_, indent) => indent + chalk.cyan('•') + ' ');
  result = result.replace(/^(\s*)(\d+)\.\s+/gm, (_, indent, num) => {
    return indent + chalk.cyan(num + '. ');
  });

  // Emphasis (after list processing to avoid conflicts)
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, `\x1b[1;2m$1\x1b[22;24m`);
  result = result.replace(/\*\*(.+?)\*\*/g, `\x1b[1m$1\x1b[22m`);
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `\x1b[2m$1\x1b[22m`);
  result = result.replace(/(?<!\w)_(?!_)(.+?)(?<!_)_(?!\w)/g, `\x1b[2m$1\x1b[22m`);

  // Inline code
  result = result.replace(/`(.*?)`/g, chalk.gray('$1'));

  // Highlight markdown links: [label](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `${chalk.blue(label)} (${chalk.dim(url)})`);

  return result;
}

const KNOWN_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'str_replace', 'delete_file',
  'execute_bash', 'run_cmd', 'list_dir', 'list_files', 'glob',
  'search_files', 'grep', 'find_files', 'git_status', 'git_diff',
  'git_log', 'read_github_issue', 'read_github_file', 'fetch_url', 'done'
]);

const FILENAME_RE = /^[\w\-./]+\.(html?|css|js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|vue|svelte|php|json|md|yaml|yml|xml|sql|sh|bash)$/i;

export class Renderer {
  public static activeInstance: Renderer | null = null;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private spinnerFrame = 0;
  private spinnerLabelFrame = 0;
  private hasVisibleOutput = false;
  private iterationStart = 0;
  private sessionStart = 0;
  private modelResponded = false;
  private streamBuffer = '';
  private lastFlushedIndex = 0;
  private streamStarted = false;
  private toolCallPrefix = '';
  private toolCallLabel = '';
  private toolCallParamStr = '';
  private insideToolCall = false;
  private toolCallMarker = '';
  private toolColor: any = null;
  private insideMarkdownCodeBlock = false;
  private insideThoughtBlock = false;
  private pendingFile: string | null = null;
  private spinnerCustomLabel: string | null = null;

  constructor(private debug = false) {
    Renderer.activeInstance = this;
  }

  public static stopActiveSpinner(): void {
    if (Renderer.activeInstance) {
      Renderer.activeInstance.stopSpinner();
    }
  }

  public static startActiveSpinner(): void {
    if (Renderer.activeInstance) {
      Renderer.activeInstance.startSpinner();
    }
  }

  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  private elapsed(): string {
    const ms = Date.now() - this.iterationStart;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  private wrapLine(line: string, maxWidth: number): string[] {
    if (line.length <= maxWidth) return [line];
    const words = line.split(/(\s+)/);
    const result: string[] = [];
    let current = '';
    for (const word of words) {
      if ((current + word).length > maxWidth && current.trim()) {
        result.push(current.trim());
        current = word;
      } else {
        current += word;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result;
  }

  private outputMarkdownWrapped(
    rawText: string,
    firstPrefix: string,
    followPrefix: string,
    isFirstBlock: boolean,
    chalk: ChalkLike,
    codeBlockRef: { value: boolean }
  ): boolean {
    const termWidth = process.stdout.columns || 80;
    const prefixLen = visibleLength(followPrefix);
    const availWidth = Math.max(termWidth - prefixLen, 20);
    let anyOutput = false;

    for (const rawLine of rawText.split('\n')) {
      const wrapped = this.wrapLine(rawLine, availWidth);
      for (let wi = 0; wi < wrapped.length; wi++) {
        const rendered = renderMarkdown(wrapped[wi], chalk, codeBlockRef);
        const prefix = (wi === 0 && !anyOutput && isFirstBlock) ? firstPrefix : followPrefix;
        process.stdout.write(`${prefix}${rendered}\n`);
        anyOutput = true;
      }
    }
    return anyOutput;
  }

  public startSpinner(customLabel?: string): void {
    if (this.spinnerTimer) return;
    this.spinnerFrame = 0;
    process.stdout.write('\n');
    const renderFrame = () => {
      const label = 'Working...';
      const margin = '  ';
      const waveHead = label.length - 1 - (this.spinnerFrame % (label.length + 3));
      const rendered = [...label].map((char, index) => {
        if (index === waveHead) return `\x1b[1;97m${char}\x1b[0m`;
        if (index === waveHead + 1) return `\x1b[1;37m${char}\x1b[0m`;
        if (index === waveHead + 2) return `\x1b[1;90m${char}\x1b[0m`;
        return `\x1b[1;2m${char}\x1b[0m`;
      }).join('');
      this.spinnerFrame++;
      process.stdout.write(`\r\x1b[K${margin}${rendered}`);
    };
    renderFrame();
    this.spinnerTimer = setInterval(() => {
      renderFrame();
    }, 110);
  }

  public stopSpinner(): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
    process.stdout.write('\r\x1b[K');
  }

  async renderBanner(): Promise<void> {
    const chalk = await getChalk();
    this.sessionStart = Date.now();

    const banner = [
      '███╗   ███╗███████╗██╗      █████╗        ██████╗ ██████╗ ██████╗ ███████╗██████╗ ',
      '████╗ ████║██╔════╝██║     ██╔══██╗      ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗',
      '██╔████╔██║█████╗  ██║     ███████║█████╗██║     ██║   ██║██║  ██║█████╗  ██████╔╝',
      '██║╚██╔╝██║██╔══╝  ██║     ██╔══██║╚════╝██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗',
      '██║ ╚═╝ ██║███████╗███████╗██║  ██║      ╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║',
      '╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝       ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝',
    ];

    process.stdout.write('\n');
    process.stdout.write(`${chalk.green(banner[0])}\n`);
    process.stdout.write(`${chalk.green(banner[1])}\n`);
    process.stdout.write(`${chalk.bold(chalk.yellow(banner[2]))}\n`);
    process.stdout.write(`${chalk.bold(chalk.yellow(banner[3]))}\n`);
    process.stdout.write(`${chalk.red(banner[4])}\n`);
    process.stdout.write(`${chalk.red(banner[5])}\n`);
    process.stdout.write(`${chalk.bold('━'.repeat(20))} ${chalk.bold('Mela-Coder')} ${chalk.bold('━'.repeat(20))}\n`);
    process.stdout.write(`${chalk.dim('autonomous coding agent powered by Mela AI')}\n\n`);
  }

  async promptText(): Promise<string> {
    const chalk = await getChalk();
    return `${chalk.cyan('❯')} `;
  }

  async render(event: AgentEvent): Promise<void> {
    const chalk = await getChalk();
    switch (event.type) {
      case 'action': {
        this.stopSpinner();
        this.hasVisibleOutput = true;
        this.modelResponded = true;
        const termWidth = process.stdout.columns || 80;
        const availWidth = Math.max(termWidth - 4, 20);
        const wrapped = this.wrapLine(event.content, availWidth);
        for (const w of wrapped) process.stdout.write(`  ${chalk.dim('·')} ${chalk.dim(w)}\n`);
        break;
      }
      case 'status':
        if (!this.debug) break;
        this.stopSpinner();
        process.stdout.write(`  ${chalk.cyan('i')} ${chalk.dim(event.content)}\n`);
        break;
      case 'stream_start':
        this.streamBuffer = '';
        this.lastFlushedIndex = 0;
        this.streamStarted = false;
        this.insideToolCall = false;
        this.toolCallMarker = '';
        this.insideThoughtBlock = false;
        break;
      case 'stream_chunk': {
        const text = event.content.replace(/\[done\]/gi, '').replace(/<done\s*\/>/gi, '');
        this.streamBuffer += text;
        let newlineIdx;
        while ((newlineIdx = this.streamBuffer.indexOf('\n', this.lastFlushedIndex)) !== -1) {
          const line = this.streamBuffer.slice(this.lastFlushedIndex, newlineIdx);
          const trimmedLine = line.trim();
          this.lastFlushedIndex = newlineIdx + 1;

          // Check if we are inside a tool call fence to suppress raw print
          if (this.insideToolCall) {
            if (trimmedLine === this.toolCallMarker || (this.toolCallMarker && trimmedLine.endsWith(this.toolCallMarker))) {
              this.insideToolCall = false;
            }
            continue;
          }

          // Detect new tool call fence open
          const toolMatch = trimmedLine.match(/^```?(\w+)\s*$/);
          if (toolMatch && KNOWN_TOOLS.has(toolMatch[1])) {
            this.insideToolCall = true;
            this.toolCallMarker = line.includes('```') ? '```' : '`';
            this.insideThoughtBlock = false; // Turn off thoughts on tool calls
            continue;
          }

          // Show pending file generation with spinner
          if (FILENAME_RE.test(trimmedLine)) {
            this.stopSpinner();
            this.pendingFile = trimmedLine;
            this.hasVisibleOutput = true;
            this.modelResponded = true;
            process.stdout.write(`  ${chalk.yellow('📝')} ${chalk.dim(trimmedLine)}\n`);
            this.startSpinner(chalk.dim(`generating ${trimmedLine}`));
            continue;
          }

          // Suppress model-visible thought labels. Streaming provider reasoning is private,
          // and final answers should not expose prompt/instruction traces.
          const thoughtMatch = trimmedLine.match(/^\+?\s*(?:Thought|Thinking)\s*[·:]\s*(.*)$/i);
          if (thoughtMatch) {
            this.insideThoughtBlock = true;
            continue;
          }

          if (this.insideThoughtBlock) {
            if (trimmedLine) {
              continue;
            } else {
              this.insideThoughtBlock = false;
            }
            continue;
          }

          this.stopSpinner();
          this.hasVisibleOutput = true;
          this.modelResponded = true;

          if (trimmedLine && !shouldSuppressThinkingLine(line)) {
            const ref = { value: this.insideMarkdownCodeBlock };
            const wasStarted = this.streamStarted;
            const newOutput = this.outputMarkdownWrapped(line, '  💬 ', '     ', !wasStarted, chalk, ref);
            this.insideMarkdownCodeBlock = ref.value;
            if (newOutput) this.streamStarted = true;
          } else if (!trimmedLine) {
            if (this.streamStarted) {
              process.stdout.write(`\n`);
            }
          }
        }
        break;
      }
      case 'stream_end': {
        const remaining = this.streamBuffer.slice(this.lastFlushedIndex);
        const lines = remaining.split('\n');
        let filteredLines: string[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (this.insideToolCall) {
            if (trimmed === this.toolCallMarker || (this.toolCallMarker && trimmed.endsWith(this.toolCallMarker))) {
              this.insideToolCall = false;
            }
            continue;
          }
          const toolMatch = trimmed.match(/^```?(\w+)\s*$/);
          if (toolMatch && KNOWN_TOOLS.has(toolMatch[1])) {
            this.insideToolCall = true;
            this.toolCallMarker = line.includes('```') ? '```' : '`';
            continue;
          }
          if (FILENAME_RE.test(trimmed)) {
            if (!this.pendingFile) {
              this.stopSpinner();
              this.pendingFile = trimmed;
              this.hasVisibleOutput = true;
              this.modelResponded = true;
              process.stdout.write(`  ${chalk.yellow('📝')} ${chalk.dim(trimmed)}\n`);
              this.startSpinner(chalk.dim(`generating ${trimmed}`));
            }
            continue;
          }
          filteredLines.push(line);
        }

        const visibleRemainingLines: string[] = [];
        let suppressThoughtBlock = this.insideThoughtBlock;
        for (const line of filteredLines) {
          const trimmed = line.trim();
          const thoughtMatch = trimmed.match(/^\+?\s*(?:Thought|Thinking)\s*[·:]\s*(.*)$/i);
          if (thoughtMatch || shouldSuppressThinkingLine(line)) {
            suppressThoughtBlock = true;
            continue;
          }
          if (suppressThoughtBlock) {
            if (trimmed) continue;
            suppressThoughtBlock = false;
            continue;
          }
          visibleRemainingLines.push(line);
        }
        this.insideThoughtBlock = suppressThoughtBlock;

        const filteredRemaining = visibleRemainingLines.join('\n');
        if (filteredRemaining.trim()) {
          this.stopSpinner();
          this.hasVisibleOutput = true;
          this.modelResponded = true;
          const remainingLines = filteredRemaining.split('\n');
          for (const line of remainingLines) {
            const trimmed = line.trim();
            if (trimmed) {
              const ref = { value: this.insideMarkdownCodeBlock };
              const wasStarted = this.streamStarted;
              const newOutput = this.outputMarkdownWrapped(line, '  💬 ', '     ', !wasStarted, chalk, ref);
              this.insideMarkdownCodeBlock = ref.value;
              if (newOutput) this.streamStarted = true;
            } else {
              if (this.streamStarted) {
                process.stdout.write(`\n`);
              }
            }
          }
        }
        if (this.streamStarted) {
          process.stdout.write('\n');
        }
        this.streamBuffer = '';
        this.lastFlushedIndex = 0;
        this.streamStarted = false;
        this.insideToolCall = false;
        this.toolCallMarker = '';
        break;
      }
      case 'text': {
        this.stopSpinner();
        if (!this.hasVisibleOutput) {
          this.hasVisibleOutput = true;
          this.modelResponded = true;
          const lines = event.content.split('\n');
          let filteredLines: string[] = [];
          let tempInside = false;
          let tempMarker = '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (tempInside) {
              if (trimmed === tempMarker || (tempMarker && trimmed.endsWith(tempMarker))) {
                tempInside = false;
              }
              continue;
            }
            const toolMatch = trimmed.match(/^```?(\w+)\s*$/);
            if (toolMatch && KNOWN_TOOLS.has(toolMatch[1])) {
              tempInside = true;
              tempMarker = line.includes('```') ? '```' : '`';
              continue;
            }
            if (FILENAME_RE.test(trimmed)) {
              if (!this.pendingFile) {
                this.stopSpinner();
                this.pendingFile = trimmed;
                this.hasVisibleOutput = true;
                this.modelResponded = true;
                process.stdout.write(`  ${chalk.yellow('📝')} ${chalk.dim(trimmed)}\n`);
                this.startSpinner(chalk.dim(`generating ${trimmed}`));
              }
              continue;
            }
            filteredLines.push(line);
          }

          const cleaned = filteredLines
            .join('\n')
            .replace(/\[done\]/gi, '')
            .replace(/<done\s*\/>/gi, '')
            .trim();
          if (cleaned) {
            const cleanedLines = cleaned.split('\n');
            let firstOutput = true;
            const ref = { value: false };
            for (const line of cleanedLines) {
              const trimmed = line.trim();
              if (trimmed) {
                const wasStarted = !firstOutput;
                const newOutput = this.outputMarkdownWrapped(line, '  💬 ', '     ', !wasStarted, chalk, ref);
                if (newOutput) firstOutput = false;
              } else {
                if (!firstOutput) process.stdout.write('\n');
              }
            }
            if (!firstOutput) process.stdout.write('\n');
          }
        }
        break;
      }
      case 'tool_call': {
        this.stopSpinner();
        this.hasVisibleOutput = true;
        this.modelResponded = true;
        this.pendingFile = null;

        const pathStr = (event.params.path ?? event.params.file_path ?? event.params.target_file ?? '') as string;
        const cmdStr = (event.params.cmd ?? event.params.command ?? '') as string;

        // Map tool names to emoji icons, action labels, and high-fidelity colors
        const toolMap: Record<string, { icon: string; label: string; color: any }> = {
          read_file: { icon: '📄', label: 'read', color: chalk.blue },
          write_file: { icon: '📝', label: 'write', color: chalk.yellow },
          edit_file: { icon: '✏️', label: 'edit', color: chalk.yellow },
          str_replace: { icon: '✏️', label: 'edit', color: chalk.yellow },
          delete_file: { icon: '🗑️', label: 'delete', color: chalk.red },
          execute_bash: { icon: '⚡', label: 'bash', color: chalk.cyan },
          run_cmd: { icon: '⚡', label: 'cmd', color: chalk.cyan },
          list_dir: { icon: '📂', label: 'list', color: chalk.blue },
          list_files: { icon: '📂', label: 'list', color: chalk.blue },
          glob: { icon: '🔍', label: 'search', color: chalk.blue },
          search_files: { icon: '🔍', label: 'search', color: chalk.blue },
          grep: { icon: '🔍', label: 'search', color: chalk.blue },
          find_files: { icon: '🔍', label: 'find', color: chalk.blue },
          git_status: { icon: '🔧', label: 'git status', color: chalk.magenta },
          git_diff: { icon: '🔧', label: 'git diff', color: chalk.magenta },
          git_log: { icon: '🔧', label: 'git log', color: chalk.magenta },
          read_github_issue: { icon: '🌐', label: 'fetch', color: chalk.blue },
          read_github_file: { icon: '🌐', label: 'fetch', color: chalk.blue },
          fetch_url: { icon: '🌐', label: 'fetch', color: chalk.blue },
        };

        const tool = toolMap[event.name] || { icon: '⚙️', label: event.name, color: chalk.white };
        const displayName = pathStr || cmdStr || (event.params.pattern as string) || (event.params.url as string) || '';
        const displayLabel = tool.label || '';
        const color = tool.color;

        // Print compact, clean, single line: icon + action + path/command
        const formattedLabel = `${tool.icon} ${displayLabel} ${displayName}`.trim();
        process.stdout.write(`  ${color(formattedLabel)}\n`);

        this.toolCallLabel = formattedLabel;
        this.toolColor = color;

        this.startSpinner();
        break;
      }
      case 'tool_result': {
        this.stopSpinner();
        this.hasVisibleOutput = true;
        const elapsed = this.elapsed();
        const statusSymbol = event.success ? '✓' : '✗';

        // Move cursor up 1 line and clear it to overwrite the tool_call header
        process.stdout.write('\x1b[1A\x1b[2K');
        
        // Print beautiful, minimal status badge
        const badge = statusSymbol === '✓' ? chalk.green(statusSymbol) : chalk.red(statusSymbol);
        process.stdout.write(`  ${badge} ${this.toolCallLabel} ${chalk.dim(`· ${elapsed}`)}\n`);
        
        const fileCrudOps = new Set(['read_file', 'write_file', 'edit_file', 'str_replace', 'delete_file']);
        if (!fileCrudOps.has(event.name)) {
          const output = summarizeToolOutput(event.name, event.output, this.debug);
          if (output) {
            if (event.name === 'list_dir') {
              const tree = formatFileTree(output, chalk);
              const treeLines = tree.split('\n');
              const displayTree = treeLines.length > 10 
                ? `${treeLines.slice(0, 10).join('\n')}\n${chalk.dim('...')}`
                : tree;
              
              // Indent the output cleanly by 4 spaces
              const formattedOut = displayTree.split('\n').map(line => `    ${line}`).join('\n');
              process.stdout.write(`${formattedOut}\n`);
            } else if (event.name === 'execute_bash' || event.name === 'run_cmd') {
              const cleanOutput = output
                .replace(/^STDOUT:\n?/, '')
                .replace(/^STDERR:\n?/, '')
                .replace(/^Exit code: \d+\n?/, '')
                .trim();
              if (cleanOutput) {
                const outLines = cleanOutput.split('\n');
                let displayLines = outLines;
                let truncated = false;
                if (outLines.length > 12) {
                  displayLines = outLines.slice(0, 12);
                  truncated = true;
                }
                const formattedOut = displayLines.map(line => `    ${chalk.gray(line)}`).join('\n');
                process.stdout.write(`${formattedOut}\n`);
                if (truncated) {
                  process.stdout.write(`    ${chalk.yellow(`... (${outLines.length - 12} more lines truncated)`)}\n`);
                }
              }
            } else if (event.name === 'web_search') {
              const results = output.split('\n\n');
              const termWidth = process.stdout.columns || 80;
              const availWidth = Math.max(termWidth - 8, 20);
              for (const r of results) {
                const lines = r.split('\n').filter(l => l.trim());
                if (lines.length === 0) continue;
                const title = lines[0];
                const url = lines.length > 1 ? lines[1] : '';
                const snippet = lines.length > 2 ? lines.slice(2).join('\n') : '';
                
                process.stdout.write(`    ${chalk.bold(title)}\n`);
                if (url) process.stdout.write(`      ${chalk.dim(url)}\n`);
                if (snippet) {
                  const wrapped = this.wrapLine(snippet, availWidth);
                  for (const w of wrapped) process.stdout.write(`      ${chalk.gray(w)}\n`);
                }
              }
            } else {
              const outLines = output.split('\n');
              let displayLines = outLines;
              let truncated = false;
              if (outLines.length > 10) {
                displayLines = outLines.slice(0, 10);
                truncated = true;
              }
              const termWidth = process.stdout.columns || 80;
              const availWidth = Math.max(termWidth - 4, 20);
              const formattedOut = displayLines.map(line => {
                const wrapped = this.wrapLine(line, availWidth);
                return wrapped.map(w => `    ${chalk.gray(w)}`).join('\n');
              }).join('\n');
              process.stdout.write(`${formattedOut}\n`);
              if (truncated) {
                process.stdout.write(`    ${chalk.yellow(`... (${outLines.length - 10} more lines truncated)`)}\n`);
              }
            }
          }
        }

        this.iterationStart = Date.now();
        break;
      }
      case 'done': {
        this.stopSpinner();
        this.hasVisibleOutput = false;
        this.modelResponded = false;
        process.stdout.write('\n');
        break;
      }
      case 'cache_summary':
        break;
      case 'step': {
        this.stopSpinner();
        this.modelResponded = true;
        if (event.content.includes('✓') || event.content.includes('✗')) {
          const parts = event.content.split('·').map(part => {
            const trimmed = part.trim();
            const match = trimmed.match(/^([✓✗])\s*([a-zA-Z0-9_\-\s\(\)]+?)(?:\s+(\d+(?:\.\d+)?s))?$/);
            if (match) {
              const [, symbol, name, duration] = match;
              const symColor = symbol === '✓' ? chalk.green('✓') : chalk.red('✗');
              const nameColor = symbol === '✓' ? chalk.dim(name.trim()) : chalk.red(name.trim());
              const durColor = duration ? chalk.gray(` ${duration}`) : '';
              return `${symColor} ${nameColor}${durColor}`;
            }
            if (trimmed.startsWith('✓')) {
              return `${chalk.green('✓')} ${chalk.dim(trimmed.slice(1).trim())}`;
            } else if (trimmed.startsWith('✗')) {
              return `${chalk.red('✗')} ${chalk.red(trimmed.slice(1).trim())}`;
            }
            return chalk.dim(trimmed);
          });
          process.stdout.write(`  ${parts.join(chalk.dim(' · '))}\n`);
        } else {
          process.stdout.write(`  ${chalk.dim('•')} ${chalk.dim(event.content)}\n`);
        }
        break;
      }
      case 'error': {
        this.stopSpinner();
        this.hasVisibleOutput = false;
        this.modelResponded = false;
        process.stdout.write(`  ${chalk.red('error')} ${chalk.dim(`· ${event.message}`)}\n\n`);
        break;
      }
      case 'iteration': {
        this.iterationStart = Date.now();
        this.modelResponded = false;
        this.startSpinner();
        break;
      }
      case 'todo': {
        this.stopSpinner();
        process.stdout.write(`  ${chalk.bold('Task Checklist:')}\n`);
        for (const item of event.items) {
          if (item.status === 'completed') {
            process.stdout.write(`    ${chalk.green('+')} ${chalk.dim(item.content)}\n`);
          } else if (item.status === 'in_progress') {
            process.stdout.write(`    ${chalk.cyan('>')} ${chalk.bold(chalk.white(item.content))}\n`);
          } else {
            process.stdout.write(`    ${chalk.dim('-')} ${chalk.gray(item.content)}\n`);
          }
        }
        process.stdout.write('\n');
        break;
      }
    }
  }
}
