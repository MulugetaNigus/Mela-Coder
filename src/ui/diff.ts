import readline from 'node:readline';
import { Renderer } from '../cli/renderer';

type DiffDecision = 'apply' | 'skip' | 'abort';

let autoApply = false;

export function setAutoApply(value: boolean): void {
  autoApply = value;
}

/**
 * Computes a basic line-by-line diff between old and new strings.
 * High-performance, lightweight, and dependency-free.
 */
function getLineDiff(oldStr: string, newStr: string): Array<{ type: 'add' | 'remove' | 'same'; text: string }> {
  const oldLines = oldStr.split(/\r?\n/);
  const newLines = newStr.split(/\r?\n/);
  const diff: Array<{ type: 'add' | 'remove' | 'same'; text: string }> = [];

  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diff.push({ type: 'same', text: oldLines[i] });
      i++;
      j++;
    } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
      diff.push({ type: 'add', text: newLines[j] });
      j++;
    } else {
      diff.push({ type: 'remove', text: oldLines[i] });
      i++;
    }
  }
  return diff;
}

function visibleWidth(): number {
  return Math.min(process.stdout.columns || 80, 120);
}

function truncateLine(line: string, maxWidth: number): string {
  if (line.length <= maxWidth) return line;
  return `${line.slice(0, Math.max(maxWidth - 1, 0))}…`;
}

function colorBand(kind: 'add' | 'remove' | 'same', text: string): string {
  if (kind === 'add') return `\x1b[48;5;22m\x1b[38;5;121m${text}\x1b[0m`;
  if (kind === 'remove') return `\x1b[48;5;52m\x1b[38;5;203m${text}\x1b[0m`;
  return `\x1b[2m${text}\x1b[0m`;
}

function renderChangePreview(oldContent: string, newContent: string, filePath: string): boolean {
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

  const diffs = getLineDiff(oldContent, newContent);
  const changed = diffs.some(d => d.type !== 'same');
  if (!changed) {
    process.stdout.write(`  ${dim('No changes detected in')} ${cyan(filePath)}\n`);
    return false;
  }

  const added = diffs.filter(d => d.type === 'add').length;
  const removed = diffs.filter(d => d.type === 'remove').length;
  const action = oldContent ? 'Edited' : 'Created';
  process.stdout.write(`\n  ${green('•')} ${green(action)} ${cyan(filePath)} ${dim(`(+${added} -${removed})`)}\n`);

  const width = visibleWidth();
  const lineNoWidth = String(Math.max(oldContent.split(/\r?\n/).length, newContent.split(/\r?\n/).length)).length;
  const textWidth = Math.max(width - lineNoWidth - 9, 24);
  let oldLine = 1;
  let newLine = 1;
  let sameCount = 0;

  for (const part of diffs) {
    if (part.type === 'same') {
      sameCount++;
      if (sameCount > 2) {
        if (sameCount === 3) process.stdout.write(`  ${dim(' '.repeat(lineNoWidth + 4) + '...')}\n`);
        oldLine++;
        newLine++;
        continue;
      }
    } else {
      sameCount = 0;
    }

    const lineNo = part.type === 'add' ? newLine : oldLine;
    const sign = part.type === 'add' ? '+' : part.type === 'remove' ? '-' : ' ';
    const number = String(lineNo).padStart(lineNoWidth, ' ');
    const prefix = `${number} ${sign} `;
    const body = truncateLine(part.text, textWidth).padEnd(textWidth, ' ');

    process.stdout.write(`  ${colorBand(part.type, `${prefix}${body}`)}\n`);

    if (part.type !== 'add') oldLine++;
    if (part.type !== 'remove') newLine++;
  }
  return true;
}

export async function promptDiff(
  oldContent: string,
  newContent: string,
  filePath: string
): Promise<DiffDecision> {
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  Renderer.stopActiveSpinner();
  const changed = renderChangePreview(oldContent, newContent, filePath);
  if (!changed || autoApply) return 'apply';

  const options = ['Apply', 'Skip', 'Abort task'];
  let selectedIndex = 0;

  const renderOptions = () => {
    const rendered = options.map((opt, idx) => {
      if (idx === selectedIndex) {
        return `\x1b[7m\x1b[1m\x1b[33m[ ${opt} ]\x1b[0m`;
      } else {
        return `\x1b[2m  ${opt}  \x1b[0m`;
      }
    }).join('   ');
    process.stdout.write(`\r\x1b[K  ${rendered}`);
  };

  renderOptions();

  return new Promise<DiffDecision>(resolve => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const handleKey = (chunk: Buffer) => {
      const key = chunk.toString();

      if (key === '\u0003') {
        process.stdin.setRawMode(wasRaw);
        process.stdin.removeListener('data', handleKey);
        process.stdout.write('\n');
        process.exit(130);
      }

      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(wasRaw);
        process.stdin.removeListener('data', handleKey);
        process.stdout.write('\n\n');
        Renderer.startActiveSpinner();
        const choice = options[selectedIndex];
        if (choice === 'Skip') resolve('skip');
        if (choice === 'Abort task') resolve('abort');
        resolve('apply');
        return;
      }

      if (key === '\u001b[C' || key === '\t') {
        selectedIndex = (selectedIndex + 1) % options.length;
        renderOptions();
      } else if (key === '\u001b[D') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        renderOptions();
      }

      const lowerKey = key.toLowerCase();
      if (lowerKey === 'a') {
        selectedIndex = 0;
        renderOptions();
      } else if (lowerKey === 's') {
        selectedIndex = 1;
        renderOptions();
      } else if (lowerKey === 'q') {
        selectedIndex = 2;
        renderOptions();
      }
    };

    process.stdin.on('data', handleKey);
  });
}
