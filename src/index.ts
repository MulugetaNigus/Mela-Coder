#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createAgent } from './agent/loop';
import { MelaClient } from './api/melaClient';
import { Renderer } from './cli/renderer';
import { startRepl } from './cli/repl';
import { setAutoApply } from './ui/diff';
import { CheckpointManager, registerInterruptHandlers } from './session/checkpoint';
import { browserLogin } from './auth/browserLogin';
import { loadToken, loadRefreshToken, saveToken, ensureEnvGitignored } from './auth/tokenManager';
import { showAuthSuccess, showAuthError } from './cli/authPrompt';

interface CliArgs {
  melaToken?: string;
  task?: string;
  debug: boolean;
  maxIter?: number;
  reasoning?: boolean;
  search: boolean;
  version: boolean;
  dangerouslyAllowAll: boolean;
  readOnly: boolean;
  autoApply: boolean;
  resume: boolean;
  skipVerify: boolean;
  login: boolean;
  refreshToken: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    debug: false,
    reasoning: undefined,
    search: false,
    version: false,
    dangerouslyAllowAll: false,
    readOnly: false,
    autoApply: false,
    resume: false,
    skipVerify: false,
    login: false,
    refreshToken: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--mela-token') args.melaToken = argv[++index];
    else if (arg === '--task') args.task = argv[++index];
    else if (arg === '--debug') args.debug = true;
    else if (arg === '--max-iter') args.maxIter = Number(argv[++index]);
    else if (arg === '--reasoning' || arg === '-r') args.reasoning = true;
    else if (arg === '--search' || arg === '-s') args.search = true;
    else if (arg === '--version') args.version = true;
    else if (arg === '--dangerously-allow-all') args.dangerouslyAllowAll = true;
    else if (arg === '--read-only') args.readOnly = true;
    else if (arg === '--auto-apply') args.autoApply = true;
    else if (arg === '--resume') args.resume = true;
    else if (arg === '--skip-verify') args.skipVerify = true;
    else if (arg === '--login') args.login = true;
    else if (arg === '--refresh-token') args.refreshToken = true;
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

async function promptSessionResume(taskDesc: string, elapsedMins: number): Promise<boolean> {
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const truncDesc = taskDesc.length > 60 ? taskDesc.slice(0, 57) + '...' : taskDesc;

  process.stdout.write(`\n  ${yellow('⚠')} ${bold('Interrupted session found')} ${dim(`(${elapsedMins}m ago)`)}\n`);
  process.stdout.write(`  ${dim('Task:')} ${cyan(truncDesc)}\n\n`);

  const options = ['Resume', 'Discard'];
  let selectedIndex = 0;

  const renderOptions = () => {
    const rendered = options.map((opt, idx) => {
      if (idx === selectedIndex) {
        return `\x1b[7m\x1b[1m\x1b[33m[ ${opt} ]\x1b[0m`;
      } else {
        return `\x1b[2m  ${opt}  \x1b[0m`;
      }
    }).join('   ');
    process.stdout.write(`\r\x1b[K  ${rendered}`);
  };

  renderOptions();

  return new Promise<boolean>(resolve => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const handleKey = (chunk: Buffer) => {
      const key = chunk.toString();
      if (key === '\u0003') {
        process.stdin.setRawMode(wasRaw);
        process.stdin.removeListener('data', handleKey);
        process.stdout.write('\n');
        process.exit(130);
      }
      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(wasRaw);
        process.stdin.removeListener('data', handleKey);
        process.stdout.write('\n\n');
        resolve(selectedIndex === 0);
        return;
      }
      if (key === '\u001b[C' || key === '\t') {
        selectedIndex = (selectedIndex + 1) % options.length;
        renderOptions();
      } else if (key === '\u001b[D') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        renderOptions();
      }
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'r') { selectedIndex = 0; renderOptions(); }
      else if (lowerKey === 'd') { selectedIndex = 1; renderOptions(); }
    };

    process.stdin.on('data', handleKey);
  });
}

