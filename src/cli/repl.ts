import readline from 'node:readline';
import type { AgentSession } from '../agent/loop';
import { Renderer } from './renderer';

export async function startRepl(agent: AgentSession, renderer: Renderer): Promise<void> {
  let debug = false;
  const prompt = await renderer.promptText();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt });

  rl.on('SIGINT', () => {
    rl.close();
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

    if (input === '/exit') {
      rl.close();
      break;
    }
    if (input === '/reset') {
      agent.reset();
      process.stdout.write('History reset.\n');
      rl.prompt();
      continue;
    }
    if (input === '/history') {
      const stats = agent.getHistoryStats();
      process.stdout.write(`Turns: ${stats.turns}, estimated tokens: ${stats.estimatedTokens}\n`);
      rl.prompt();
      continue;
    }
    if (input === '/debug') {
      debug = !debug;
      agent.setDebug(debug);
      renderer.setDebug(debug);
      process.stdout.write(`Debug ${debug ? 'enabled' : 'disabled'}.\n`);
      rl.prompt();
      continue;
    }
    try {
      for await (const event of agent.run(input)) {
        await renderer.render(event);
      }
    } catch (err: any) {
      process.stdout.write(`Agent failed: ${err?.message ?? 'Unknown error'}\n`);
    }
    rl.prompt();
  }
}
