import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ENV_VAR = 'MELA_TOKEN';
const DEFAULT_ENV_PATH = path.resolve('.env');

export function loadToken(envPath = DEFAULT_ENV_PATH): string | null {
  const envFile = envPath;
  if (!existsSync(envFile)) {
    const token = process.env[ENV_VAR];
    return token && token.length > 0 ? token : null;
  }
  
  const content = readFileSync(envFile, 'utf8');
  const match = content.match(/^MELA_TOKEN=["']?([^"'\n\r]+)["']?$/m);
  return match ? match[1] : null;
}

export function saveToken(token: string, envPath = DEFAULT_ENV_PATH): void {
  let existing = '';
  if (existsSync(envPath)) {
    existing = readFileSync(envPath, 'utf8');
  }
  
  const cleaned = existing
    .split('\n')
    .filter(line => !line.match(/^MELA_TOKEN\s*=/) && line.trim() !== '')
    .join('\n');
  
  const updated = cleaned + (cleaned.endsWith('\n') ? '' : '\n') + `MELA_TOKEN="${token}"\n`;
  writeFileSync(envPath, updated, 'utf8');
  process.env[ENV_VAR] = token;
}

export function ensureEnvGitignored(): void {
  const gitignorePath = path.resolve('.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '.env\n', 'utf8');
    return;
  }
  
  const content = readFileSync(gitignorePath, 'utf8');
  if (!content.includes('.env')) {
    writeFileSync(gitignorePath, content.trimEnd() + '\n.env\n', 'utf8');
  }
}

export interface TokenRefreshResult {
  success: boolean;
  token?: string;
  error?: string;
}

export async function refreshAccessToken(refreshToken?: string): Promise<TokenRefreshResult> {
  const BASE_URL = 'https://mela.aii.et';
  
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': BASE_URL,
      },
      credentials: 'include',
    });
    
    if (!res.ok) {
      return { success: false, error: `Refresh failed: HTTP ${res.status}` };
    }
    
    const data = await res.json() as { access_token?: string };
    if (!data.access_token) {
      return { success: false, error: 'No access_token in refresh response' };
    }
    
    return { success: true, token: data.access_token };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error during refresh' };
  }
}