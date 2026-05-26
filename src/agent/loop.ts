import { promises as fs } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
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
import { EnhancedVerificationChain } from '../verification/languageAware';
import { StateMachine, AgentState } from './stateMachine';
import { TaskOrchestrator } from './taskOrchestrator';
import { ResultClass } from '../verification/chain';
import { MemoryManager } from '../memory/memoryManager';

const RAW_FILE_START_RE = /^[\w\-. ]+\.(html?|css|js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|vue|svelte|php|json|md|yaml|yml|xml|sql|sh|bash|env)\s*$/mi;
const RAW_FILE_CONTENT_RE = /^(?:<!DOCTYPE|<html|<script|<style|<\?|<svg|<!doctype|@import|import\s+|export\s+|const\s+|let\s+|var\s+|function\s+|class\s+|interface\s+|type\s+|def\s+|pub\s+fn|fn\s+|package\s+|\#include|\#ifndef)/i;

function filterToolAndFileFence(
  chunk: string,
  toolNames: Set<string>,
  insideFence: { value: boolean },
  insideFileContent: { value: boolean }
): string {
  let result = '';
  let remaining = chunk;

  while (remaining.length > 0) {
    // ── Inside tool fence: skip until close ──
    if (insideFence.value) {
      const closeTriple = remaining.indexOf('```');
      const closeSingle = remaining.indexOf('`');
      const closeIdx = closeTriple >= 0 && (closeSingle < 0 || closeTriple <= closeSingle) ? closeTriple : closeSingle;
      if (closeIdx < 0) return result;
      insideFence.value = false;
      remaining = remaining.slice(closeIdx + (closeIdx === closeTriple ? 3 : 1));
      continue;
    }

    // ── Inside raw file content: skip until end ──
    if (insideFileContent.value) {
      // File content ends when we see a tool fence open, or at end of chunk
      const toolOpenRe = /```(\w+)/;
      const toolMatch = remaining.match(toolOpenRe);
      if (toolMatch && toolNames.has(toolMatch[1])) {
        insideFileContent.value = false;
        // Don't consume the match — let the tool fence handler deal with it next iteration
        continue;
      }
      // Also end if model starts a new thought or explanatory text
      const endRe = /^(?:```|\n\s*(?:Thought|\+ |Let me|I should|I need|I'll|Now |Here's |This |\d+\.\s|\[done\]))/m;
      const endMatch = remaining.match(endRe);
      if (endMatch) {
        insideFileContent.value = false;
        result += remaining.slice(0, endMatch.index);
        remaining = remaining.slice(endMatch.index);
        continue;
      }
      return result;
    }

    // ── Check for tool fence open (triple or single backtick) ──
    const openRe = /```(\w+)/;
    const match = remaining.match(openRe);
    const singleRe = /(?<!`)`(\w+)/;
    const singleMatch = remaining.match(singleRe);

    const toolName = match && toolNames.has(match[1]) ? match[1] : (singleMatch && toolNames.has(singleMatch[1]) ? singleMatch[1] : null);
    if (toolName) {
      const fullMatch = toolName === match?.[1] ? match : singleMatch!;
      result += remaining.slice(0, fullMatch.index);
      const afterOpen = remaining.slice(fullMatch.index! + fullMatch[0].length);
      const closeTripleIdx = afterOpen.indexOf('```');
      const closeSingleIdx = afterOpen.indexOf('`');
      const closeIdx = closeTripleIdx >= 0 && (closeSingleIdx < 0 || closeTripleIdx <= closeSingleIdx) ? closeTripleIdx : closeSingleIdx;

      if (closeIdx >= 0) {
        remaining = afterOpen.slice(closeIdx + (closeIdx === closeTripleIdx ? 3 : 1));
        continue;
      }
      insideFence.value = true;
      break;
    }

    // ── If nothing matched, keep everything ──
    result += remaining;
    break;
  }

  return result;
}

import { ConversationTurn, WorkingMemory } from './contextManager';

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
  | { type: 'thinking_start' }
  | { type: 'thinking_chunk'; content: string }
  | { type: 'thinking_end' }
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

const FILE_CREATION_RE = /create|generate|make|write|build|produce|save|output/i;
const FILE_EXT_RE = /\.(\w+)\b/;

