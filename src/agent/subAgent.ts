import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MelaClient } from '../api/melaClient';
import { createSubAgentRegistry } from './subAgentRegistry';
import { executeTool, formatToolResult } from '../tools/executor';
import { parseModelResponse } from '../tools/parser';
import type { ToolRegistry } from '../tools/registry';

export interface SubAgentParams {
  agentType: string;
  prompt: string;
  params?: Record<string, unknown>;
}

export interface SubAgentResult {
  agentType: string;
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
  filesModified?: string[];
}

/**
 * Agent type definitions with their capabilities.
 */
interface AgentTypeDefinition {
  agentType: string;
  description: string;
  allowedTools: string[];
  maxIterations: number;
}

const AGENT_TYPES: AgentTypeDefinition[] = [
  {
    agentType: 'file-picker',
    description: 'Find relevant files in a codebase related to a prompt. Uses fuzzy search. Cannot do string searches.',
    allowedTools: ['read_file', 'list_dir', 'find_files', 'file_info', 'glob', 'set_output'],
    maxIterations: 5
  },
  {
    agentType: 'code-searcher',
    description: 'Search codebase using ripgrep-style patterns. Executes multiple search queries and returns line matches.',
    allowedTools: ['search_files', 'find_symbol', 'get_references', 'read_file', 'list_dir', 'glob', 'set_output'],
    maxIterations: 5
  },
  {
    agentType: 'basher',
    description: 'Execute terminal commands and summarize output.',
    allowedTools: ['execute_bash', 'execute_long_running', 'check_job', 'read_output', 'set_output'],
    maxIterations: 5
  },
  {
    agentType: 'researcher-web',
    description: 'Search the web and fetch URL content to find information.',
    allowedTools: ['web_search', 'fetch_url', 'set_output'],
    maxIterations: 5
  },
  {
    agentType: 'researcher-docs',
    description: 'Read technical documentation of major public libraries and frameworks.',
    allowedTools: ['web_search', 'fetch_url', 'read_file', 'set_output'],
    maxIterations: 5
  },
  {
    agentType: 'code-reviewer-deepseek-flash',
    description: 'Review file changes and provide critical feedback on code quality, correctness, and style.',
    allowedTools: ['read_file', 'git_diff', 'show_diff', 'git_status', 'list_dir', 'search_files', 'find_files', 'set_output'],
    maxIterations: 8
  },
  {
    agentType: 'thinker-gpt',
    description: 'Deep thinking agent that reasons about a problem given context. Has no tool access - only produces analysis.',
    allowedTools: ['set_output'],
    maxIterations: 1
  }
];

function getSystemPrompt(agentType: string, definition: AgentTypeDefinition, registry: ToolRegistry): string {
  return `You are a specialized sub-agent: "${agentType}".
${definition.description}

Your task is specific and focused. Complete it efficiently.

AVAILABLE TOOLS:
${registry.toSystemPromptSchema()}

RULES:
1. You must use exactly ONE tool call per response.
2. After gathering all needed information, call set_output to report your findings.
3. Call set_output with your final results when done. Do NOT emit <done/> — just call the tool.
4. Keep responses brief and factual.
5. Do NOT ask the user questions. Do NOT produce plans or outlines.
6. Complete the task autonomously.`;
}

function isOutputTool(name: string): boolean {
  return name === 'set_output';
}

/**
 * Run a single sub-agent with its own isolated context and tool registry.
 */
