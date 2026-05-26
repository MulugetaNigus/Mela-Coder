import type { ToolDefinition, ToolResult } from '../registry';
import { getAvailableAgentTypes, type SubAgentParams } from '../../agent/subAgent';
import { MelaClient } from '../../api/melaClient';
import { AgentDispatcher } from '../../agents/dispatcher';

export const spawnAgentsTool: ToolDefinition = {
  name: 'spawn_agents',
  description: 'Spawn specialized sub-agents to help complete complex tasks. Each sub-agent runs independently with limited tools and reports results. Supports: file-picker, code-searcher, basher, researcher-web, researcher-docs, code-reviewer-deepseek-flash, thinker-gpt.',
  params: [
    { name: 'agents', type: 'string', required: true, description: 'JSON stringified array of { agent_type: string, prompt: string, params?: object } objects. Each agent runs independently.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.agents !== 'string') throw new Error('agents must be a JSON string');

      const rawAgents: Array<Record<string, unknown>> = JSON.parse(params.agents);
      if (!Array.isArray(rawAgents)) throw new Error('agents must be a JSON array');
      if (rawAgents.length === 0) throw new Error('agents must have at least 1 item');

      const agents: SubAgentParams[] = rawAgents.map(a => ({
        agentType: (a.agentType ?? a.agent_type ?? '') as string,
        prompt: (a.prompt ?? '') as string,
        params: a.params as Record<string, unknown> | undefined
      }));

      const melaToken = process.env.MELA_TOKEN;
      const melaRefreshToken = process.env.MELA_REFRESH_TOKEN;
      if (!melaToken) {
        return { success: false, output: '', error: 'MELA_TOKEN not set' };
      }

      const client = new MelaClient(melaToken, {
        refreshTokenCookie: melaRefreshToken,
      });

      const dispatcher = new AgentDispatcher(3);
      const results = await dispatcher.dispatch(agents, melaToken, client);

      const lines: string[] = ['Sub-Agent Results:'];
      let allSucceeded = true;

      for (let i = 0; i < results.length; i++) {
        const agent = agents[i];
        const res = results[i];

        lines.push(`\n  -- Agent ${i + 1}: ${agent.agentType} --`);

        if (res.success) {
          lines.push(`  [ok] Success`);
          const outputPreview = res.output.length > 500
            ? res.output.slice(0, 500) + `\n  [${res.output.length - 500} more chars]`
            : res.output;
          if (outputPreview) {
            lines.push(`  Output: ${outputPreview}`);
          }
        } else {
          lines.push(`  [fail] Failed: ${res.error ?? 'Unknown error'}`);
          allSucceeded = false;
        }
      }

      // Check conflicts
      const conflicts = AgentDispatcher.checkConflicts(results);
      if (conflicts.length > 0) {
        lines.push('\nWarnings:');
        lines.push(...conflicts.map(c => `  ${c}`));
      }

      return {
        success: allSucceeded,
        output: lines.join('\n'),
        error: allSucceeded ? undefined : 'One or more sub-agents failed'
      };
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        return { success: false, output: '', error: 'agents must be a valid JSON array' };
      }
      return { success: false, output: '', error: err?.message ?? 'Failed to spawn agents' };
    }
  }
};

export const getAgentTypesTool: ToolDefinition = {
  name: 'get_agent_types',
  description: 'List available sub-agent types and their descriptions.',
  params: [],
  async execute(): Promise<ToolResult> {
    const types = getAvailableAgentTypes();
    const lines = types.map(t => `  - ${t.agentType}: ${t.description}`);
    return { success: true, output: `Available agent types:\n${lines.join('\n')}` };
  }
};

