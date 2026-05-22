import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MelaClient } from '../api/melaClient';
import { createDefaultRegistry } from '../tools/defaultRegistry';
import { executeTool, formatToolResult } from '../tools/executor';
import { parseMelaResponse } from '../tools/parser';
import type { ToolRegistry } from '../tools/registry';
import { ContextManager } from './contextManager';
import { buildSystemPrompt } from './systemPrompt';

function filterToolFence(
  chunk: string,
  toolNames: Set<string>,
  insideFence: { value: boolean }
): string {
  let result = '';
  let remaining = chunk;

  while (remaining.length > 0) {
    if (insideFence.value) {
      const closeIdx = remaining.indexOf('```');
      if (closeIdx < 0) return result;
      insideFence.value = false;
      remaining = remaining.slice(closeIdx + 3);
      continue;
    }

    const openRe = /```(\w+)/;
    const match = remaining.match(openRe);
    if (!match || !toolNames.has(match[1])) {
      result += remaining;
      break;
    }

    result += remaining.slice(0, match.index);
    const afterOpen = remaining.slice(match.index! + match[0].length);
    const closeIdx = afterOpen.indexOf('```');

    if (closeIdx >= 0) {
      remaining = afterOpen.slice(closeIdx + 3);
      continue;
    }

    insideFence.value = true;
    break;
  }

  return result;
}

export interface AgentConfig {
  melaToken: string;
  maxIterations?: number;
  debug?: boolean;
  reasoning?: boolean;
  search?: boolean;
}

export interface AgentSession {
  run(task: string): AsyncGenerator<AgentEvent>;
  stop(): void;
  reset(): void;
  getHistoryStats(): { turns: number; estimatedTokens: number };
  setDebug(debug: boolean): void;
}

export type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'action'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; name: string; success: boolean; output: string }
  | { type: 'status'; content: string }
  | { type: 'stream_chunk'; content: string }
  | { type: 'stream_start' }
  | { type: 'stream_end' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'iteration'; count: number; max: number }
  | { type: 'todo'; items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> };

function shouldForceWorkspaceExploration(task: string): boolean {
  return /\b(explain|describe|summarize|overview|walk\s*through)\b/i.test(task) && /\b(project|repo|repository|codebase|workspace|structure)\b/i.test(task);
}

function isListWorkspaceRequest(task: string): boolean {
  return /\b(list|show)\b/i.test(task) && /\b(files?|folders?|directories|tree|workspace|project)\b/i.test(task);
}

function getWorkspaceNudge(task: string): string | null {
  if (shouldForceWorkspaceExploration(task)) {
    return [
      'This is a workspace/codebase explanation request.',
      'Use list_dir first to inspect the project structure.',
      'Then read only the most relevant manifest or entry files if needed, such as package.json, README.md, pyproject.toml, Cargo.toml, go.mod, pom.xml, tsconfig.json, or src/index.*.',
      'Do not ask the user for project details that are discoverable from files.',
      /\bone paragraph\b/i.test(task) ? 'The final answer must be one concise English paragraph.' : 'The final answer must be concise and in English.'
    ].join(' ');
  }
  return null;
}

