import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { normalizeStringInput, resolveWorkspacePath } from './toolUtils';

const SEARCH_SKIP = new Set(['node_modules', '.git', 'dist']);

function globMatches(fileName: string, glob?: string): boolean {
  if (!glob) return true;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(fileName);
}

async function isBinary(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, 512, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description: 'Search files recursively for a text pattern.',
  params: [
    { name: 'pattern', type: 'string', required: true, description: 'Text or regex pattern to search for.' },
    { name: 'directory', type: 'string', required: false, description: 'Directory to search. Defaults to ".".' },
    { name: 'file_glob', type: 'string', required: false, description: 'Optional file glob, e.g. "*.ts".' },
    { name: 'case_sensitive', type: 'boolean', required: false, description: 'Whether matching is case sensitive. Defaults to false.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.pattern !== 'string') throw new Error('pattern must be a string');
      const pattern = normalizeStringInput(params.pattern);
      const root = resolveWorkspacePath(typeof params.directory === 'string' ? params.directory : '.');
      const flags = params.case_sensitive === true ? 'g' : 'gi';
      const regex = new RegExp(pattern, flags);
      const matches: string[] = [];
      let omitted = 0;

      async function walk(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (SEARCH_SKIP.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
            continue;
          }
          if (!entry.isFile() || !globMatches(entry.name, typeof params.file_glob === 'string' ? params.file_glob : undefined)) continue;
          if (await isBinary(fullPath)) continue;
          const content = await fs.readFile(fullPath, 'utf8');
          const lines = content.split(/\r?\n/);
          const fileMatches: string[] = [];
          for (let index = 0; index < lines.length; index++) {
            regex.lastIndex = 0;
            if (regex.test(lines[index])) {
              if (matches.length + fileMatches.length >= 50) {
                omitted++;
              } else {
                fileMatches.push(`  ${index + 1} | ${lines[index]}`);
              }
            }
          }
          if (fileMatches.length) {
            matches.push(`${path.relative(process.cwd(), fullPath)}:\n${fileMatches.join('\n')}`);
          }
        }
      }

      await walk(root);
      if (!matches.length) return { success: true, output: `No matches found for '${pattern}'` };
      if (omitted) matches.push(`[${omitted} more matches omitted]`);
      return { success: true, output: matches.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to search files' };
    }
  }
};
