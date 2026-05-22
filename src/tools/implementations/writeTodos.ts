import type { ToolDefinition, ToolResult } from '../registry';

interface TodoItem {
  task: string;
  completed: boolean;
}

export const writeTodosTool: ToolDefinition = {
  name: 'write_todos',
  description: 'Track task progress through an ordered step-by-step plan. Call this after gathering context to lay out your implementation plan, then update it as you complete each step.',
  params: [
    { name: 'todos', type: 'string', required: true, description: 'JSON stringified array of { task: string, completed: boolean } objects. Rewrite ALL todos each time with their current status.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.todos !== 'string') throw new Error('todos must be a JSON string');

      const todos: TodoItem[] = JSON.parse(params.todos);
      if (!Array.isArray(todos)) throw new Error('todos must be a JSON array');

      const lines: string[] = ['📋 Task Plan:'];
      let completedCount = 0;

      for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        if (typeof todo.task !== 'string') throw new Error(`Todo ${i}: task must be a string`);
        if (typeof todo.completed !== 'boolean') throw new Error(`Todo ${i}: completed must be a boolean`);

        const icon = todo.completed ? '✅' : '⬜';
        lines.push(`  ${icon} ${todo.task}`);
        if (todo.completed) completedCount++;
      }

      const progress = todos.length > 0 ? `${completedCount}/${todos.length}` : '0/0';
      const pct = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0;
      lines.push(`\n📊 Progress: ${progress} (${pct}%)`);

      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        return { success: false, output: '', error: 'todos must be a valid JSON array' };
      }
      return { success: false, output: '', error: err?.message ?? 'Failed to write todos' };
    }
  }
};
