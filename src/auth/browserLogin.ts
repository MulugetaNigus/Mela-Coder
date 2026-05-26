import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import open from 'open';
import readline from 'node:readline';
import process from 'node:process';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for manual token copy

export function getLoginUrl(): string {
  return 'https://mela.aii.et/signin';
}

export async function browserLogin(): Promise<string> {
  const authUrl = getLoginUrl();
  
  open(authUrl).catch(() => {
    process.stdout.write(`\nCould not open browser automatically.\nVisit this URL manually:\n  ${authUrl}\n\n`);
  });
  
  process.stdout.write(`\nOpening browser for login... If page doesn't open, visit:\n  ${authUrl}\n\n`);
  
  process.stdout.write(`After logging in:
  1. Open browser dev tools (F12)
  2. Go to Application → Local Storage  
  3. Copy the value of "access_token"
  4. Paste it below (Ctrl+Shift+V to paste)

Enter token: `);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      rl.close();
      reject(new Error('Login timeout - please provide the token'));
    }, LOGIN_TIMEOUT_MS);

    rl.on('line', (line) => {
      clearTimeout(timeout);
      const trimmed = line.trim();
      if (trimmed && trimmed.startsWith('eyJ')) {
        rl.close();
        resolve(trimmed);
      } else {
        process.stdout.write(`\nInvalid token format. Token should start with 'eyJ'. Try again or Ctrl+C to cancel: `);
      }
    });

    rl.on('close', () => {
      // Handle Ctrl+C gracefully
    });
  });
}

export async function browserLoginWithFallback(): Promise<string> {
  return browserLogin();
}