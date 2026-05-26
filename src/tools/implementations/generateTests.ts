import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { resolveWorkspacePath } from './toolUtils';

interface FunctionExport {
  name: string;
  type: 'function' | 'class' | 'const' | 'generator' | 'async';
  params: string[];
  line: number;
}

function detectTestFramework(): string {
  try {
    const pkg = JSON.parse(require('node:fs').readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    if (allDeps.vitest) return 'vitest';
    if (allDeps.jest) return 'jest';
    if (allDeps.mocha) return 'mocha';
    if (allDeps.ava) return 'ava';
    if (allDeps['@playwright/test']) return 'playwright';
    return 'jest';
  } catch {
    return 'jest';
  }
}

function parseExports(content: string, filePath: string): FunctionExport[] {
  const results: FunctionExport[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // export function foo(...)
    const fnExport = trimmed.match(/^export\s+(default\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (fnExport) {
      const isAsync = !!fnExport[2];
      const params = fnExport[4].split(',').map(p => p.trim()).filter(Boolean);
      results.push({
        name: fnExport[3],
        type: isAsync ? 'async' : 'function',
        params,
        line: i + 1,
      });
      continue;
    }

    // export const foo = (...) => ...
    const constExport = trimmed.match(/^export\s+(default\s+)?(const|let|var)\s+(\w+)\s*=\s*(?:\(([^)]*)\)|(\w+))\s*(?::\s*\w+)?\s*=>/);
    if (constExport) {
      const name = constExport[3];
      const paramsStr = constExport[4] || constExport[5] || '';
      const params = paramsStr.split(',').map(p => p.trim()).filter(Boolean);
      results.push({ name, type: 'const', params, line: i + 1 });
      continue;
    }

    // export class Foo {...}
    const classExport = trimmed.match(/^export\s+(default\s+)?class\s+(\w+)/);
    if (classExport) {
      results.push({
        name: classExport[2],
        type: 'class',
        params: [],
        line: i + 1,
      });
      continue;
    }

    // export function* foo(...)
    const genExport = trimmed.match(/^export\s+(default\s+)?function\s*\*\s*(\w+)\s*\(([^)]*)\)/);
    if (genExport) {
      const params = genExport[3].split(',').map(p => p.trim()).filter(Boolean);
      results.push({ name: genExport[2], type: 'generator', params, line: i + 1 });
    }
  }

  // Filter duplicates and sort by line
  return results.filter((r, idx, self) => self.findIndex(s => s.name === r.name) === idx);
}

function generateTestContent(
  sourcePath: string,
  exports: FunctionExport[],
  framework: string,
): string {
  const ext = path.extname(sourcePath);
  const isTypeScript = ext === '.ts' || ext === '.tsx';
  const modulePath = `../${path.basename(sourcePath).replace(/\.[^.]+$/, '')}`;

  let content = '';

  if (framework === 'vitest') {
    content += isTypeScript
      ? `import { describe, it, expect } from 'vitest';\n`
      : `const { describe, it, expect } = require('vitest');\n`;
  } else if (framework === 'mocha') {
    content += `const assert = require('assert');\n`;
  } else {
    // jest
    content += '';
  }

  if (isTypeScript || framework === 'vitest' || framework === 'jest') {
    content += `import { ${exports.map(e => e.name).join(', ')} } from '${modulePath}';\n`;
  } else {
    content += `const { ${exports.map(e => e.name).join(', ')} } = require('${modulePath}');\n`;
  }

  content += '\n';

  for (const exp of exports) {
    content += `describe('${exp.name}', () => {\n`;

    if (exp.type === 'class') {
      content += `  it('should create an instance', () => {\n`;
      content += `    const instance = new ${exp.name}();\n`;
      content += `    expect(instance).toBeInstanceOf(${exp.name});\n`;
      content += `  });\n\n`;
      content += `  it('should handle default state', () => {\n`;
      content += `    // TODO: add assertions\n`;
      content += `  });\n\n`;
    } else {
      content += `  it('should ${exp.name} with valid input', () => {\n`;
      if (exp.params.length > 0) {
        content += `    // Arrange\n`;
        const args = exp.params.map(p => {
          const clean = p.replace(/:\s*\w+/g, '').replace(/=.*$/, '').trim();
          if (clean.includes(':')) return clean.split(':')[0].trim();
          return clean || 'arg';
        });
        content += `    const ${args.length === 1 ? `${args[0]} = ` : `{ ${args.join(', ')} } = `}'TODO';\n`;
      }
      content += `    const result = ${exp.name}(${exp.params.map(p => {
        const clean = p.replace(/:\s*\w+/g, '').replace(/=.*$/, '').trim();
        return clean || 'arg';
      }).join(', ')});\n`;
      content += `    expect(result).toBeDefined();\n`;
      content += `    // TODO: add specific assertions\n`;
      content += `  });\n\n`;
    }

    content += `  it('should handle edge cases', () => {\n`;
    content += `    // TODO: test empty input, null/undefined, boundary values\n`;
    content += `  });\n\n`;

    content += `  it('should handle errors gracefully', () => {\n`;
    content += `    // TODO: test error states\n`;
    content += `  });\n`;
    content += `});\n\n`;
  }

  return content;
}

export const generateTestsTool: ToolDefinition = {
  name: 'generate_tests',
  description: 'Generate unit test file content for a given source file. Detects the test framework (vitest, jest, mocha) and produces a test skeleton covering all exported functions/classes.',
  params: [
    { name: 'path', type: 'string', required: true, description: 'Source file path to generate tests for.' },
    { name: 'output', type: 'string', required: false, description: 'Output test file path. If not provided, returns content for write_file.' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.path !== 'string') throw new Error('path must be a string');
      const filePath = resolveWorkspacePath(params.path);
      const content = await fs.readFile(filePath, 'utf8');
      const exports = parseExports(content, filePath);

      if (exports.length === 0) {
        return { success: true, output: `No exports found in ${params.path}. Nothing to test.` };
      }

      const framework = detectTestFramework();
      const testContent = generateTestContent(filePath, exports, framework);

      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);
      const defaultOutput = `${baseName}.test${ext}`;

      if (typeof params.output === 'string') {
        const outPath = resolveWorkspacePath(params.output);
        await fs.writeFile(outPath, testContent, 'utf8');
        return { success: true, output: `Test file written to ${params.output}\nFramework: ${framework}\nExports covered: ${exports.map(e => e.name).join(', ')}` };
      }

      return {
        success: true,
        output: `Detected framework: ${framework}\nExports: ${exports.map(e => `${e.name} (${e.type}, line ${e.line})`).join(', ')}\n\nGenerated test content (${testContent.length} bytes):\n${testContent}\n\nWrite this to ${defaultOutput} using write_file.`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to generate tests' };
    }
  }
};
