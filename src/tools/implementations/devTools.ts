import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { pathExists, readJson, resolveWorkspacePath, runCommand } from './toolUtils';

async function packageScript(names: string[]): Promise<string | null> {
  const pkg = await readJson(path.join(process.cwd(), 'package.json'));
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? (pkg.scripts as Record<string, unknown>) : {};
  for (const name of names) {
    if (typeof scripts[name] === 'string') return `npm run ${name}`;
  }
  return null;
}

async function detectTestCommand(): Promise<string | null> {
  const script = await packageScript(['test', 'tests']);
  if (script) return script;
  if ((await pathExists('pyproject.toml')) || (await pathExists('pytest.ini'))) return 'pytest';
  if (await pathExists('go.mod')) return 'go test ./...';
  if (await pathExists('Cargo.toml')) return 'cargo test';
  return null;
}

async function detectLintCommand(): Promise<string | null> {
  const script = await packageScript(['lint']);
  if (script) return script;
  if (await pathExists('pyproject.toml')) return 'ruff check .';
  if (await pathExists('go.mod')) return 'go vet ./...';
  return null;
}

async function detectTypeCommand(): Promise<string | null> {
  const script = await packageScript(['typecheck', 'type-check', 'check']);
  if (script) return script;
  if (await pathExists('tsconfig.json')) return 'npx tsc --noEmit';
  if (await pathExists('pyproject.toml')) return 'pyright';
  if (await pathExists('Cargo.toml')) return 'cargo check';
  return null;
}

async function detectFormatCommand(target: string): Promise<string | null> {
  if (await pathExists('package.json')) return `npx prettier --write ${JSON.stringify(target)}`;
  if (await pathExists('pyproject.toml')) return `black ${JSON.stringify(target)}`;
  if (await pathExists('go.mod')) return `gofmt -w ${JSON.stringify(target)}`;
  if (await pathExists('Cargo.toml')) return `cargo fmt`;
  return null;
}

export const runTestsTool: ToolDefinition = {
  name: 'run_tests',
  description: 'Run the project test suite using detected commands.',
  params: [{ name: 'cmd', type: 'string', required: false, description: 'Override test command.' }],
  async execute(params): Promise<ToolResult> {
    const cmd = typeof params.cmd === 'string' ? params.cmd : await detectTestCommand();
    if (!cmd) return { success: false, output: '', error: 'Could not detect a test command' };
    const result = await runCommand(cmd, 180000);
    return { success: result.success, output: result.output, error: result.error };
  }
};

export const runLinterTool: ToolDefinition = {
  name: 'run_linter',
  description: 'Run the project linter using detected commands.',
  params: [{ name: 'cmd', type: 'string', required: false, description: 'Override lint command.' }],
  async execute(params): Promise<ToolResult> {
    const cmd = typeof params.cmd === 'string' ? params.cmd : await detectLintCommand();
    if (!cmd) return { success: false, output: '', error: 'Could not detect a lint command' };
    const result = await runCommand(cmd, 120000);
    return { success: result.success, output: result.output, error: result.error };
  }
};

export const typeCheckTool: ToolDefinition = {
  name: 'type_check',
  description: 'Run the project type checker using detected commands.',
  params: [{ name: 'cmd', type: 'string', required: false, description: 'Override type-check command.' }],
  async execute(params): Promise<ToolResult> {
    const cmd = typeof params.cmd === 'string' ? params.cmd : await detectTypeCommand();
    if (!cmd) return { success: false, output: '', error: 'Could not detect a type-check command' };
    const result = await runCommand(cmd, 120000);
    return { success: result.success, output: result.output, error: result.error };
  }
};

export const formatCodeTool: ToolDefinition = {
  name: 'format_code',
  description: 'Format a file or directory using the detected project formatter.',
  params: [{ name: 'path', type: 'string', required: true, description: 'File or directory to format.' }],
  async execute(params): Promise<ToolResult> {
    const target = typeof params.path === 'string' ? params.path : '.';
    const cmd = await detectFormatCommand(target);
    if (!cmd) return { success: false, output: '', error: 'Could not detect a formatter' };
    const result = await runCommand(cmd, 120000);
    return { success: result.success, output: result.output, error: result.error };
  }
};

export const getDiagnosticsTool: ToolDefinition = {
  name: 'get_diagnostics',
  description: 'Get diagnostics for a file using available project checkers.',
  params: [{ name: 'path', type: 'string', required: true, description: 'File to diagnose.' }],
  async execute(params): Promise<ToolResult> {
    try {
      const file = resolveWorkspacePath(params.path);
      const ext = path.extname(file);
      if (ext === '.ts' || ext === '.tsx') {
        const result = await runCommand('npx tsc --noEmit', 120000);
        return { success: result.success, output: result.output, error: result.error };
      }
      const stat = await fs.stat(file);
      return { success: true, output: `No LSP diagnostics configured. File exists (${stat.size} bytes). Use type_check/run_linter for project-level diagnostics.` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to get diagnostics' };
    }
  }
};

export const applyRefactorTool: ToolDefinition = {
  name: 'apply_refactor',
  description: 'Apply a refactor operation if supported by local tooling.',
  params: [
    { name: 'operation', type: 'string', required: true, description: 'Refactor operation, e.g. rename_symbol.' },
    { name: 'path', type: 'string', required: true, description: 'Target file.' },
    { name: 'line', type: 'number', required: false, description: 'Target line.' },
    { name: 'new_name', type: 'string', required: false, description: 'New symbol name for rename operations.' }
  ],
  async execute(): Promise<ToolResult> {
    return {
      success: false,
      output: '',
      error: 'LSP refactors are not configured in this MVP. Use get_references plus edit_file for a safe manual refactor.'
    };
  }
};
