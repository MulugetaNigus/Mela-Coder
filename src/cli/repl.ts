import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentSession } from '../agent/loop';
import { Renderer } from './renderer';
import { ProjectMemory } from '../memory/project';
import { SkillLoader } from '../skills/loader';

const HISTORY_DIR = path.join(os.homedir(), '.addis-code');
const HISTORY_FILE = path.join(HISTORY_DIR, 'repl_history.json');
const MAX_HISTORY = 200;

function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(data)) return data.slice(-MAX_HISTORY);
    }
  } catch { /* ignore corrupt history */ }
  return [];
}

function saveHistory(rl: readline.Interface): void {
  try {
    const history = (rl as any).history;
    if (!Array.isArray(history)) return;
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, MAX_HISTORY)), 'utf8');
  } catch { /* ignore save errors */ }
}

export async function startRepl(agent: AgentSession, renderer: Renderer): Promise<void> {
  let debug = false;
  const prompt = await renderer.promptText();
  const savedHistory = loadHistory();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt,
    history: savedHistory,
    historySize: MAX_HISTORY,
  } as any);

  // Enable bracketed paste mode — lets us distinguish pasted vs typed input
  process.stdout.write('\x1b[?2004h');

  let pastedAccumulator = '';
  let pasting = false;

  rl.on('paste', (data: string) => {
    pastedAccumulator += data;
    pasting = true;
  });

  rl.on('SIGINT', () => {
    rl.close();
  });

  rl.on('close', () => {
    saveHistory(rl);
    process.stdout.write('\x1b[?2004l');
  });

  rl.prompt();

  for await (const line of rl) {
    let input: string;
    if (pasting) {
      // Final chunk of paste arrives through the line event
      input = pastedAccumulator + line;
      process.stdout.write(`[Pasted ${input.length} chars]\n`);
      pasting = false;
      pastedAccumulator = '';
    } else {
      input = line.trim();
    }

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
    if (input === '/login') {
      process.stdout.write('\nInitiating browser login...\n');
      try {
        const { browserLogin } = await import('../auth/browserLogin');
        const token = await browserLogin();
        const { saveToken } = await import('../auth/tokenManager');
        saveToken(token);
        process.stdout.write('\n\x1b[32m✓\x1b[0m Login successful! Token saved to .env\n');
      } catch (err: any) {
        process.stdout.write(`\n\x1b[31m✗\x1b[0m Login failed: ${err.message}\n`);
      }
      rl.prompt();
      continue;
    }
    try {
      for await (const event of agent.run(input)) {
        await renderer.render(event);
      }
    } catch (err: any) {
      process.stderr.write(`\x1b[31m  error\x1b[0m \x1b[2m· ${err?.message ?? 'Unknown error'}\x1b[0m\n\n`);
    }
    rl.prompt();
  }
}
