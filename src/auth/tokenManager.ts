import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ENV_VAR = 'MELA_TOKEN';
const REFRESH_ENV_VAR = 'MELA_REFRESH_TOKEN';
const DEFAULT_ENV_PATH = path.resolve('.env');

function readEnvValue(key: string, envPath: string): string | null {
  if (!existsSync(envPath)) {
    const val = process.env[key];
    return val && val.length > 0 ? val : null;
  }
  const content = readFileSync(envPath, 'utf8');
  const match = content.match(new RegExp(`^${key}=["']?([^"'\\n\\r]+)["']?$`, 'm'));
  return match ? match[1] : null;
}

function writeEnvValue(key: string, value: string, envPath: string): void {
  let existing = '';
  if (existsSync(envPath)) {
    existing = readFileSync(envPath, 'utf8');
  }
  const cleaned = existing
    .split('\n')
    .filter(line => !line.match(new RegExp(`^${key}\\s*=`)) && line.trim() !== '')
    .join('\n');
  const updated = cleaned + (cleaned.endsWith('\n') ? '' : '\n') + `${key}="${value}"\n`;
  writeFileSync(envPath, updated, 'utf8');
  process.env[key] = value;
}

export function loadToken(envPath = DEFAULT_ENV_PATH): string | null {
  return readEnvValue(ENV_VAR, envPath) ?? process.env[ENV_VAR] ?? null;
}

export function saveToken(token: string, envPath = DEFAULT_ENV_PATH): void {
  writeEnvValue(ENV_VAR, token, envPath);
}

export function loadRefreshToken(envPath = DEFAULT_ENV_PATH): string | null {
  return readEnvValue(REFRESH_ENV_VAR, envPath) ?? process.env[REFRESH_ENV_VAR] ?? null;
}

export function saveRefreshToken(token: string, envPath = DEFAULT_ENV_PATH): void {
  writeEnvValue(REFRESH_ENV_VAR, token, envPath);
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
  const cookieHeader = refreshToken ? `refresh_token=${refreshToken}` : '';
  
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': BASE_URL,
        'Referer': BASE_URL + '/chats',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
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