function mapTaskToAgentType(description: string, prompt: string): string {
  const text = `${description} ${prompt}`.toLowerCase();
  if (/\b(picker|find|locate|where is|search files?|list files?|list_dir|file_info)\b/.test(text)) {
    return 'file-picker';
  }
  if (/\b(search|grep|ripgrep|pattern|find symbol|references|regex)\b/.test(text)) {
    return 'code-searcher';
  }
  if (/\b(run|execute|bash|command|shell|npm|yarn|pnpm|cargo|pip|python|test|lint|typecheck|build)\b/.test(text)) {
    return 'basher';
  }
  if (/\b(web|search web|google|bing|duckduckgo|url|http|fetch)\b/.test(text)) {
    if (/\b(doc|documentation|library|framework|api reference|manual)\b/.test(text)) {
      return 'researcher-docs';
    }
    return 'researcher-web';
  }
  if (/\b(review|code quality|review changes|git diff|diff|style|lint error|refactor feedback)\b/.test(text)) {
    return 'code-reviewer-deepseek-flash';
  }
  return 'thinker-gpt';
}

export const dispatchSubtasksTool: ToolDefinition = {
  name: 'dispatch_subtasks',
  description: 'Dispatch multiple sub-tasks to specialized agents concurrently. You specify a list of tasks with descriptions and prompts; the dispatcher will map them to the correct agent types (file-picker, code-searcher, basher, researcher-web, researcher-docs, code-reviewer-deepseek-flash, thinker-gpt) automatically, execute them in parallel, check for overlapping file modification conflicts, and report the merged results.',
  params: [
    {
      name: 'tasks',
      type: 'string',
      required: true,
      description: 'JSON stringified array of { description: string, prompt: string, params?: object } tasks to dispatch.'
    }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.tasks !== 'string') throw new Error('tasks must be a JSON string');

      const rawTasks: Array<Record<string, unknown>> = JSON.parse(params.tasks);
      if (!Array.isArray(rawTasks)) throw new Error('tasks must be a JSON array');
      if (rawTasks.length === 0) throw new Error('tasks must have at least 1 item');

      const melaToken = process.env.MELA_TOKEN;
      const melaRefreshToken = process.env.MELA_REFRESH_TOKEN;
      if (!melaToken) {
        return { success: false, output: '', error: 'MELA_TOKEN not set' };
      }

      const client = new MelaClient(melaToken, {
        refreshTokenCookie: melaRefreshToken,
      });

      const agents: SubAgentParams[] = rawTasks.map(t => {
        const desc = (t.description ?? '') as string;
        const prompt = (t.prompt ?? '') as string;
        const mappedType = mapTaskToAgentType(desc, prompt);
        return {
          agentType: mappedType,
          prompt,
          params: t.params as Record<string, unknown> | undefined
        };
      });

      const dispatcher = new AgentDispatcher(3);
      const results = await dispatcher.dispatch(agents, melaToken, client);

      const lines: string[] = ['Sub-Task Dispatch Results:'];
      let allSucceeded = true;

      for (let i = 0; i < results.length; i++) {
        const originalTask = rawTasks[i];
        const res = results[i];
        const mappedType = agents[i].agentType;

        lines.push(`\n  -- Task ${i + 1}: ${originalTask.description || 'Untitled'} (Mapped to ${mappedType}) --`);

        if (res.success) {
          lines.push(`  [ok] Success`);
          const outputPreview = res.output.length > 500
            ? res.output.slice(0, 500) + `\n  [${res.output.length - 500} more chars]`
            : res.output;
          if (outputPreview) {
            lines.push(`  Output: ${outputPreview}`);
          }
        } else {
          lines.push(`  [fail] Failed: ${res.error ?? 'Unknown error'}`);
          allSucceeded = false;
        }
      }

      // Check conflicts
      const conflicts = AgentDispatcher.checkConflicts(results);
      if (conflicts.length > 0) {
        lines.push('\nWarnings:');
        lines.push(...conflicts.map(c => `  ${c}`));
      }

      return {
        success: allSucceeded,
        output: lines.join('\n'),
        error: allSucceeded ? undefined : 'One or more sub-tasks failed'
      };
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        return { success: false, output: '', error: 'tasks must be a valid JSON array' };
      }
      return { success: false, output: '', error: err?.message ?? 'Failed to dispatch sub-tasks' };
    }
  }
};
