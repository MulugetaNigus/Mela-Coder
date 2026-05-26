import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { walkFiles } from './toolUtils';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php', '.c', '.cpp', '.h', '.hpp', '.swift', '.kt']);

interface SmellFinding {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  message: string;
  file: string;
  line?: number;
  detail?: string;
}

async function analyzeFile(filePath: string, relativePath: string): Promise<SmellFinding[]> {
  const findings: SmellFinding[] = [];
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;

  // Large file smell (> 400 lines)
  if (lineCount > 400) {
    findings.push({
      severity: 'MEDIUM',
      category: 'Large File',
      message: `File is ${lineCount} lines (threshold: 400). Consider splitting.`,
      file: relativePath,
    });
  }

  // Too few comments
  const commentLines = lines.filter(l => {
    const t = l.trim();
    return t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--');
  }).length;
  if (lineCount > 100 && commentLines / lineCount < 0.02) {
    findings.push({
      severity: 'LOW',
      category: 'Low Comment Ratio',
      message: `Comment ratio is ${(commentLines / lineCount * 100).toFixed(0)}% (recommended > 5% for complex code).`,
      file: relativePath,
    });
  }

  let depth = 0;
  let maxDepth = 0;
  let braceStack: number[] = [];
  let currentFuncStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // TODO / FIXME
    if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(trimmed) && !trimmed.startsWith('//') && !trimmed.startsWith('#')) {
      // still check even in comments — these are important
    }
    if (/\b(TODO|FIXME)\b/i.test(trimmed)) {
      findings.push({
        severity: 'LOW',
        category: 'Todo / Fixme',
        message: `${trimmed.match(/\b(TODO|FIXME)\b/i)?.[0] || 'Unresolved'} comment left in code.`,
        file: relativePath,
        line: i + 1,
        detail: trimmed.slice(0, 100),
      });
    }

    // Count nesting via indentation
    const indentLevel = line.search(/\S/);
    if (indentLevel >= 0) {
      // roughly estimate: 2 spaces per level
      const estDepth = Math.floor(indentLevel / 2);
      if (estDepth > maxDepth) maxDepth = estDepth;
    }

    // Track brace depth for JS/TS/C-style
    if (/[{]/.test(trimmed) && !trimmed.includes("'") && !trimmed.includes('"') && !trimmed.includes('`')) {
      braceStack.push(i);
    }
    if (/[}]/.test(trimmed) && braceStack.length > 0) {
      const start = braceStack.pop()!;
      const blockLines = i - start + 1;
      if (blockLines > 60) {
        findings.push({
          severity: 'HIGH',
          category: 'Long Function/Block',
          message: `Block starting at line ${start + 1} is ${blockLines} lines long.`,
          file: relativePath,
          line: start + 1,
          detail: trimmed.slice(0, 100),
        });
      }
    }

    // Function parameter count (JS/TS)
    const funcMatch = trimmed.match(/(?:function|def)\s+\w+\s*\(([^)]*)\)/);
    if (funcMatch) {
      const params = funcMatch[1].split(',').filter(p => p.trim().length > 0);
      if (params.length > 4) {
        findings.push({
          severity: 'MEDIUM',
          category: 'Too Many Parameters',
          message: `${params.length} parameters (recommended max: 4).`,
          file: relativePath,
          line: i + 1,
          detail: trimmed.slice(0, 100),
        });
      }
    }

    // Arrow function parameter count (JS/TS)
    const arrowMatch = trimmed.match(/^\s*(?:const|let|var)\s+\w+\s*=\s*\(([^)]*)\)\s*=>/);
    if (arrowMatch) {
      const params = arrowMatch[1].split(',').filter(p => p.trim().length > 0);
      if (params.length > 4) {
        findings.push({
          severity: 'MEDIUM',
          category: 'Too Many Parameters',
          message: `${params.length} parameters in arrow function (recommended max: 4).`,
          file: relativePath,
          line: i + 1,
          detail: trimmed.slice(0, 100),
        });
      }
    }

    // Magic numbers
    const magicMatches = trimmed.match(/\b\d{4,}\b/g);
    if (magicMatches && !trimmed.includes('const') && !trimmed.includes('let') && !trimmed.includes('var') && !trimmed.includes('import') && !trimmed.includes('require')) {
      for (const num of magicMatches) {
        const numVal = parseInt(num, 10);
        if (numVal !== 2026 && numVal !== 2025 && numVal !== 2024 && !trimmed.includes(`// eslint-disable`)) {
          findings.push({
            severity: 'LOW',
            category: 'Magic Number',
            message: `Hardcoded numeric literal ${num} — consider a named constant.`,
            file: relativePath,
            line: i + 1,
          });
          break; // one per line to avoid noise
        }
      }
    }

    // Empty catch block
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed) || /catch\s*\([^)]*\)\s*\{\/\*.*\*\/\}/.test(trimmed) || /catch\s*:\s*(?!.*raise|.*throw|.*log|.*print).*\n\s*(?:pass|#.*)$/.test(trimmed + (lines[i + 1] || '').trim())) {
      // The above is approximate; let me just check catch {} 
    }
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
      findings.push({
        severity: 'HIGH',
        category: 'Empty Catch Block',
        message: 'Empty catch block silently swallows errors.',
        file: relativePath,
        line: i + 1,
      });
    }

    // console.log left in non-test code
    if (/\bconsole\.\w+\s*\(/.test(trimmed) && !relativePath.includes('.test.') && !relativePath.includes('.spec.') && !relativePath.includes('__tests__')) {
      findings.push({
        severity: 'LOW',
        category: 'Console Log',
        message: 'console.* statement left in code.',
        file: relativePath,
        line: i + 1,
        detail: trimmed.slice(0, 100),
      });
    }

    // Duplicate string literals (> 20 chars)
    // Skip strings in import statements
    if (!trimmed.startsWith('import') && !trimmed.startsWith('require') && !trimmed.includes('from ')) {
      const stringMatches = trimmed.match(/(['"`])([^'"`]{20,})\1/g);
      if (stringMatches) {
        // we'll catch duplicates across the whole file in a second pass
      }
    }

    // TypeScript: any type usage
    if (/:\s*any\b/.test(trimmed)) {
      findings.push({
        severity: 'MEDIUM',
        category: 'TypeScript Any',
        message: 'Using `any` type defeats type checking.',
        file: relativePath,
        line: i + 1,
        detail: trimmed.slice(0, 100),
      });
    }

    // Deep nesting warning
    if (maxDepth > 6) {
      // add once at end
    }
  }

  if (maxDepth > 6) {
    findings.push({
      severity: 'MEDIUM',
      category: 'Deep Nesting',
      message: `Maximum nesting depth is ${maxDepth} levels (recommended max: 4).`,
      file: relativePath,
    });
  }

  // Second pass: find duplicate string literals
  const stringCounts = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import') || trimmed.startsWith('require') || trimmed.includes('from ')) continue;
    const matches = trimmed.matchAll(/(['"`])([^'"`]{20,})\1/g);
    for (const m of matches) {
      const str = m[2];
      const key = `${str}`;
      if (!stringCounts.has(key)) stringCounts.set(key, []);
      stringCounts.get(key)!.push(i + 1);
    }
  }
  for (const [str, lineNums] of stringCounts) {
    if (lineNums.length >= 3) {
      findings.push({
        severity: 'LOW',
        category: 'Duplicate String Literal',
        message: `String "${str.slice(0, 50)}" appears ${lineNums.length} times. Extract to a constant.`,
        file: relativePath,
        line: lineNums[0],
      });
      break; // one per file to avoid noise
    }
  }

  return findings;
}

export const detectCodeSmellsTool: ToolDefinition = {
  name: 'detect_code_smells',
  description: 'Scan project for code quality issues: long files, deep nesting, too many params, magic numbers, empty catches, console.log, any types, duplicate strings, todo/fixme comments.',
  params: [
    { name: 'directory', type: 'string', required: false, description: 'Directory to scan. Defaults to ".".' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const root = typeof params.directory === 'string' ? path.resolve(process.cwd(), params.directory) : process.cwd();
      const allFindings: SmellFinding[] = [];

      await walkFiles(root, async filePath => {
        const ext = path.extname(filePath);
        if (!CODE_EXTENSIONS.has(ext)) return;
        const relativePath = path.relative(process.cwd(), filePath);
        const findings = await analyzeFile(filePath, relativePath);
        allFindings.push(...findings);
      });

      if (allFindings.length === 0) {
        return { success: true, output: 'No code smells detected.' };
      }

      allFindings.sort((a, b) => {
        const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        return (order[a.severity] ?? 99) - (order[b.severity] ?? 99);
      });

      const sevColors: Record<string, string> = {
        HIGH: '\x1b[31mHIGH\x1b[0m',
        MEDIUM: '\x1b[33mMEDIUM\x1b[0m',
        LOW: '\x1b[2mLOW\x1b[0m',
      };

      const lines: string[] = [];
      for (const f of allFindings) {
        const sev = sevColors[f.severity] || f.severity;
        const loc = f.line ? `:${f.line}` : '';
        lines.push(`${sev}  ${f.file}${loc}`);
        lines.push(`     ${f.category}: ${f.message}`);
        if (f.detail) lines.push(`     ${f.detail}`);
        lines.push('');
      }

      const high = allFindings.filter(f => f.severity === 'HIGH').length;
      const med = allFindings.filter(f => f.severity === 'MEDIUM').length;
      const low = allFindings.filter(f => f.severity === 'LOW').length;
      lines.push(`Total: ${allFindings.length} smell(s): ${high} HIGH, ${med} MEDIUM, ${low} LOW.`);

      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to detect code smells' };
    }
  }
};