export async function runSubAgent(
  spec: SubAgentParams,
  melaToken: string,
  client: MelaClient
): Promise<SubAgentResult> {
  const definition = AGENT_TYPES.find(t => t.agentType === spec.agentType);
  if (!definition) {
    return {
      agentType: spec.agentType,
      success: false,
      output: '',
      error: `Unknown agent type: "${spec.agentType}". Available types: ${AGENT_TYPES.map(t => t.agentType).join(', ')}`
    };
  }

  const registry = createSubAgentRegistry(definition.allowedTools);
  const systemPrompt = getSystemPrompt(spec.agentType, definition, registry);

  // Build conversation as a single prompt for Mela
  const buildPrompt = (history: Array<{ role: 'user' | 'assistant'; content: string }>): string => {
    return history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n\n');
  };

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: systemPrompt }
  ];

  let agentPrompt = spec.prompt;
  if (spec.params && typeof spec.params === 'object') {
    const paramStr = Object.entries(spec.params)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join('\n');
    agentPrompt += `\n\nParameters:\n${paramStr}`;
  }
  history.push({ role: 'user', content: agentPrompt });

  let iterations = 0;
  const MAX = definition.maxIterations;
  let lastOutput = '';
  const filesModified: string[] = [];

  while (iterations < MAX) {
    iterations++;

    try {
      const prompt = buildPrompt(history);
      const response = await client.generate(prompt, {});

      const raw = response.response_text;
      // Log sub-agent activity to debug
      const debugDir = path.join(os.homedir(), '.addis-code');
      try {
        await fs.mkdir(debugDir, { recursive: true });
        await fs.appendFile(
          path.join(debugDir, 'subagent-debug.log'),
          `${new Date().toISOString()} [${spec.agentType}] ITER ${iterations}:\n${raw}\n---\n`,
          'utf8'
        );
      } catch { /* ignore debug logging failures */ }

      const parsed = parseModelResponse(raw);

      if (parsed.isError) {
        return { agentType: spec.agentType, success: false, output: '', error: parsed.isError };
      }

      if (parsed.text && !parsed.toolCall) {
        // Just text response - store it and continue
        lastOutput = parsed.text;
        history.push({ role: 'assistant', content: raw });
        if (parsed.isDone) {
          return { agentType: spec.agentType, success: true, output: lastOutput };
        }
        history.push({ role: 'user', content: 'Continue. If you have enough information, call set_output to report your findings.' });
        continue;
      }

      if (parsed.toolCall) {
        history.push({ role: 'assistant', content: raw });

        if (parsed.toolCall.name === 'set_output') {
          const output = typeof parsed.toolCall.params.data === 'object'
            ? JSON.stringify(parsed.toolCall.params.data, null, 2)
            : (typeof parsed.toolCall.params.message === 'string'
              ? parsed.toolCall.params.message
              : JSON.stringify(parsed.toolCall.params));
          return { agentType: spec.agentType, success: true, output, filesModified };
        }

        const toolName = parsed.toolCall.name;
        if (['write_file', 'edit_file', 'str_replace', 'delete_file'].includes(toolName)) {
          const file = parsed.toolCall.params.path ?? parsed.toolCall.params.file_path ?? parsed.toolCall.params.target_file;
          if (typeof file === 'string') {
            const absPath = path.resolve(process.cwd(), file);
            if (!filesModified.includes(absPath)) {
              filesModified.push(absPath);
            }
          }
        }

        const result = await executeTool(parsed.toolCall, registry);
        history.push({ role: 'user', content: formatToolResult(parsed.toolCall.name, result) });
        continue;
      }

      // Unparseable response - nudge
      history.push({ role: 'user', content: 'Your response was not recognized. Call a tool or use set_output to report results.' });
    } catch (err: any) {
      return {
        agentType: spec.agentType,
        success: false,
        output: lastOutput,
        error: err?.message ?? 'Sub-agent execution failed',
        filesModified
      };
    }
  }

  return {
    agentType: spec.agentType,
    success: lastOutput.length > 0,
    output: lastOutput || 'Sub-agent reached max iterations without producing output.',
    error: lastOutput ? undefined : `Reached max iterations (${MAX})`,
    filesModified
  };
}

/**
 * Get the list of available agent types.
 */
export function getAvailableAgentTypes(): { agentType: string; description: string }[] {
  return AGENT_TYPES.map(t => ({ agentType: t.agentType, description: t.description }));
}
