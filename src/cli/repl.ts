import readline from 'node:readline';
import type { AgentSession } from '../agent/loop';
import { Renderer } from './renderer';
import { ProjectMemory } from '../memory/project';
import { SkillLoader } from '../skills/loader';

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
    if (input.startsWith('/memory')) {
      const parts = input.split(/\s+/);
      const sub = parts[1];
      if (sub === 'init') {
        const targetPath = ProjectMemory.init();
        process.stdout.write(`✓ Project memory initialized at ${targetPath}\n`);
      } else {
        const mem = ProjectMemory.load();
        if (!mem) {
          process.stdout.write('⚠️ No project memory found. Use /memory init to initialize one.\n');
        } else {
          process.stdout.write(`\n--- MELA.md Project Memory ---\n${mem}\n-----------------------------\n`);
        }
      }
      rl.prompt();
      continue;
    }
    if (input.startsWith('/skills')) {
      const skills = SkillLoader.discoverSkills();
      if (skills.length === 0) {
        process.stdout.write('⚠️ No skills discovered in src/skills/\n');
      } else {
        process.stdout.write('\n--- Discovered Skills ---\n');
        for (const skill of skills) {
          process.stdout.write(`- ${skill.name}: trigger patterns: ${skill.triggers.toString()}\n`);
        }
        process.stdout.write('-------------------------\n');
      }
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