async function main(): Promise<void> {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));
  setAutoApply(args.autoApply);

  if (args.version) {
    process.stdout.write('0.2.0\n');
    return;
  }

  if (args.login) {
    await ensureEnvGitignored();
    try {
      const token = await browserLogin();
      saveToken(token);
      showAuthSuccess();
    } catch (err: any) {
      showAuthError(err.message);
      process.exitCode = 1;
    }
    return;
  }

  if (args.refreshToken) {
    const existingToken = loadToken();
    const existingRefreshToken = loadRefreshToken();
    if (!existingToken) {
      process.stderr.write('No existing token found. Use --login to authenticate.\n');
      process.exitCode = 1;
      return;
    }
    const client = new MelaClient(existingToken, {
      refreshTokenCookie: existingRefreshToken ?? undefined,
    });
    const newToken = await client.refreshAccessToken();
    if (newToken) {
      saveToken(newToken);
      process.stdout.write('\n\x1b[32m✓\x1b[0m Token refreshed successfully.\n');
    } else {
      process.stderr.write('Token refresh failed. Your session may have expired. Use --login for a new token.\n');
      process.exitCode = 1;
    }
    return;
  }

  let melaToken = args.melaToken ?? loadToken();

  if (!melaToken) {
    await ensureEnvGitignored();
    
    process.stdout.write('\n\x1b[36m\x1b[1mNo Mela token found.\x1b[0m\n');
    process.stdout.write('Opening browser for authentication...\n\n');
    
    try {
      melaToken = (await browserLogin()) ?? '';
      saveToken(melaToken);
      showAuthSuccess();
    } catch (err: any) {
      showAuthError(err.message);
      process.exitCode = 1;
      return;
    }
  }

  const tokenCheck = new MelaClient(melaToken);
  const validation = await tokenCheck.validateToken();
  if (!validation.ok) {
    process.stderr.write(`error · ${validation.error}\n`);

    const existingRefreshToken = loadRefreshToken();
    if (existingRefreshToken) {
      process.stdout.write('Trying token refresh...\n');
      const refreshClient = new MelaClient(melaToken, {
        refreshTokenCookie: existingRefreshToken,
      });
      const newToken = await refreshClient.refreshAccessToken();
      if (newToken) {
        saveToken(newToken);
        melaToken = newToken;
        process.stdout.write('\x1b[32m✓ Token refreshed.\x1b[0m\n\n');
      } else {
        process.stdout.write('\x1b[33mToken refresh failed. Starting browser login...\x1b[0m\n\n');
        const ok = await promptBrowserLogin();
        if (!ok) { process.exitCode = 1; return; }
      }
    } else {
      process.stdout.write('\n\x1b[33mYour token may be invalid or expired.\x1b[0m\n');
      process.stdout.write('Starting browser login for a new token...\n\n');
      const ok = await promptBrowserLogin();
      if (!ok) { process.exitCode = 1; return; }
    }
  }

  async function promptBrowserLogin(): Promise<boolean> {
    try {
      const newToken = await browserLogin();
      if (!newToken) { showAuthError('No token received'); return false; }
      melaToken = newToken;
      saveToken(melaToken);
      showAuthSuccess();
      return true;
    } catch (err: any) {
      showAuthError(err.message);
      return false;
    }
  }

  let task = args.task;
  let restoredHistory: any[] | undefined;

  if (args.resume) {
    const checkpoint = CheckpointManager.load();
    if (!checkpoint) {
      process.stderr.write('⚠️ No checkpoint found to resume from.\n');
    } else {
      if (CheckpointManager.isStale(checkpoint)) {
        process.stdout.write('⚠️ Warning: Checkpoint is older than 24 hours.\n');
      }
      process.stdout.write(`✓ Resuming task: ${checkpoint.taskDescription}\n`);
      task = checkpoint.taskDescription;
      restoredHistory = checkpoint.conversationHistory;
    }
  }

  // Auto-detect interrupted sessions on REPL startup (no --resume flag needed)
  if (!task && !args.resume) {
    const checkpoint = CheckpointManager.load();
    if (checkpoint && !CheckpointManager.isStale(checkpoint)) {
      const elapsedMins = Math.round((Date.now() - checkpoint.timestamp) / 60000);
      const shouldResume = await promptSessionResume(checkpoint.taskDescription, elapsedMins);
      if (shouldResume) {
        task = checkpoint.taskDescription;
        restoredHistory = checkpoint.conversationHistory;
      } else {
        CheckpointManager.delete();
      }
    }
  }

  const melaRefreshToken = loadRefreshToken() ?? undefined;

  const agent = createAgent({
    melaToken,
    melaRefreshToken,
    maxIterations: args.maxIter,
    debug: args.debug,
    reasoning: args.reasoning,
    search: args.search,
    dangerouslyAllowAll: args.dangerouslyAllowAll,
    readOnly: args.readOnly,
    restoredHistory,
    skipVerify: args.skipVerify,
  });
  const renderer = new Renderer(args.debug);
  await renderer.renderBanner();

  if (args.dangerouslyAllowAll) {
    process.stdout.write('\x1b[33m⚠️ WARNING: Running with --dangerously-allow-all. Security gates are disabled.\x1b[0m\n\n');
  }

  if (task) {
    registerInterruptHandlers(task, () => agent.getState(), async () => agent.shutdown());
    let exitCode = 1;
    for await (const event of agent.run(task)) {
      await renderer.render(event);
      if (event.type === 'done') {
        exitCode = 0;
        CheckpointManager.delete();
      }
      if (event.type === 'error') exitCode = 1;
    }
    if (exitCode === 0) {
      await agent.shutdown();
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
