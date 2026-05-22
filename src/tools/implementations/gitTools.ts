import type { ToolDefinition, ToolResult } from '../registry';
import { runCommand } from './toolUtils';

export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: 'Show current git status.',
  params: [],
  async execute(): Promise<ToolResult> {
    const result = await runCommand('git status --short --branch', 30000);
    return { success: result.success, output: result.output, error: result.error };
  }
};

export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description: 'Show git diff for a file or the whole working tree.',
  params: [{ name: 'path', type: 'string', required: false, description: 'Optional file path.' }],
  async execute(params): Promise<ToolResult> {
    const cmd = typeof params.path === 'string' ? `git diff -- ${JSON.stringify(params.path)}` : 'git diff';
    const result = await runCommand(cmd, 30000);
    return { success: result.success, output: result.output, error: result.error };
  }
};

export const gitCommitTool: ToolDefinition = {
  name: 'git_commit',
  description: 'Stage all changes and commit with a message.',
  params: [{ name: 'message', type: 'string', required: true, description: 'Commit message.' }],
  async execute(params): Promise<ToolResult> {
    if (typeof params.message !== 'string') return { success: false, output: '', error: 'message must be a string' };
    const add = await runCommand('git add -A', 30000);
    if (!add.success) return { success: false, output: add.output, error: add.error };
    const commit = await runCommand(`git commit -m ${JSON.stringify(params.message)}`, 60000);
    return { success: commit.success, output: `${add.output}\n${commit.output}`, error: commit.error };
  }
};

export const gitLogTool: ToolDefinition = {
  name: 'git_log',
  description: 'Show recent commit history.',
  params: [{ name: 'limit', type: 'number', required: false, description: 'Number of commits. Defaults to 10.' }],
  async execute(params): Promise<ToolResult> {
    const limit = typeof params.limit === 'number' ? params.limit : 10;
    const result = await runCommand(`git log --oneline --decorate -n ${limit}`, 30000);
    return { success: result.success, output: result.output, error: result.error };
  }
};

export const gitCreateBranchTool: ToolDefinition = {
  name: 'git_create_branch',
  description: 'Create and switch to a new git branch.',
  params: [{ name: 'name', type: 'string', required: true, description: 'Branch name.' }],
  async execute(params): Promise<ToolResult> {
    if (typeof params.name !== 'string') return { success: false, output: '', error: 'name must be a string' };
    const result = await runCommand(`git checkout -b ${JSON.stringify(params.name)}`, 30000);
    return { success: result.success, output: result.output, error: result.error };
  }
};
