import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { globToRegExp, humanSize, renderDiff, resolveWorkspacePath, walkFiles } from './toolUtils';

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: 'Apply a surgical old_str to new_str replacement in an existing file.',
  params: [
    { name: 'path', type: 'string', required: true, description: 'File to edit.' },
    { name: 'old_str', type: 'string', required: true, description: 'Exact text to replace.' },
    { name: 'new_str', type: 'string', required: true, description: 'Replacement text.' },
    { name: 'replace_all', type: 'boolean', required: false, description: 'Replace all matches instead of exactly one.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.old_str !== 'string' || typeof params.new_str !== 'string') throw new Error('old_str and new_str must be strings');
      const filePath = resolveWorkspacePath(params.path);
      const content = await fs.readFile(filePath, 'utf8');
      const count = content.split(params.old_str).length - 1;
      if (count === 0) return { success: false, output: '', error: 'old_str was not found in file' };
      if (count > 1 && params.replace_all !== true) return { success: false, output: '', error: `old_str matched ${count} times. Set replace_all=true or provide a more specific old_str.` };
      const updated = params.replace_all === true ? content.split(params.old_str).join(params.new_str) : content.replace(params.old_str, params.new_str);
      await fs.writeFile(`${filePath}.tmp`, updated, 'utf8');
      await fs.rename(`${filePath}.tmp`, filePath);
      return { success: true, output: `Edited ${params.path}: replaced ${params.replace_all === true ? count : 1} occurrence(s).\n${renderDiff(params.old_str, params.new_str)}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to edit file' };
    }
  }
};

export const deleteFileTool: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file or empty directory.',
  params: [{ name: 'path', type: 'string', required: true, description: 'File or empty directory to delete.' }],
  async execute(params): Promise<ToolResult> {
    try {
      const target = resolveWorkspacePath(params.path);
      const stat = await fs.stat(target);
      if (stat.isDirectory()) await fs.rmdir(target);
      else await fs.unlink(target);
      return { success: true, output: `Deleted ${params.path}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to delete path' };
    }
  }
};

export const renameFileTool: ToolDefinition = {
  name: 'rename_file',
  description: 'Move or rename a file or directory.',
  params: [
    { name: 'from', type: 'string', required: true, description: 'Current path.' },
    { name: 'to', type: 'string', required: true, description: 'Destination path.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const from = resolveWorkspacePath(params.from);
      const to = resolveWorkspacePath(params.to);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return { success: true, output: `Moved ${params.from} to ${params.to}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to rename path' };
    }
  }
};

export const makeDirTool: ToolDefinition = {
  name: 'make_dir',
  description: 'Create a directory and missing parent directories.',
  params: [{ name: 'path', type: 'string', required: true, description: 'Directory path to create.' }],
  async execute(params): Promise<ToolResult> {
    try {
      await fs.mkdir(resolveWorkspacePath(params.path), { recursive: true });
      return { success: true, output: `Created directory ${params.path}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to create directory' };
    }
  }
};

export const copyFileTool: ToolDefinition = {
  name: 'copy_file',
  description: 'Copy a file to a destination, creating parent directories as needed.',
  params: [
    { name: 'from', type: 'string', required: true, description: 'Source file path.' },
    { name: 'to', type: 'string', required: true, description: 'Destination file path.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const from = resolveWorkspacePath(params.from);
      const to = resolveWorkspacePath(params.to);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      return { success: true, output: `Copied ${params.from} to ${params.to}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to copy file' };
    }
  }
};

export const fileInfoTool: ToolDefinition = {
  name: 'file_info',
  description: 'Get metadata for a file or directory.',
  params: [{ name: 'path', type: 'string', required: true, description: 'Path to inspect.' }],
  async execute(params): Promise<ToolResult> {
    try {
      const target = resolveWorkspacePath(params.path);
      const stat = await fs.stat(target);
      let lineCount = '';
      if (stat.isFile()) {
        try {
          const content = await fs.readFile(target, 'utf8');
          lineCount = `\nLines: ${content.split(/\r?\n/).length}`;
        } catch {
          lineCount = '\nLines: unavailable (binary or unreadable)';
        }
      }
      return {
        success: true,
        output: [
          `Path: ${params.path}`,
          `Type: ${stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'}`,
          `Size: ${humanSize(stat.size)} (${stat.size} bytes)`,
          `Modified: ${stat.mtime.toISOString()}`,
          `Permissions: ${stat.mode.toString(8).slice(-3)}${lineCount}`,
          `Mime type: ${guessMime(String(params.path))}`
        ].join('\n')
      };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to inspect file' };
    }
  }
};

export const findFilesTool: ToolDefinition = {
  name: 'find_files',
  description: 'Find files by filename glob pattern across a directory tree.',
  params: [
    { name: 'pattern', type: 'string', required: true, description: 'Filename glob, e.g. "*.test.ts".' },
    { name: 'directory', type: 'string', required: false, description: 'Directory to search. Defaults to ".".' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.pattern !== 'string') throw new Error('pattern must be a string');
      const root = resolveWorkspacePath(params.directory);
      const regex = globToRegExp(params.pattern);
      const matches: string[] = [];
      await walkFiles(root, async filePath => {
        if (matches.length < 200 && regex.test(path.basename(filePath))) matches.push(path.relative(process.cwd(), filePath));
      });
      return { success: true, output: matches.length ? matches.join('\n') : `No files found for ${params.pattern}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to find files' };
    }
  }
};

function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript-jsx',
    '.js': 'text/javascript',
    '.jsx': 'text/javascript-jsx',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.py': 'text/x-python',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.html': 'text/html',
    '.css': 'text/css'
  };
  return map[ext] ?? 'application/octet-stream';
}
