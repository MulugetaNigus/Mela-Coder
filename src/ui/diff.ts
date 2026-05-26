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

export async function promptDiff(
  oldContent: string,
  newContent: string,
  filePath: string
): Promise<DiffDecision> {
  if (autoApply) return 'apply';
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

  // New files: auto-approve without interactive prompt
  if (!oldContent) {
    process.stdout.write(`  ${dim('Creating new file:')} ${cyan(filePath)}\n`);
    return 'apply';
  }

  Renderer.stopActiveSpinner();

  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

  const diffs = getLineDiff(oldContent, newContent);
  const changed = diffs.some(d => d.type !== 'same');

  if (!changed) {
    process.stdout.write(`  ${dim('No changes detected in')} ${cyan(filePath)}\n`);
    return 'apply';
  }

  // Print boxed header and diff
  const border = dim('─'.repeat(Math.min(process.stdout.columns || 80, 80)));
  process.stdout.write(`\n  ${border}\n`);
  process.stdout.write(`  ${bold('Pending Changes in:')} ${cyan(filePath)}\n`);
  process.stdout.write(`  ${border}\n`);

  let sameCount = 0;
  for (const line of diffs) {
    if (line.type === 'same') {
      sameCount++;
      if (sameCount <= 2) {
        process.stdout.write(`    ${dim(' ')} ${dim(line.text)}\n`);
      } else if (sameCount === 3) {
        process.stdout.write(`    ${dim('... [context lines omitted]')}\n`);
      }
    } else {
      sameCount = 0;
      if (line.type === 'add') {
        process.stdout.write(`    ${green('+')} ${green(line.text)}\n`);
      } else {
        process.stdout.write(`    ${red('-')} ${red(line.text)}\n`);
      }
    }
  }
  process.stdout.write(`  ${border}\n`);

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
