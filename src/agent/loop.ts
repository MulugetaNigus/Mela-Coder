import { promises as fs } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MelaClient } from '../api/melaClient';
import { createDefaultRegistry } from '../tools/defaultRegistry';
import { executeTool, formatToolResult, setPermissionGate } from '../tools/executor';
import { parseMelaResponse } from '../tools/parser';
import type { ToolRegistry } from '../tools/registry';
import { ContextManager } from './contextManager';
import { buildSystemPrompt } from './systemPrompt';
import { SkillLoader } from '../skills/loader';
import { PermissionGate } from '../safety/permissions';
import { ProjectMemory } from '../memory/project';
import { VerificationChain } from '../verification/chain';

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

import { ConversationTurn } from './contextManager';

export interface AgentConfig {
  melaToken: string;
  maxIterations?: number;
  debug?: boolean;
  reasoning?: boolean;
  search?: boolean;
  dangerouslyAllowAll?: boolean;
  readOnly?: boolean;
  restoredHistory?: ConversationTurn[];
  skipVerify?: boolean;
}

export interface AgentSession {
  run(task: string): AsyncGenerator<AgentEvent>;
  stop(): void;
  reset(): void;
  getHistoryStats(): { turns: number; estimatedTokens: number };
  setDebug(debug: boolean): void;
  getState(): { history: ConversationTurn[] };
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
  | { type: 'todo'; items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> }
  | { type: 'step'; content: string }
  | { type: 'cache_summary'; inputTokens: number; outputTokens: number; savedTokens: number };

export interface AgentExecutionState {
  currentGoal: string;
  completedSteps: string[];
  failedSteps: string[];
  inspectedFiles: string[];
  editedFiles: string[];
  discoveredStack: string[];
  discoveredEntrypoints: string[];
  assumptions: string[];
  blockers: string[];
  repoSummary: string;
}

export interface WorkingMemory {
  inspectedFiles: string[];
  editedFiles: string[];
  pendingTasks: string[];
  discoveredIssues: string[];
  verificationResults: string[];
  repoSummary: string;
}

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

function buildMemorySummary(wm: WorkingMemory, state: AgentExecutionState): string {
  const parts: string[] = ['[WORKING MEMORY]'];

  if (wm.repoSummary) parts.push(`Repo: ${wm.repoSummary}`);
  if (wm.inspectedFiles.length > 0) parts.push(`Inspected: ${wm.inspectedFiles.slice(-5).join(', ')}`);
  if (wm.editedFiles.length > 0) parts.push(`Edited: ${wm.editedFiles.slice(-3).join(', ')}`);
  if (wm.pendingTasks.length > 0) parts.push(`Pending: ${wm.pendingTasks.slice(-3).join(', ')}`);
  if (wm.discoveredIssues.length > 0) parts.push(`Issues: ${wm.discoveredIssues.slice(-3).join(', ')}`);
  if (wm.verificationResults.length > 0) parts.push(`Results: ${wm.verificationResults.slice(-3).join('; ')}`);

  if (state.blockers.length > 0) parts.push(`Blockers: ${state.blockers.join(', ')}`);
  if (state.assumptions.length > 0) parts.push(`Assumptions: ${state.assumptions.join(', ')}`);

  return parts.join('\n') + '\n';
}

function isEditTool(name: string): boolean {
  return name === 'edit_file' || name === 'str_replace' || name === 'write_file' || name === 'delete_file';
}

function isReadTool(name: string): boolean {
  return name === 'read_file' || name === 'search_files' || name === 'find_files' || name === 'list_dir';
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

  // Auto-discover stack and initialize memory if none exists
  if (!ProjectMemory.findPath()) {
    ProjectMemory.init();
    const stack: string[] = [];
    const commands: string[] = [];
    if (existsSync('package.json')) {
      stack.push('- Language/Runtime: Node.js/JavaScript/TypeScript');
      if (existsSync('tsconfig.json')) {
        stack.push('- TypeScript: Yes');
      }
      try {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        if (pkg.dependencies) {
          const deps = Object.keys(pkg.dependencies).slice(0, 5).join(', ');
          stack.push(`- Key Dependencies: ${deps}`);
        }
        if (pkg.scripts) {
          if (pkg.scripts.build) commands.push(`- Build: npm run build`);
          if (pkg.scripts.test) commands.push(`- Test: npm test`);
          if (pkg.scripts.lint) commands.push(`- Lint: npm run lint`);
        }
      } catch {}
    } else if (existsSync('pyproject.toml') || existsSync('requirements.txt')) {
      stack.push('- Language/Runtime: Python');
    } else if (existsSync('Cargo.toml')) {
      stack.push('- Language/Runtime: Rust');
      commands.push('- Build: cargo build');
      commands.push('- Test: cargo test');
    } else if (existsSync('go.mod')) {
      stack.push('- Language/Runtime: Go');
      commands.push('- Build: go build');
      commands.push('- Test: go test');
    }
    
    if (stack.length > 0) {
      ProjectMemory.upsertSection('Tech Stack', stack.join('\n'));
    }
    if (commands.length > 0) {
      ProjectMemory.upsertSection('Commands', commands.join('\n'));
    }
  }

  const projectMemory = ProjectMemory.load();
  const skills = SkillLoader.discoverSkills();
  const systemPrompt = buildSystemPrompt(registry, projectMemory);
  const context = new ContextManager(systemPrompt);
  const client = new MelaClient(config.melaToken);
  let stopped = false;
  let debug = config.debug ?? false;

  const gate = new PermissionGate({
    allowAll: config.dangerouslyAllowAll,
    readOnly: config.readOnly,
  });
  setPermissionGate(gate);

  async function* run(task: string): AsyncGenerator<AgentEvent> {
    // Contextually match and load skills
    const matched = SkillLoader.matchSkills(task, skills);
    if (matched.length > 0) {
      const updatedSystemPrompt = buildSystemPrompt(registry, projectMemory, matched.map(s => s.content));
      context.updateSystemPrompt(updatedSystemPrompt);
      for (const s of matched) {
        yield { type: 'step', content: `✓ skill:${s.name} loaded` };
      }
    }

    async function* yieldCacheSummary(): AsyncGenerator<AgentEvent> {
      const stats = context.getCacheStats();
      yield {
        type: 'cache_summary',
        inputTokens: stats.cumulativeInputTokens,
        outputTokens: stats.cumulativeOutputTokens,
        savedTokens: stats.estimatedSavings
      };
    }

    async function* handleDone(): AsyncGenerator<AgentEvent> {
      yield { type: 'done' };
      yield* yieldCacheSummary();
    }

    let iterations = 0;
    const MAX = config.maxIterations ?? 50;
    let hasProducedOutput = false;
    let afterToolExecution = false;
    stopped = false;
    let lastRawResponse = '';
    let consecutiveIdenticalResponses = 0;

    const workingMemory: WorkingMemory = {
      inspectedFiles: [],
      editedFiles: [],
      pendingTasks: [],
      discoveredIssues: [],
      verificationResults: [],
      repoSummary: '',
    };

    const executionState: AgentExecutionState = {
      currentGoal: task,
      completedSteps: [],
      failedSteps: [],
      inspectedFiles: [],
      editedFiles: [],
      discoveredStack: [],
      discoveredEntrypoints: [],
      assumptions: [],
      blockers: [],
      repoSummary: '',
    };

    let isResumed = false;
    if (config.restoredHistory && config.restoredHistory.length > 0) {
      context.restoreHistory(config.restoredHistory);
      isResumed = true;
    }

    if (!isResumed) {
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
    }

    while (iterations < MAX && !stopped) {
      iterations++;
      yield { type: 'iteration', count: iterations, max: MAX };

      try {
        // Inject working memory summary into context (only when there's actual data)
        const memSummary = buildMemorySummary(workingMemory, executionState);
        if (memSummary.trim() !== '[WORKING MEMORY]') {
          context.addTurn({ role: 'user', content: memSummary });
        }

        const history = context.getHistoryForRequest();
        const prompt = history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n\n');

        const systemPromptTokens = context.estimateTokens(systemPrompt.full);
        const promptTokens = context.estimateTokens(prompt);
        context.recordInputTokens(promptTokens);
        await logDebug(debug, `Prompt tokens: ${promptTokens} (System prompt: ${systemPromptTokens}, overhead: ${Math.round((systemPromptTokens / (promptTokens || 1)) * 100)}%)`);

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

        const responseTokens = context.estimateTokens(raw);
        context.recordOutputTokens(responseTokens);

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
              yield* handleDone();
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
            yield* handleDone();
            return;
          }

        if (parsed.isDone) {
          context.addTurn({ role: 'assistant', content: raw });
          yield* handleDone();
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
            yield* handleDone();
            return;
          }
          const result = await executeTool(parsed.toolCall, registry);
          await logDebug(debug, `TOOL_RESULT ${parsed.toolCall.name} success=${result.success}:\n${result.output}\n${result.error ?? ''}`);

          yield { type: 'step', content: result.success ? `✓ ${parsed.toolCall.name}` : `✗ ${parsed.toolCall.name}` };

          yield { type: 'tool_result', name: parsed.toolCall.name, success: result.success, output: result.output || result.error || '' };
          hasProducedOutput = true;
          afterToolExecution = true;

          // Track in working memory
          const toolName = parsed.toolCall.name;
          if (isReadTool(toolName) && result.success) {
            const path = String(parsed.toolCall.params.path ?? parsed.toolCall.params.file_path ?? '');
            if (path && !workingMemory.inspectedFiles.includes(path)) {
              workingMemory.inspectedFiles.push(path);
            }
          }
          if (isEditTool(toolName) && result.success) {
            const path = String(parsed.toolCall.params.path ?? parsed.toolCall.params.file_path ?? '');
            if (path && !workingMemory.editedFiles.includes(path)) {
              workingMemory.editedFiles.push(path);
            }

            // Hardened Verification Chain
            if (!config.skipVerify) {
              yield { type: 'status', content: 'Running verification chain...' };
              const verifyRes = await VerificationChain.run(false);
              if (!verifyRes.passed) {
                const errorContext = VerificationChain.formatFailuresForAgent(verifyRes.results);
                context.addTurn({ role: 'user', content: errorContext });
                yield { type: 'step', content: `✗ verification failed` };
              } else if (verifyRes.badge) {
                yield { type: 'step', content: verifyRes.badge };
              }
            }
          }
          if (!result.success) {
            const issue = `${toolName}: ${(result.error ?? result.output).slice(0, 80)}`;
            if (!workingMemory.discoveredIssues.includes(issue)) {
              workingMemory.discoveredIssues.push(issue);
            }
          }
          if (toolName === 'execute_bash' && result.success) {
            const output = result.output;
            const cmd = String(parsed.toolCall.params.cmd ?? parsed.toolCall.params.command ?? '');
            if (/pass|success|✓/.test(output) && /test|check|verify|lint|typecheck|build/.test(cmd)) {
              workingMemory.verificationResults.push(`✓ ${cmd.slice(0, 40)}`);
            }
          }

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
    setDebug(value: boolean): void { debug = value; },
    getState(): { history: ConversationTurn[] } {
      return { history: context.getHistoryForRequest() };
    }
  };
}
