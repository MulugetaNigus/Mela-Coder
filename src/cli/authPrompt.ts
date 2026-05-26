import readline from 'node:readline';
import process from 'node:process';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export function getLoginUrl(): string {
  return 'https://mela.aii.et/signin';
}

export function showAuthSuccess(): void {
  process.stdout.write(`\n${green('✓')} Authentication successful! Starting Mela-Coder...\n`);
}

export function showAuthError(error: string): void {
  process.stderr.write(`\n${yellow('✗')} Authentication failed: ${error}\n`);
}