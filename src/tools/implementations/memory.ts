import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { cap } from './toolUtils';

const memoryDir = path.join(os.homedir(), '.addis-code');
const memoryFile = path.join(memoryDir, 'memory.json');
let taskNotes = '';

async function readMemory(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(memoryFile, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeMemory(memory: Record<string, string>): Promise<void> {
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify(memory, null, 2), 'utf8');
}

export const rememberTool: ToolDefinition = {
  name: 'remember',
  description: 'Store a persistent key-value memory fact.',
  params: [
    { name: 'key', type: 'string', required: true, description: 'Memory key.' },
    { name: 'value', type: 'string', required: true, description: 'Memory value.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.key !== 'string' || typeof params.value !== 'string') throw new Error('key and value must be strings');
      const memory = await readMemory();
      memory[params.key] = params.value;
      await writeMemory(memory);
      return { success: true, output: `Remembered ${params.key}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to remember fact' };
    }
  }
};

export const recallTool: ToolDefinition = {
  name: 'recall',
  description: 'Retrieve a memory by key or fuzzy-search stored memories.',
  params: [{ name: 'query', type: 'string', required: true, description: 'Exact key or search topic.' }],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.query !== 'string') throw new Error('query must be a string');
      const memory = await readMemory();
      if (memory[params.query]) return { success: true, output: `${params.query}: ${memory[params.query]}` };
      const query = params.query.toLowerCase();
      const matches = Object.entries(memory).filter(([key, value]) => `${key} ${value}`.toLowerCase().includes(query));
      return { success: true, output: matches.length ? matches.map(([key, value]) => `${key}: ${value}`).join('\n') : `No memory found for ${params.query}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to recall memory' };
    }
  }
};

export const taskNotesTool: ToolDefinition = {
  name: 'task_notes',
  description: 'Read or update scratch notes for the current task.',
  params: [
    { name: 'action', type: 'string', required: true, description: 'read, write, append, or clear.' },
    { name: 'content', type: 'string', required: false, description: 'Notes content for write/append.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const action = typeof params.action === 'string' ? params.action : '';
      if (action === 'read') return { success: true, output: taskNotes || 'No task notes.' };
      if (action === 'clear') {
        taskNotes = '';
        return { success: true, output: 'Task notes cleared.' };
      }
      if ((action === 'write' || action === 'append') && typeof params.content === 'string') {
        taskNotes = action === 'write' ? params.content : `${taskNotes}${taskNotes ? '\n' : ''}${params.content}`;
        return { success: true, output: 'Task notes updated.' };
      }
      return { success: false, output: '', error: 'Invalid action. Use read, write, append, or clear.' };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to update task notes' };
    }
  }
};

export const summarizeContextTool: ToolDefinition = {
  name: 'summarize_context',
  description: 'Summarize provided context into compact bullet points.',
  params: [
    { name: 'content', type: 'string', required: true, description: 'Context to summarize.' },
    { name: 'max_chars', type: 'number', required: false, description: 'Maximum output characters. Defaults to 1200.' }
  ],
  async execute(params): Promise<ToolResult> {
    if (typeof params.content !== 'string') return { success: false, output: '', error: 'content must be a string' };
    const max = typeof params.max_chars === 'number' ? params.max_chars : 1200;
    const lines = params.content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const summary = lines.slice(0, 12).map(line => `- ${line.slice(0, 180)}`).join('\n');
    return { success: true, output: cap(summary || params.content.slice(0, max), max) };
  }
};
