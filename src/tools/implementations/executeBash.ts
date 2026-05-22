import { spawn } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../registry';

function capOutput(output: string): string {
  if (output.length <= 4000) return output;
  return `${output.slice(0, 4000)}\n[Output truncated - ${output.length} chars total]`;
}

export const executeBashTool: ToolDefinition = {
  name: 'execute_bash',
  description: 'Execute a shell command in the working directory.',
  params: [
    { name: 'cmd', type: 'string', required: true, description: 'Shell command to execute.' },
    { name: 'timeout_ms', type: 'number', required: false, description: 'Timeout in milliseconds. Defaults to 30000.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.cmd !== 'string') throw new Error('cmd must be a string');
      const cmd = params.cmd;

      const timeoutMs = typeof params.timeout_ms === 'number' ? params.timeout_ms : 30000;
      return await new Promise<ToolResult>(resolve => {
        const child = spawn(cmd, { shell: true, cwd: process.cwd() });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs);

        child.stdout?.on('data', chunk => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', chunk => {
          stderr += chunk.toString();
        });
        child.on('error', err => {
          clearTimeout(timer);
          resolve({ success: false, output: capOutput(`STDOUT:\n${stdout}\nSTDERR:\n${stderr}`), error: err.message });
        });
        child.on('close', code => {
          clearTimeout(timer);
          let output = `STDOUT:\n${stdout}`;
          if (stderr.trim()) output += `\nSTDERR:\n${stderr}`;
          output += `\nExit code: ${code}`;
          output = capOutput(output);
          if (timedOut) {
            resolve({ success: false, output, error: `Command timed out after ${timeoutMs}ms` });
          } else if (code === 0) {
            resolve({ success: true, output });
          } else {
            resolve({ success: false, output, error: `Command exited with code ${code}` });
          }
        });
      });
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to execute command' };
    }
  }
};
