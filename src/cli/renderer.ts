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

function renderMarkdown(text: string, chalk: ChalkLike): string {
  let result = text;

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

  return result;
}

const LOADING_FRAMES = [
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏',
];

const LOADING_LABELS = [
  'orchestrating sub-agents',
  'analyzing workspace',
  'compiling context',
  'synthesizing edits',
  'formulating execution plan'
];

export class Renderer {
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

  constructor(private debug = false) {}

  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  private elapsed(): string {
    const ms = Date.now() - this.iterationStart;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerFrame = 0;
    this.spinnerLabelFrame = 0;
    this.spinnerTimer = setInterval(() => {
      const frame = LOADING_FRAMES[this.spinnerFrame % LOADING_FRAMES.length];
      const label = LOADING_LABELS[this.spinnerLabelFrame % LOADING_LABELS.length];
      this.spinnerFrame++;
      if (this.spinnerFrame % 30 === 0) this.spinnerLabelFrame++;
      process.stdout.write(`\r\x1b[K  ${frame} ${label}`);
    }, 60);
  }

  private stopSpinner(): void {
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
      case 'thinking': {
        this.stopSpinner();
        this.modelResponded = true;
        const content = event.content.trim();
        if (content) {
          process.stdout.write(`  ${chalk.blue('thinking')} ${chalk.dim('·')} ${chalk.gray(content)}\n`);
        }
        break;
      }
      case 'action': {
        this.stopSpinner();
        this.hasVisibleOutput = true;
        this.modelResponded = true;
        process.stdout.write(`  ${chalk.dim('·')} ${chalk.dim(event.content)}\n`);
        break;
      }
      case 'status':
        this.stopSpinner();
        process.stdout.write(`  ${chalk.cyan('i')} ${chalk.dim(event.content)}\n`);
        break;
      case 'stream_start':
        this.streamBuffer = '';
        this.lastFlushedIndex = 0;
        this.streamStarted = false;
        break;
      case 'stream_chunk': {
        const text = event.content.replace(/\[done\]/gi, '').replace(/<done\s*\/>/gi, '');
        this.streamBuffer += text;
        let newlineIdx;
        while ((newlineIdx = this.streamBuffer.indexOf('\n', this.lastFlushedIndex)) !== -1) {
          this.stopSpinner();
          this.hasVisibleOutput = true;
          this.modelResponded = true;
          const line = this.streamBuffer.slice(this.lastFlushedIndex, newlineIdx);
          if (!this.streamStarted) {
            process.stdout.write(`\n  `);
            this.streamStarted = true;
          }
          process.stdout.write(renderMarkdown(line, chalk) + '\n');
          this.lastFlushedIndex = newlineIdx + 1;
        }
        break;
      }
      case 'stream_end': {
        const remaining = this.streamBuffer.slice(this.lastFlushedIndex);
        if (remaining || !this.streamStarted) {
          this.stopSpinner();
          this.hasVisibleOutput = true;
          this.modelResponded = true;
          if (!this.streamStarted) {
            process.stdout.write(`\n  `);
            this.streamStarted = true;
          }
          process.stdout.write(renderMarkdown(remaining, chalk));
        }
        if (this.streamStarted) {
          if (remaining) process.stdout.write('\n');
          process.stdout.write('\n');
        }
        this.streamBuffer = '';
        this.lastFlushedIndex = 0;
        this.streamStarted = false;
        break;
      }
      case 'text': {
        this.stopSpinner();
        if (!this.hasVisibleOutput) {
          this.hasVisibleOutput = true;
          this.modelResponded = true;
          const cleaned = event.content
            .replace(/^```[\w]*\s*$/gm, '')
            .replace(/\[done\]/gi, '')
            .replace(/<done\s*\/>/gi, '')
            .trim();
          if (cleaned) {
            process.stdout.write(`\n  ${renderMarkdown(cleaned, chalk)}\n\n`);
          }
        }
        break;
      }
      case 'tool_call': {
        this.stopSpinner();
        this.hasVisibleOutput = true;
        this.modelResponded = true;
        
        const isCmd = event.name === 'execute_bash' || event.name === 'run_cmd';
        const isSearch = event.name === 'glob' || event.name === 'search_files' || event.name === 'grep' || event.name === 'find_files';
        const color = isCmd ? chalk.yellow : isSearch ? chalk.magenta : chalk.cyan;
        const icon = isCmd ? '>' : isSearch ? '?' : '*';
        
        process.stdout.write(`\n  ${color(icon)} ${chalk.bold(event.name)}\n`);
        
        const pathStr = (event.params.path ?? event.params.file_path ?? event.params.target_file ?? '') as string;
        if (pathStr) {
          process.stdout.write(`  ${color('|')} ${chalk.dim('path:')} ${chalk.white(pathStr)}\n`);
        }
        const cmdStr = (event.params.cmd ?? event.params.command ?? '') as string;
        if (cmdStr) {
          process.stdout.write(`  ${color('|')} ${chalk.dim('command:')} ${chalk.yellow(cmdStr.trim())}\n`);
        }
        
        const skipKeys = new Set(['content', 'old_string', 'new_string', 'oldString', 'newString', 'cmd', 'command', 'path', 'file_path']);
        for (const [key, value] of Object.entries(event.params)) {
          if (skipKeys.has(key)) continue;
          const formatted = formatParamValue(value);
          if (formatted) {
            process.stdout.write(`  ${color('|')} ${chalk.dim(key + ':')} ${formatted}\n`);
          }
        }
        
        this.toolCallPrefix = color('|');
        this.toolCallLabel = event.name;
        this.toolCallParamStr = pathStr || cmdStr ? ` (${pathStr || cmdStr})` : '';
        
        this.startSpinner();
        break;
      }
      case 'tool_result': {
        this.stopSpinner();
        this.hasVisibleOutput = true;
        const elapsed = this.elapsed();
        const color = event.success ? chalk.green : chalk.red;
        const statusSymbol = event.success ? '+' : '-';
        
        process.stdout.write(`  ${color(statusSymbol)} ${chalk.bold(this.toolCallLabel)}${chalk.dim(this.toolCallParamStr)} completed ${chalk.dim(`· ${elapsed}`)}\n`);
        
        const fileCrudOps = new Set(['read_file', 'write_file', 'edit_file', 'str_replace', 'delete_file']);
        if (!fileCrudOps.has(event.name)) {
          const output = summarizeToolOutput(event.name, event.output, this.debug);
          if (output) {
            if (event.name === 'list_dir') {
              const tree = formatFileTree(output, chalk);
              const treeLines = tree.split('\n');
              const displayTree = treeLines.length > 5 
                ? `${treeLines.slice(0, 5).join('\n')}\n${chalk.dim('...')}`
                : tree;
              
              const formattedTree = displayTree.split('\n').map(line => `  ${color('|')} ${line}`).join('\n');
              process.stdout.write(`${formattedTree}\n`);
            } else if (event.name === 'execute_bash' || event.name === 'run_cmd') {
              const cleanOutput = output
                .replace(/^STDOUT:\n?/, '')
                .replace(/^STDERR:\n?/, '')
                .replace(/^Exit code: \d+\n?/, '')
                .trim();
              if (cleanOutput) {
                const formattedOut = cleanOutput.split('\n').map(line => `  ${color('|')} ${chalk.gray(line)}`).join('\n');
                process.stdout.write(`${formattedOut}\n`);
              }
            } else if (event.name === 'web_search') {
              const results = output.split('\n\n');
              for (const r of results) {
                const lines = r.split('\n').filter(l => l.trim());
                if (lines.length === 0) continue;
                const title = lines[0];
                const url = lines.length > 1 ? lines[1] : '';
                const snippet = lines.length > 2 ? lines.slice(2).join('\n') : '';
                
                process.stdout.write(`  ${color('|')} ${chalk.bold(title)}\n`);
                if (url) process.stdout.write(`  ${color('|')}   ${chalk.dim(url)}\n`);
                if (snippet) process.stdout.write(`  ${color('|')}   ${chalk.gray(snippet)}\n`);
              }
            } else {
              const formattedOut = output.split('\n').map(line => `  ${color('|')} ${chalk.gray(line)}`).join('\n');
              process.stdout.write(`${formattedOut}\n`);
            }
          }
        }
        process.stdout.write('\n');
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
          process.stdout.write(`  ${parts.join(chalk.dim(' · '))} \n`);
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
