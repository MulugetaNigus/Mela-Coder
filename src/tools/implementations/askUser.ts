import readline from 'node:readline';
import type { ToolDefinition, ToolResult } from '../registry';

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description: 'Ask the user a clarification question and wait for input.',
  params: [{ name: 'question', type: 'string', required: true, description: 'Question to ask the user.' }],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.question !== 'string') throw new Error('question must be a string');
      const question = params.question;
      const border = yellow('━'.repeat(50));
      const answer = await new Promise<string>(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        process.stdout.write(`\n${border}\n`);
        process.stdout.write(`${bold(yellow('  ❓ Clarification Needed'))}\n\n`);
        process.stdout.write(`  ${cyan(question)}\n\n`);
        process.stdout.write(`  ${dim('Type your answer below:')}\n`);
        process.stdout.write(`${bold(yellow('  ──'))} `);
        rl.once('line', line => {
          rl.close();
          resolve(line);
        });
      });
      process.stdout.write(`${border}\n`);
      return { success: true, output: answer };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to ask user' };
    }
  }
};
