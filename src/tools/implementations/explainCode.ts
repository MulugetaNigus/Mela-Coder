import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { resolveWorkspacePath } from './toolUtils';

const CODE_LANG_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript React', '.js': 'JavaScript', '.jsx': 'JavaScript React',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.cs': 'C#',
  '.rb': 'Ruby', '.php': 'PHP', '.c': 'C', '.cpp': 'C++', '.h': 'C Header',
  '.hpp': 'C++ Header', '.swift': 'Swift', '.kt': 'Kotlin', '.scala': 'Scala',
  '.mjs': 'JavaScript (ESM)', '.cjs': 'JavaScript (CommonJS)',
};

function detectImports(lines: string[], lang: string): string[] {
  const importPatterns: Record<string, RegExp> = {
    'TypeScript': /^(?:import\s+|const\s+\w+\s*=\s*require\()/,
    'JavaScript': /^(?:import\s+|const\s+\w+\s*=\s*require\()/,
    'Python': /^(?:from\s+\S+\s+import|import\s+\S+)/,
    'Go': /^(?:import\s+|import\s*\()/,
    'Rust': /^(?:use\s+)/,
    'Java': /^(?:import\s+)/,
    'C#': /^(?:using\s+)/,
  };

  const pattern = importPatterns[lang];
  if (!pattern) return [];

  const imports: string[] = [];
  for (const line of lines) {
    if (pattern.test(line)) imports.push(line.trim());
  }
  return imports.slice(0, 20); // cap
}

function detectExports(lines: string[]): string[] {
  const exports: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('export ') || trimmed.startsWith('module.exports') || trimmed.startsWith('exports.')) {
      exports.push(trimmed.slice(0, 120));
    }
  }
  return exports.slice(0, 15);
}

function detectFunctions(lines: string[]): Array<{ name: string; line: number; signature: string }> {
  const funcs: Array<{ name: string; line: number; signature: string }> = [];
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:\(([^)]*)\)|\w+)\s*(?::\s*\w+)?\s*=>/,
    /(?:export\s+)?class\s+(\w+)/,
    /def\s+(\w+)\s*\(([^)]*)\)/,
    /func\s+(\w+)\s*\(([^)]*)\)/,
    /fn\s+(\w+)\s*\(([^)]*)\)/,
    /public\s+(?:static\s+)?\w+\s+(\w+)\s*\(([^)]*)\)/,
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pat of patterns) {
      const m = lines[i].trim().match(pat);
      if (m) {
        funcs.push({
          name: m[1],
          line: i + 1,
          signature: lines[i].trim().slice(0, 120),
        });
        break;
      }
    }
  }
  return funcs;
}

export const explainCodeTool: ToolDefinition = {
  name: 'explain_code',
  description: 'Analyze a code file and provide a structured explanation: language, imports, exports, functions/classes, and high-level purpose.',
  params: [
    { name: 'path', type: 'string', required: true, description: 'File path to explain.' },
    { name: 'start_line', type: 'number', required: false, description: 'Start line for a specific block. If omitted, explains the whole file.' },
    { name: 'end_line', type: 'number', required: false, description: 'End line for a specific block.' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.path !== 'string') throw new Error('path must be a string');
      const filePath = resolveWorkspacePath(params.path);
      const content = await fs.readFile(filePath, 'utf8');
      const allLines = content.split(/\r?\n/);
      const ext = path.extname(filePath);
      const lang = CODE_LANG_MAP[ext] || 'Unknown';

      let lines = allLines;
      let focusNote = '';
      const startLine = typeof params.start_line === 'number' ? params.start_line : 1;
      const endLine = typeof params.end_line === 'number' ? params.end_line : allLines.length;

      if (startLine > 1 || endLine < allLines.length) {
        lines = allLines.slice(startLine - 1, endLine);
        focusNote = ` (focused on lines ${startLine}-${endLine})`;
      }

      const fullContent = lines.join('\n');
      const lineCount = lines.length;
      const charCount = fullContent.length;
      const imports = detectImports(lines, lang);
      const exportsList = detectExports(lines);
      const funcs = detectFunctions(lines);

      const output: string[] = [];
      output.push(`\x1b[1mFile:\x1b[0m ${params.path}${focusNote}`);
      output.push(`\x1b[1mLanguage:\x1b[0m ${lang}`);
      output.push(`\x1b[1mSize:\x1b[0m ${lineCount} lines, ${charCount} characters`);
      output.push('');

      if (imports.length > 0) {
        output.push(`\x1b[1mImports (${imports.length}):\x1b[0m`);
        for (const imp of imports) output.push(`  ${imp}`);
        output.push('');
      }

      if (funcs.length > 0) {
        output.push(`\x1b[1mFunctions / Classes (${funcs.length}):\x1b[0m`);
        for (const f of funcs) {
          output.push(`  \x1b[36m${f.name}\x1b[0m (line ${f.line}): ${f.signature}`);
        }
        output.push('');
      }

      if (exportsList.length > 0) {
        output.push(`\x1b[1mExports (${exportsList.length}):\x1b[0m`);
        for (const e of exportsList) output.push(`  ${e}`);
        output.push('');
      }

      // Purpose heuristic: read first comment block or first meaningful lines
      const leading = lines.slice(0, Math.min(15, lines.length)).filter(l => {
        const t = l.trim();
        return t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('/**');
      });
      if (leading.length > 0) {
        output.push(`\x1b[1mDocumentation / Header:\x1b[0m`);
        for (const l of leading) output.push(`  ${l.trim()}`);
        output.push('');
      }

      // Show the actual code block if focused
      if (focusNote) {
        output.push(`\x1b[1mCode block (lines ${startLine}-${endLine}):\x1b[0m`);
        for (let i = 0; i < lines.length; i++) {
          output.push(`  ${startLine + i} | ${lines[i]}`);
        }
      }

      return { success: true, output: output.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to explain code' };
    }
  }
};