function isFileCreationTask(task: string): boolean {
  return FILE_CREATION_RE.test(task) && FILE_EXT_RE.test(task);
}

function inferFilename(task: string, language: string): string {
  const extMap: Record<string, string> = {
    html: 'index.html', css: 'style.css', js: 'script.js', ts: 'script.ts',
    jsx: 'component.jsx', tsx: 'component.tsx', json: 'data.json',
    py: 'script.py', rs: 'main.rs', go: 'main.go', java: 'Main.java',
    c: 'main.c', cpp: 'main.cpp', rb: 'script.rb', php: 'index.php',
    vue: 'App.vue', svelte: 'App.svelte', md: 'README.md', yaml: 'config.yaml',
    yml: 'config.yml', toml: 'config.toml', xml: 'config.xml',
    sql: 'query.sql', sh: 'script.sh', bash: 'script.sh',
  };
  const extMatch = task.match(FILE_EXT_RE);
  if (extMatch) return `index.${extMatch[1]}`;
  if (extMap[language]) return extMap[language];
  return 'output.txt';
}

const FILE_HEADER_RE = /^[\w\-. ]+\.(html?|css|js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|vue|svelte|php|json|md|yaml|yml|xml|sql|sh|bash)\s*\n/m;

function extractCodeBlock(text: string): { filename: string; language: string; content: string } | null {
  // Try fenced code blocks first
  const fenceMatch = text.match(/```(\w*)\n?([\s\S]*?)```/);
  if (fenceMatch) {
    const language = fenceMatch[1] || 'txt';
    const content = fenceMatch[2].trim();
    if (content) return { filename: inferFilename('', language), language, content };
  }
  // Try non-fenced format: filename.ext\n<content>
  const fileHeader = text.match(FILE_HEADER_RE);
  if (fileHeader) {
    const filename = fileHeader[0].trim();
    const ext = fileHeader[1];
    const langMap: Record<string, string> = {
      html: 'html', htm: 'html', css: 'css', js: 'js', ts: 'ts',
      jsx: 'jsx', tsx: 'tsx', py: 'py', rb: 'rb', go: 'go', rs: 'rs',
      java: 'java', c: 'c', cpp: 'cpp', vue: 'vue', svelte: 'svelte',
      php: 'php', json: 'json', md: 'md', yaml: 'yaml', yml: 'yaml',
      xml: 'xml', sql: 'sql', sh: 'bash', bash: 'bash',
    };
    const content = text.slice(fileHeader.index! + fileHeader[0].length).trim();
    if (content) return { filename, language: langMap[ext] || 'txt', content };
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

// P5.1: Classify stream errors into user-friendly messages
function classifyStreamError(err: Error): string {
  const msg = err.message.toLowerCase();
  if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('enotfound'))
    return 'Network error: Cannot reach the Mela API. Check your internet connection.';
  if (msg.includes('create-session failed: 500') || msg.includes('http 500'))
    return 'Server error: The Mela API is experiencing issues. Will retry automatically.';
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized'))
    return 'Authentication failed: Your MELA_TOKEN may be invalid or expired. Run `mela-coder --login` to get a fresh token.';
  if (msg.includes('terminated') || msg.includes('aborted'))
    return 'Connection terminated: The API stream was interrupted. Will retry automatically.';
  if (msg.includes('429') || msg.includes('rate'))
    return 'Rate limited: Too many requests. Please wait a moment.';
  if (msg.includes('timeout') || msg.includes('etimedout'))
    return 'Request timed out: The server took too long to respond.';
  return `Stream error: ${err.message}`;
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
  const memory = new MemoryManager();
  const context = new ContextManager(systemPrompt, memory);
  const client = new MelaClient(config.melaToken);
  let stopped = false;
  let debug = config.debug ?? false;

  // Runtime components
  const stateMachine = new StateMachine();
  const orchestrator = new TaskOrchestrator();

  // Load project memory into working memory
  memory.loadProjectMemory().catch(() => {});

  const gate = new PermissionGate({
    allowAll: config.dangerouslyAllowAll,
    readOnly: config.readOnly,
  });
  setPermissionGate(gate);

  async function* run(task: string): AsyncGenerator<AgentEvent> {
    // P1.2: Always start from clean state (fixes REPL multi-turn crashes)
    stateMachine.reset();
    orchestrator.reset();

    // Initialize task plan
    const plan = orchestrator.createPlan(task);
    
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

    // P2.3: Circuit breaker for consecutive stream failures
    let consecutiveStreamFailures = 0;
    const MAX_STREAM_FAILURES = 3;

    // P2.1: Tool-level loop detection (tracks recent tool call signatures)
    const recentToolSignatures: string[] = [];
    const MAX_IDENTICAL_TOOL_CALLS = 3;

    // Working memory is managed by context manager
    let workingMemory = context.getWorkingMemory();

    const executionState: AgentExecutionState = {
      currentGoal: task,
      completedSteps: [],
      failedSteps: [],
      inspectedFiles: workingMemory.inspectedFiles,
      editedFiles: workingMemory.editedFiles,
      discoveredStack: [],
      discoveredEntrypoints: [],
      assumptions: [],
      blockers: [],
      repoSummary: workingMemory.repoSummary,
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

    // Transition to planning state
    stateMachine.transition(AgentState.PLANNING, 'start_task');

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

        // Context window protection: trim oldest turns if context exceeds ~50K chars
        const MAX_CONTEXT_CHARS = 50000;
        let totalChars = history.reduce((sum, t) => sum + t.content.length, 0);
        while (totalChars > MAX_CONTEXT_CHARS && history.length > 4) {
          // Keep index 0 (system prompt), drop index 1 (oldest turn)
          totalChars -= history[1].content.length;
          history.splice(1, 1);
        }

        const prompt = history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n\n');

        const systemPromptTokens = context.estimateTokens(systemPrompt.full);
        const promptTokens = context.estimateTokens(prompt);
        context.recordInputTokens(promptTokens);
        await logDebug(debug, `Prompt tokens: ${promptTokens} (System prompt: ${systemPromptTokens}, overhead: ${Math.round((systemPromptTokens / (promptTokens || 1)) * 100)}%)`);

        yield { type: 'stream_start' };
        let raw = '';
        const toolNames = new Set(registry.all().map(t => t.name));
        const fenceState = { value: false };
        const fileContentState = { value: false };
        let thinkingStarted = false;
        try {
          for await (const chunk of client.generateStream(prompt, {
            reasoning: config.reasoning ?? true,
            search: config.search ?? false,
          })) {
            if (chunk.reasoning) {
              if (!thinkingStarted) {
                yield { type: 'thinking_start' };
                thinkingStarted = true;
              }
              yield { type: 'thinking_chunk', content: chunk.reasoning };
            }
            if (chunk.text) {
              if (thinkingStarted) {
                yield { type: 'thinking_end' };
                thinkingStarted = false;
              }
              raw += chunk.text;
              // Stream size limit: prevent OOM from massive responses
              const MAX_RAW_CHARS = 20000;
              if (raw.length > MAX_RAW_CHARS) {
                raw = raw.slice(-MAX_RAW_CHARS);
              }
              const displayText = filterToolAndFileFence(chunk.text, toolNames, fenceState, fileContentState);
              if (displayText) {
                yield { type: 'stream_chunk', content: displayText };
              }
            }
            if (chunk.status) {
              if (thinkingStarted) {
                yield { type: 'thinking_end' };
                thinkingStarted = false;
              }
              yield { type: 'status', content: chunk.status };
            }
            if (chunk.done) break;
          }
        } catch (streamErr: any) {
          if (thinkingStarted) {
            yield { type: 'thinking_end' };
            thinkingStarted = false;
          }
          yield { type: 'stream_end' };
          if (!raw) {
            // P2.3: Track consecutive stream failures
            consecutiveStreamFailures++;
            const friendlyMsg = classifyStreamError(streamErr);
            yield { type: 'error', message: friendlyMsg };
            if (consecutiveStreamFailures >= MAX_STREAM_FAILURES) {
              yield { type: 'error', message: `Connection failed ${MAX_STREAM_FAILURES} times consecutively. Please check your network and API token, then try again.` };
              return;
            }
            continue;
          }
          await logDebug(debug, `Stream error after ${raw.length} chars: ${streamErr.message}`);
        }
        // P2.3: Reset circuit breaker on successful stream
        consecutiveStreamFailures = 0;
        if (thinkingStarted) {
          yield { type: 'thinking_end' };
          thinkingStarted = false;
        }
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

        // Detect raw file content (filename.ext followed by content) and convert to tool call
        // This handles cases where the model outputs: "one.html\n<!DOCTYPE html>..." instead of proper format
        if (isFileCreationTask(task)) {
          const rawFileMatch = raw.match(/^\s*([\w\-./]+\.(?:html?|css|js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|vue|svelte|php|json|md|yaml|yml|xml|sql|sh))\s*\n([\s\S]*)/i);
          if (rawFileMatch) {
            const filename = rawFileMatch[1];
            const content = rawFileMatch[2].trim();
            // Wrap as proper tool call format so parser can handle it
            raw = '```write_file\n' + filename + '\n' + content + '\n```';
          }
        }

        const parsed = parseMelaResponse(raw, toolNames);

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

          // Fallback: if model output code as text instead of calling write_file
          const codeBlock = extractCodeBlock(parsed.text);
          if (codeBlock && isFileCreationTask(task)) {
            yield { type: 'text', content: `→ Auto-saving ${codeBlock.filename} (${codeBlock.content.length} chars)` };
            const result = await executeTool({
              name: 'write_file',
              params: { path: codeBlock.filename, content: codeBlock.content }
            }, registry);
            yield { type: 'tool_result', name: 'write_file', success: result.success, output: result.output || result.error || '' };
            if (result.success) {
              workingMemory.editedFiles.push(codeBlock.filename);
            }
            yield* handleDone();
            return;
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

        if (parsed.toolCalls && parsed.toolCalls.length > 0) {
          context.addTurn({ role: 'assistant', content: raw });

          // Transition to executing state now that we have tool calls (only once per turn)
          if (stateMachine.getCurrent() !== AgentState.EXECUTING) {
            stateMachine.transition(AgentState.EXECUTING, 'tool_calls_received');
          }

          for (const toolCall of parsed.toolCalls) {
            yield { type: 'tool_call', name: toolCall.name, params: toolCall.params };

            // P2.1: Track tool call signatures for loop detection
            const toolSig = `${toolCall.name}:${JSON.stringify(toolCall.params)}`;
            recentToolSignatures.push(toolSig);
            // Keep only last 10 signatures
            if (recentToolSignatures.length > 10) recentToolSignatures.shift();

            if (toolCall.name === 'done') {
              const summary = toolCall.params.summary;
              if (typeof summary === 'string' && summary.trim()) {
                yield { type: 'text', content: summary };
              }
              yield* handleDone();
              return;
            }

            const result = await executeTool(toolCall, registry);
            await logDebug(debug, `TOOL_RESULT ${toolCall.name} success=${result.success}:\n${result.output}\n${result.error ?? ''}`);

            // Cross-check: verify file-modifying tools actually applied changes to disk
            if (result.success) {
              if (toolCall.name === 'write_file') {
                const filePath = String(toolCall.params.path ?? '');
                if (filePath) {
                  try {
                    await fs.access(path.resolve(process.cwd(), filePath));
                  } catch {
                    result.success = false;
                    result.error = `[VERIFY FAILED] File was not actually created/updated on disk: ${filePath}`;
                    await logDebug(debug, `CROSS_CHECK write_file: ${filePath} not found after success`);
                  }
                }
              } else if (toolCall.name === 'edit_file' || toolCall.name === 'str_replace') {
                const filePath = String(toolCall.params.path ?? '');
                if (filePath) {
                  try {
                    await fs.access(path.resolve(process.cwd(), filePath));
                  } catch {
                    result.success = false;
                    result.error = `[VERIFY FAILED] File was not actually found on disk for post-verification: ${filePath}`;
                    await logDebug(debug, `CROSS_CHECK ${toolCall.name}: ${filePath} not found after success`);
                  }
                }
              }
            }

            yield { type: 'tool_result', name: toolCall.name, success: result.success, output: result.output || result.error || '' };

            hasProducedOutput = true;
            afterToolExecution = true;

            // P2.2: Special recovery for permission denials — don't let model retry
            if (!result.success && result.error?.includes('[BLOCKED]')) {
              context.addTurn({
                role: 'user',
                content: `[PERMISSION DENIED] The user explicitly denied permission for "${toolCall.name}". Do NOT retry this action. Inform the user that the action was blocked and suggest an alternative, then end with [done].`
              });
              break; // Skip remaining tool calls in this batch
            }

            // P2.1: Recovery for unknown tool calls — correct the model
            if (!result.success && result.error?.includes('Unknown tool')) {
              context.addTurn({
                role: 'user',
                content: `[TOOL ERROR] "${toolCall.name}" is not a valid tool. Do NOT call it again. Use only these tools: ${Array.from(toolNames).slice(0, 15).join(', ')}... Call a valid tool or provide a text response with [done].`
              });
              break;
            }

            // P2.1: Detect tool-level loops (same tool+params called 3+ times)
            const lastN = recentToolSignatures.slice(-MAX_IDENTICAL_TOOL_CALLS);
            if (lastN.length >= MAX_IDENTICAL_TOOL_CALLS && lastN.every(s => s === lastN[0])) {
              context.addTurn({
                role: 'user',
                content: `[LOOP DETECTED] You have called "${toolCall.name}" with identical parameters ${MAX_IDENTICAL_TOOL_CALLS} times in a row. This is stuck in a loop. Try a completely different approach or inform the user of the issue, then end with [done].`
              });
              recentToolSignatures.length = 0; // Reset to avoid re-triggering
              break;
            }

            // Track in working memory
            const toolName = toolCall.name;
            if (isReadTool(toolName) && result.success) {
              const pathStr = String(toolCall.params.path ?? toolCall.params.file_path ?? '');
              if (pathStr && !workingMemory.inspectedFiles.includes(pathStr)) {
                workingMemory.inspectedFiles.push(pathStr);
              }
            }

            // Skip verification for delete operations - the file is gone and lint/test may be irrelevant
            if (isEditTool(toolName) && result.success && toolName !== 'delete_file') {
              const pathStr = String(toolCall.params.path ?? toolCall.params.file_path ?? '');
              if (pathStr && !workingMemory.editedFiles.includes(pathStr)) {
                workingMemory.editedFiles.push(pathStr);
              }

              // Hardened Verification Chain
              if (!config.skipVerify) {
                yield { type: 'status', content: 'Running verification chain...' };
                const verifyRes = await EnhancedVerificationChain.run(false, false, true);

                if (!verifyRes.passed && verifyRes.evaluation) {
                  const evaluation = verifyRes.evaluation;

                  if (evaluation.class === ResultClass.RETRY) {
                    const errorContext = VerificationChain.formatFailuresForAgent(verifyRes.results);
                    context.addTurn({ role: 'user', content: errorContext });
                    yield { type: 'step', content: `✗ verification failed - ${evaluation.reason}` };
                  } else if (evaluation.class === ResultClass.FAIL) {
                    yield { type: 'step', content: `✗ ${evaluation.reason}` };
                  }
                } else if (verifyRes.badge) {
                  yield { type: 'step', content: verifyRes.badge };
                }

                // Update state based on result
                stateMachine.transition(
                  verifyRes.passed ? AgentState.SUCCESS : AgentState.VERIFYING,
                  verifyRes.passed ? 'verification_passed' : 'verification_failed'
                );
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
              const cmd = String(toolCall.params.cmd ?? toolCall.params.command ?? '');
              if (/pass|success|✓/.test(output) && /test|check|verify|lint|typecheck|build/.test(cmd)) {
                workingMemory.verificationResults.push(`✓ ${cmd.slice(0, 40)}`);
              }
            }

            // Sync working memory back to context
            context.updateWorkingMemory(workingMemory);
            context.addTurn({ role: 'user', content: formatToolResult(toolCall.name, result) });
          }
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
    reset(): void { context.reset(); stateMachine.reset(); orchestrator.reset(); },
    getHistoryStats(): { turns: number; estimatedTokens: number } {
      return context.getHistoryStats();
    },
    setDebug(value: boolean): void { debug = value; },
    getState(): { history: ConversationTurn[] } {
      return { history: context.getHistoryForRequest() };
    }
  };
}
