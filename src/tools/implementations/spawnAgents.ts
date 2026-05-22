import type { ToolDefinition, ToolResult } from '../registry';
import { runSubAgent, getAvailableAgentTypes, type SubAgentParams } from '../../agent/subAgent';
import { MelaClient } from '../../api/melaClient';

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
      if (!melaToken) {
        return { success: false, output: '', error: 'MELA_TOKEN not set' };
      }

      const client = new MelaClient(melaToken);

      const results = await Promise.allSettled(
        agents.map(agent => runSubAgent(agent, melaToken, client))
      );

      const lines: string[] = ['Sub-Agent Results:'];
      let allSucceeded = true;

      for (let i = 0; i < results.length; i++) {
        const agent = agents[i];
        const result = results[i];

        lines.push(`\n  -- Agent ${i + 1}: ${agent.agentType} --`);

        if (result.status === 'fulfilled') {
          const value = result.value;
          if (value.success) {
            lines.push(`  [ok] Success`);
            const outputPreview = value.output.length > 500
              ? value.output.slice(0, 500) + `\n  [${value.output.length - 500} more chars]`
              : value.output;
            if (outputPreview) {
              lines.push(`  Output: ${outputPreview}`);
            }
          } else {
            lines.push(`  [fail] Failed: ${value.error ?? 'Unknown error'}`);
            allSucceeded = false;
          }
        } else {
          lines.push(`  [fail] Error: ${result.reason?.message ?? 'Sub-agent crashed'}`);
          allSucceeded = false;
        }
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
