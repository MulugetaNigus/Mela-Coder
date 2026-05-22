#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createAgent } from './agent/loop';
import { Renderer } from './cli/renderer';
import { startRepl } from './cli/repl';

interface CliArgs {
  melaToken?: string;
  task?: string;
  debug: boolean;
  maxIter?: number;
  reasoning: boolean;
  search: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { debug: false, reasoning: false, search: false, version: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--mela-token') args.melaToken = argv[++index];
    else if (arg === '--task') args.task = argv[++index];
    else if (arg === '--debug') args.debug = true;
    else if (arg === '--max-iter') args.maxIter = Number(argv[++index]);
    else if (arg === '--reasoning' || arg === '-r') args.reasoning = true;
    else if (arg === '--search' || arg === '-s') args.search = true;
    else if (arg === '--version') args.version = true;
  }
  return args;
}

function loadEnvFile(filePath = path.resolve(process.cwd(), '.env')): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    process.stdout.write('0.2.0\n');
    return;
  }

  const melaToken = args.melaToken ?? process.env.MELA_TOKEN;
  if (!melaToken) {
    process.stderr.write('Missing Mela token. Use --mela-token <token> or MELA_TOKEN env var.\n');
    process.exitCode = 1;
    return;
  }

  const agent = createAgent({
    melaToken,
    maxIterations: args.maxIter,
    debug: args.debug,
    reasoning: args.reasoning,
    search: args.search,
  });
  const renderer = new Renderer(args.debug);
  await renderer.renderBanner();

  if (args.task) {
    let exitCode = 1;
    for await (const event of agent.run(args.task)) {
      await renderer.render(event);
      if (event.type === 'done') exitCode = 0;
      if (event.type === 'error') exitCode = 1;
    }
    process.exitCode = exitCode;
    return;
  }

  await startRepl(agent, renderer);
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err?.message ?? 'Unknown error'}\n`);
  process.exitCode = 1;
});
