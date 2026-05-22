import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__']);

export function resolveWorkspacePath(input: unknown, fallback = '.'): string {
  const value = typeof input === 'string' && input.trim() ? input : fallback;
  return path.resolve(process.cwd(), value);
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function cap(value: string, max = 6000): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n[Output truncated - ${value.length} chars total]`;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports: * (single segment), ** (multi-segment), ? (single char), {a,b} (alternation).
 */
export function globToRegExp(glob: string): RegExp {
  let regexStr = '';
  let i = 0;

  while (i < glob.length) {
    const ch = glob[i];

    if (ch === '*' && glob[i + 1] === '*') {
      regexStr += '.*';
      i += 2;
      if (glob[i] === '/') i++;
    } else if (ch === '*') {
      regexStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end !== -1) {
        const parts = glob.slice(i + 1, end).split(',');
        regexStr += '(' + parts.map(p => p.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
        i = end + 1;
      } else {
        regexStr += '\\{';
        i++;
      }
    } else if ('.+^${}()|\\[]'.includes(ch)) {
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  return new RegExp(`^${regexStr}$`);
}

export async function walkFiles(root: string, visitor: (filePath: string) => Promise<void>, limit = 5000): Promise<number> {
  let seen = 0;

  async function walk(dir: string): Promise<void> {
    if (seen >= limit) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (seen >= limit) return;
      if (entry.name.endsWith('.pyc')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        seen++;
        await visitor(fullPath);
      }
    }
  }

  await walk(root);
  return seen;
}

export async function runCommand(cmd: string, timeoutMs = 120000): Promise<{ success: boolean; output: string; code: number | null; error?: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, { shell: true, cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3000);
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ success: false, output: cap(`STDOUT:\n${stdout}\nSTDERR:\n${stderr}`), code: null, error: err.message });
    });
    child.on('close', code => {
      clearTimeout(timer);
      let output = `STDOUT:\n${stdout}`;
      if (stderr.trim()) output += `\nSTDERR:\n${stderr}`;
      output += `\nExit code: ${code}`;
      if (timedOut) resolve({ success: false, output: cap(output), code, error: `Command timed out after ${timeoutMs}ms` });
      else resolve({ success: code === 0, output: cap(output), code, error: code === 0 ? undefined : `Command exited with code ${code}` });
    });
  });
}

export async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function renderDiff(oldStr: string, newStr: string): string {
  const RED = '\x1b[31m';
  const GREEN = '\x1b[32m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';

  const ol = oldStr.split('\n');
  const nl = newStr.split('\n');

  // Find first differing line (common prefix)
  let start = 0;
  while (start < ol.length && start < nl.length && ol[start] === nl[start]) {
    start++;
  }

  // Find last differing line (common suffix, working backwards)
  let oe = ol.length - 1;
  let ne = nl.length - 1;
  while (oe >= start && ne >= start && ol[oe] === nl[ne]) {
    oe--;
    ne--;
  }

  // No difference
  if (start > oe && start > ne) return '';

  const ctx = 2;
  const from = Math.max(0, start - ctx);
  const afterEnd = Math.min(ol.length, oe + ctx + 1, nl.length, ne + ctx + 1);

  const parts: string[] = [];

  // Context before the change
  for (let i = from; i < start; i++) {
    parts.push(`${DIM} ${ol[i]}${RESET}`);
  }

  // Removed lines
  for (let i = start; i <= oe; i++) {
    parts.push(`${RED}-${ol[i]}${RESET}`);
  }

  // Added lines
  for (let i = start; i <= ne; i++) {
    parts.push(`${GREEN}+${nl[i]}${RESET}`);
  }

  // Context after the change
  for (let i = oe + 1; i < afterEnd; i++) {
    parts.push(`${DIM} ${ol[i]}${RESET}`);
  }

  return parts.join('\n');
}
