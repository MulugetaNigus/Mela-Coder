import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { resolveWorkspacePath } from './toolUtils';

interface MigrationRule {
  name: string;
  description: string;
  aliases: string[];
  // Returns null if the rule doesn't apply
  transform: (content: string, filePath: string) => string | null;
}

const MIGRATIONS: MigrationRule[] = [
  {
    name: 'cjs-to-esm',
    description: 'Convert CommonJS (require/module.exports) to ES Modules (import/export default)',
    aliases: ['commonjs-to-esmodules', 'cjs2esm'],
    transform: (content) => {
      let result = content;

      // require() -> import
      result = result.replace(
        /(?:const|let|var)\s+\{?\s*(\w+(?:\s*,\s*\w+)*)\s*\}?\s*=\s*require\((['"`])([^'"`]+)\2\)/g,
        (_, exports, __, modPath) => {
          const items = exports.split(',').map((s: string) => s.trim());
          if (items.length === 1 && !items[0].includes(' as ')) {
            return `import ${items[0]} from '${modPath}'`;
          }
          const named = items.map((s: string) => {
            const parts = s.split(/\s+as\s+/);
            return parts.length > 1 ? `${parts[0].trim()} as ${parts[1].trim()}` : s.trim();
          }).join(', ');
          return `import { ${named} } from '${modPath}'`;
        }
      );

      // module.exports = ... -> export default ...
      result = result.replace(/module\.exports\s*=\s*(\{[\s\S]*?\}|[^;]+)/g, 'export default $1');

      // exports.foo = ... -> export const foo = ...
      result = result.replace(/exports\.(\w+)\s*=\s*/g, 'export const $1 = ');

      return result;
    },
  },
  {
    name: 'esm-to-cjs',
    description: 'Convert ES Modules (import/export) to CommonJS (require/module.exports)',
    aliases: ['esm2cjs', 'esmodules-to-commonjs'],
    transform: (content) => {
      let result = content;

      // import default from 'x' -> const default = require('x')
      result = result.replace(
        /import\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/g,
        'const $1 = require(\'$2\')'
      );

      // import { a, b } from 'x' -> const { a, b } = require('x')
      result = result.replace(
        /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"`]([^'"`]+)['"`]/g,
        'const { $1 } = require(\'$2\')'
      );

      // import * as ns from 'x' -> const ns = require('x')
      result = result.replace(
        /import\s+\*\s+as\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/g,
        'const $1 = require(\'$2\')'
      );

      // export default ... -> module.exports = ...
      result = result.replace(/export\s+default\s+/g, 'module.exports = ');

      // export const/let/var/function/class -> remove export
      result = result.replace(/export\s+(const|let|var|function|class|async\s+function)/g, '$1');

      return result;
    },
  },
  {
    name: 'var-to-const-let',
    description: 'Replace `var` with `const` (when never reassigned) or `let`',
    aliases: ['var2const', 'no-var'],
    transform: (content) => {
      const lines = content.split('\n');
      const result: string[] = [];
      const varDecls: Array<{ name: string; line: number; text: string }> = [];

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*var\s+(\w+)\s*=/);
        if (m) {
          varDecls.push({ name: m[1], line: i, text: lines[i] });
        }
        result.push(lines[i]);
      }

      let changed = 0;
      for (const decl of varDecls) {
        const name = decl.name;
        let reassigned = false;

        for (let i = decl.line + 1; i < lines.length; i++) {
          const reassignPattern = new RegExp(`(?:^|\\s)${name}\\s*=(?!=)`);
          if (reassignPattern.test(lines[i])) {
            // But check it's not `const ${name} = ...` or `let ${name} = ...`
            if (!lines[i].trim().startsWith('const') && !lines[i].trim().startsWith('let') && !lines[i].trim().startsWith('var')) {
              reassigned = true;
            }
            break;
          }
        }

        const keyword = reassigned ? 'let' : 'const';
        result[decl.line] = result[decl.line].replace(/^\s*var\b/, `$&`.replace(/var/, keyword));
        changed++;
      }

      return changed > 0 ? result.join('\n') : null;
    },
  },
  {
    name: 'async-await',
    description: 'Convert promise.then() chains to async/await',
    aliases: ['promise-to-async', 'then2await'],
    transform: (content) => {
      // Simple heuristic: detect `.then(...)` chains not in test files
      if (!content.includes('.then(')) return null;

      // Find functions that use .then()
      const lines = content.split('\n');
      let result = content;

      // Common pattern: function foo() { return bar().then(() => ...) }
      // We'll do a basic pass: wrap in async and replace .then with await
      // This is a heuristic; complex cases left to the model
      result = result.replace(
        /\.then\s*\(\s*(?:\(([^)]*)\)|(\w+))\s*=>\s*\{/g,
        (_, params1, params2) => {
          const params = params1 || params2 || '';
          return params ? `await (async (${params}) => {` : 'await (async () => {';
        }
      );
      result = result.replace(/\.then\s*\(\s*(\w+)\s*\)/g, 'await $1');

      return result !== content ? result : null;
    },
  },
  {
    name: 'js-to-ts',
    description: 'Convert .js/.jsx to .ts/.tsx by adding basic type annotations where possible',
    aliases: ['javascript-to-typescript', 'js2ts'],
    transform: (content, filePath) => {
      let result = content;

      // Add function return type annotations for exported functions
      result = result.replace(
        /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/gm,
        (match, exp, async_, name, params) => {
          const prefix = exp || '';
          const asyncPrefix = async_ || '';
          const typedParams = params.split(',').map((p: string) => {
            p = p.trim();
            if (!p) return p;
            // If param already has a type annotation, leave it
            if (p.includes(':')) return p;
            // Add : any as placeholder
            const [pName, ...rest] = p.replace(/=.*$/, '').trim().split(/\s+/);
            const defaultVal = p.includes('=') ? p.match(/=.*/)?.[0] : '';
            if (!pName) return p;
            return `${pName}: any${defaultVal || ''}`;
          }).join(', ');
          return `${prefix}${asyncPrefix}function ${name}(${typedParams}): any {`;
        }
      );

      // Add param types for arrow functions in exports
      result = result.replace(
        /^(export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:\(([^)]*)\)|(\w+))\s*(?::\s*\w+)?\s*=>\s*\{/gm,
        (match, exp, name, params1, params2) => {
          const params = (params1 || params2 || '').split(',').map((p: string) => {
            p = p.trim();
            if (!p || p.includes(':')) return p;
            return `${p}: any`;
          }).join(', ');
          return `${exp || ''}const ${name} = (${params}): any => {`;
        }
      );

      return result;
    },
  },
];

export const migrateCodeTool: ToolDefinition = {
  name: 'migrate_code',
  description: 'Migrate code from one pattern/language to another. Supports: cjs-to-esm, esm-to-cjs, var-to-const-let, async-await (promise.then → async/await), js-to-ts.',
  params: [
    { name: 'path', type: 'string', required: true, description: 'Source file path to migrate.' },
    { name: 'rule', type: 'string', required: true, description: 'Migration rule name. One of: cjs-to-esm, esm-to-cjs, var-to-const-let, async-await, js-to-ts.' },
    { name: 'output', type: 'string', required: false, description: 'Output file path. If not provided, returns content for write_file.' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.path !== 'string') throw new Error('path must be a string');
      if (typeof params.rule !== 'string') throw new Error('rule must be a string');

      const filePath = resolveWorkspacePath(params.path);
      const content = await fs.readFile(filePath, 'utf8');

      const ruleName = params.rule.toLowerCase();
      const migration = MIGRATIONS.find(
        m => m.name === ruleName || m.aliases.includes(ruleName)
      );

      if (!migration) {
        const available = MIGRATIONS.map(m => `  - ${m.name} (${m.aliases.join(', ')}): ${m.description}`).join('\n');
        return { success: false, output: '', error: `Unknown migration rule "${params.rule}".\nAvailable:\n${available}` };
      }

      const result = migration.transform(content, filePath);

      if (result === null) {
        return { success: true, output: 'No changes needed — the code already follows the target pattern.' };
      }

      if (typeof params.output === 'string') {
        const outPath = resolveWorkspacePath(params.output);
        await fs.writeFile(outPath, result, 'utf8');
        return { success: true, output: `Migrated file written to ${params.output} (${Buffer.byteLength(result, 'utf8')} bytes) using rule "${migration.name}".` };
      }

      const ext = path.extname(filePath);
      const defaultOutput = path.basename(filePath, ext) + '.migrated' + ext;
      return {
        success: true,
        output: `Migration rule: ${migration.name}\n${migration.description}\n\nResult (${result.length} bytes):\n${result}\n\nWrite this to ${defaultOutput} using write_file.`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to migrate code' };
    }
  }
};