async function logDebug(enabled: boolean, message: string): Promise<void> {
  if (!enabled) return;
  try {
    const dir = path.join(os.homedir(), '.addis-code');
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(path.join(dir, 'debug.log'), `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // Debug logging must never crash the agent.
  }
}

export function createAgent(config: AgentConfig): AgentSession {
  const registry: ToolRegistry = createDefaultRegistry();
  const systemPrompt = buildSystemPrompt(registry);
  const context = new ContextManager(systemPrompt);
  const client = new MelaClient(config.melaToken);
  let stopped = false;
  let debug = config.debug ?? false;

  async function* run(task: string): AsyncGenerator<AgentEvent> {
    let iterations = 0;
    const MAX = config.maxIterations ?? 50;
    let hasProducedOutput = false;
    let afterToolExecution = false;
    stopped = false;
    let lastRawResponse = '';
    let consecutiveIdenticalResponses = 0;
    context.addTurn({ role: 'user', content: task });
    if (isListWorkspaceRequest(task)) {
      context.addTurn({
        role: 'user',
        content: 'This is a direct listing request. Use list_dir once, then stop. Do not call ask_user. Do not ask follow-up questions.'
      });
    }
    const workspaceNudge = getWorkspaceNudge(task);
    if (workspaceNudge) {
      context.addTurn({ role: 'user', content: workspaceNudge });
    }

    while (iterations < MAX && !stopped) {
      iterations++;
      yield { type: 'iteration', count: iterations, max: MAX };

      try {
        await context.ensureWithinBudget(client);

        const history = context.getHistoryForRequest();
        const prompt = history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n\n');

        yield { type: 'stream_start' };
        let raw = '';
        const toolNames = new Set(registry.all().map(t => t.name));
        const fenceState = { value: false };
        let thinkingBuf = '';
        try {
          for await (const chunk of client.generateStream(prompt, {
            reasoning: config.reasoning ?? false,
            search: config.search ?? false,
          })) {
            if (chunk.reasoning) {
              thinkingBuf += chunk.reasoning;
            }
            if (chunk.text) {
              if (thinkingBuf) {
                yield { type: 'thinking', content: thinkingBuf };
                thinkingBuf = '';
              }
              raw += chunk.text;
              const displayText = filterToolFence(chunk.text, toolNames, fenceState);
              if (displayText) {
                yield { type: 'stream_chunk', content: displayText };
              }
            }
            if (chunk.status) {
              if (thinkingBuf) {
                yield { type: 'thinking', content: thinkingBuf };
                thinkingBuf = '';
              }
              yield { type: 'status', content: chunk.status };
            }
            if (chunk.done) break;
          }
        } catch (streamErr: any) {
          if (thinkingBuf) yield { type: 'thinking', content: thinkingBuf };
          yield { type: 'stream_end' };
          if (!raw) {
            throw streamErr;
          }
          await logDebug(debug, `Stream error after ${raw.length} chars: ${streamErr.message}`);
        }
        if (thinkingBuf) yield { type: 'thinking', content: thinkingBuf };
        yield { type: 'stream_end' };

        if (!raw || raw.trim().length === 0) {
          yield { type: 'error', message: 'Model produced empty response' };
          continue;
        }

        await logDebug(debug, `MODEL_RAW:\n${raw}`);

        // Loop detection
        if (raw.trim() === lastRawResponse.trim() && raw.trim().length > 0) {
          consecutiveIdenticalResponses++;
          if (consecutiveIdenticalResponses >= 2) {
            yield { type: 'error', message: 'Model is stuck in a loop. Please try a different prompt.' };
            return;
          }
        } else {
          consecutiveIdenticalResponses = 0;
        }
        lastRawResponse = raw;

        const parsed = parseMelaResponse(raw);

        if (parsed.isError) {
          context.addTurn({ role: 'assistant', content: raw });
          yield { type: 'error', message: parsed.isError };
          return;
        }

          if (parsed.text && !parsed.toolCall) {
            context.addTurn({ role: 'assistant', content: raw });
          hasProducedOutput = true;

            if (parsed.isDone) {
              const displayText = parsed.text.replace(/\[done\]/gi, '').replace(/<done\s*\/>/gi, '').trim();
              yield { type: 'text', content: displayText || parsed.text };
              yield { type: 'done' };
              return;
            }

            // After a tool execution, text without [done] means the model
            // should keep going. Let the model correct itself.
            if (afterToolExecution) {
              yield { type: 'text', content: parsed.text };
              afterToolExecution = false;
              continue;
            }

            yield { type: 'text', content: parsed.text };
            yield { type: 'done' };
            return;
          }

        if (parsed.isDone) {
          context.addTurn({ role: 'assistant', content: raw });
          yield { type: 'done' };
          return;
        }

        if (parsed.toolCall) {
          yield { type: 'tool_call', name: parsed.toolCall.name, params: parsed.toolCall.params };
          context.addTurn({ role: 'assistant', content: raw });
          if (parsed.toolCall.name === 'done') {
            const summary = parsed.toolCall.params.summary;
            if (typeof summary === 'string' && summary.trim()) {
              yield { type: 'text', content: summary };
            }
            yield { type: 'done' };
            return;
          }
          const result = await executeTool(parsed.toolCall, registry);
          await logDebug(debug, `TOOL_RESULT ${parsed.toolCall.name} success=${result.success}:\n${result.output}\n${result.error ?? ''}`);
          yield { type: 'tool_result', name: parsed.toolCall.name, success: result.success, output: result.output || result.error || '' };
          hasProducedOutput = true;
          afterToolExecution = true;

          context.addTurn({ role: 'user', content: formatToolResult(parsed.toolCall.name, result) });
          continue;
        }

        context.addTurn({ role: 'user', content: 'Your response was empty or unparseable. Write a short visible response, call a tool, or indicate done.' });
        await logDebug(debug, `EMPTY_RESPONSE:\n${raw}`);
      } catch (err: any) {
        await logDebug(debug, `ERROR:\n${err?.stack ?? err?.message ?? String(err)}`);
        yield { type: 'error', message: err?.message ?? 'Agent loop failed' };
        return;
      }
    }

    if (stopped) {
      yield { type: 'error', message: 'Agent stopped by user.' };
      return;
    }
    yield { type: 'error', message: `Max iterations (${MAX}) reached without completing task.` };
  }

  return {
    run,
    stop(): void { stopped = true; },
    reset(): void { context.reset(); },
    getHistoryStats(): { turns: number; estimatedTokens: number } {
      return context.getHistoryStats();
    },
    setDebug(value: boolean): void { debug = value; }
  };
}
