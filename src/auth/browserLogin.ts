import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import open from 'open';
import readline from 'node:readline';
import process from 'node:process';
import { saveToken, saveRefreshToken } from './tokenManager';

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
  2. Go to Application → Cookies → mela.aii.et
  3. Copy the value of "refresh_token"
  4. Paste it below (Ctrl+Shift+V to paste)

Enter refresh_token: `);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve, reject) => {
    let refreshToken = '';

    const askAccessToken = () => {
      process.stdout.write(`\nNow paste the "access_token" from Application → Local Storage: `);
    };

    const timeout = setTimeout(() => {
      rl.close();
      reject(new Error('Login timeout'));
    }, LOGIN_TIMEOUT_MS);

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('eyJ')) {
        process.stdout.write(`\nInvalid format. Token should start with 'eyJ'. Try again: `);
        return;
      }
      
      if (!refreshToken) {
        refreshToken = trimmed;
        saveRefreshToken(trimmed);
        askAccessToken();
        return;
      }

      clearTimeout(timeout);
      saveToken(trimmed);
      rl.close();
      resolve(trimmed);
    });

    rl.on('close', () => {
      // Handle Ctrl+C gracefully
    });
  });
}

export async function browserLoginWithFallback(): Promise<string> {
  return browserLogin();
}