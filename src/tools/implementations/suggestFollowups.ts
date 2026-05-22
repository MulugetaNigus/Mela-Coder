import type { ToolDefinition, ToolResult } from '../registry';

interface FollowupSuggestion {
  prompt: string;
  label?: string;
}

export const suggestFollowupsTool: ToolDefinition = {
  name: 'suggest_followups',
  description: 'Suggest clickable followup prompts for the user after completing a task. Each suggestion is a prompt the user can click to execute. Use this after finishing a task to guide the user to the next logical step.',
  params: [
    { name: 'followups', type: 'string', required: true, description: 'JSON stringified array of { prompt: string, label?: string } objects. Aim for around 3 suggestions.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.followups !== 'string') throw new Error('followups must be a JSON string');

      const followups: FollowupSuggestion[] = JSON.parse(params.followups);
      if (!Array.isArray(followups)) throw new Error('followups must be a JSON array');
      if (followups.length === 0) throw new Error('followups must have at least 1 item');

      const lines: string[] = ['💡 Suggested next steps:'];
      for (let i = 0; i < followups.length; i++) {
        const f = followups[i];
        if (typeof f.prompt !== 'string') throw new Error(`Followup ${i}: prompt must be a string`);
        const label = f.label ?? (f.prompt.length > 50 ? f.prompt.slice(0, 50) + '...' : f.prompt);
        lines.push(`  ${i + 1}. [${label}]`);
        lines.push(`     ${f.prompt}`);
      }

      lines.push('\n(User can click any suggestion to send that prompt.)');
      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        return { success: false, output: '', error: 'followups must be a valid JSON array' };
      }
      return { success: false, output: '', error: err?.message ?? 'Failed to suggest followups' };
    }
  }
};
