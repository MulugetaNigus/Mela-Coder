import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../registry';
import { cap, normalizeStringInput } from './toolUtils';

interface Job {
  id: string;
  cmd: string;
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  status: 'running' | 'done' | 'failed' | 'killed';
  code: number | null;
  startedAt: string;
}

const jobs = new Map<string, Job>();
let nextJobId = 1;

function getJob(params: Record<string, unknown>): Job | null {
  return typeof params.job_id === 'string' ? jobs.get(params.job_id) ?? null : null;
}

function renderJob(job: Job): string {
  let output = `Job: ${job.id}\nCommand: ${job.cmd}\nStatus: ${job.status}\nStarted: ${job.startedAt}\nExit code: ${job.code ?? 'n/a'}\nSTDOUT:\n${job.stdout}`;
  if (job.stderr.trim()) output += `\nSTDERR:\n${job.stderr}`;
  return cap(output);
}

export const executeLongRunningTool: ToolDefinition = {
  name: 'execute_long_running',
  description: 'Run a long command in the background and return a job ID.',
  params: [
    { name: 'cmd', type: 'string', required: true, description: 'Shell command to run.' },
    { name: 'timeout_ms', type: 'number', required: false, description: 'Optional timeout. Defaults to no timeout.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.cmd !== 'string') throw new Error('cmd must be a string');
      const cmd = normalizeStringInput(params.cmd);
      const id = `job-${nextJobId++}`;
      const child = spawn(cmd, { shell: true, cwd: process.cwd() });
      const job: Job = { id, cmd, child, stdout: '', stderr: '', status: 'running', code: null, startedAt: new Date().toISOString() };
      jobs.set(id, job);
      child.stdout.on('data', chunk => {
        job.stdout += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        job.stderr += chunk.toString();
      });
      child.on('close', code => {
        job.code = code;
        job.status = code === 0 ? 'done' : job.status === 'killed' ? 'killed' : 'failed';
      });
      if (typeof params.timeout_ms === 'number') {
        setTimeout(() => {
          if (job.status === 'running') {
            job.status = 'killed';
            child.kill('SIGTERM');
          }
        }, params.timeout_ms);
      }
      return { success: true, output: `Started ${id}: ${cmd}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to start background job' };
    }
  }
};

export const checkJobTool: ToolDefinition = {
  name: 'check_job',
  description: 'Poll a background job status and output.',
  params: [{ name: 'job_id', type: 'string', required: true, description: 'Job ID returned by execute_long_running.' }],
  async execute(params): Promise<ToolResult> {
    const job = getJob(params);
    if (!job) return { success: false, output: '', error: `Unknown job_id: ${String(params.job_id)}` };
    return { success: job.status === 'running' || job.status === 'done', output: renderJob(job), error: job.status === 'failed' ? `Job failed with code ${job.code}` : undefined };
  }
};

export const killJobTool: ToolDefinition = {
  name: 'kill_job',
  description: 'Terminate a running background job.',
  params: [{ name: 'job_id', type: 'string', required: true, description: 'Job ID to terminate.' }],
  async execute(params): Promise<ToolResult> {
    const job = getJob(params);
    if (!job) return { success: false, output: '', error: `Unknown job_id: ${String(params.job_id)}` };
    if (job.status !== 'running') return { success: true, output: `Job ${job.id} is already ${job.status}` };
    job.status = 'killed';
    job.child.kill('SIGTERM');
    setTimeout(() => {
      if (job.child.exitCode === null) job.child.kill('SIGKILL');
    }, 3000);
    return { success: true, output: `Terminated ${job.id}` };
  }
};

export const readOutputTool: ToolDefinition = {
  name: 'read_output',
  description: 'Read latest stdout and stderr from a background job.',
  params: [
    { name: 'job_id', type: 'string', required: true, description: 'Job ID to read.' },
    { name: 'max_chars', type: 'number', required: false, description: 'Maximum trailing characters. Defaults to 4000.' }
  ],
  async execute(params): Promise<ToolResult> {
    const job = getJob(params);
    if (!job) return { success: false, output: '', error: `Unknown job_id: ${String(params.job_id)}` };
    const max = typeof params.max_chars === 'number' ? params.max_chars : 4000;
    const combined = `STDOUT:\n${job.stdout}\nSTDERR:\n${job.stderr}`;
    return { success: true, output: combined.slice(-max) };
  }
};
