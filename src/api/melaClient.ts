export interface MelaStreamOpts {
  onToken?: (token: string) => void;
  onReasoning?: (text: string) => void;
  onStatus?: (status: string) => void;
}

export interface StreamChunk {
  text: string;
  done: boolean;
  reasoning?: string;
  status?: string;
}

export interface GenerateResponse {
  response_text: string;
  finish_reason: 'stop' | 'length' | 'error';
}

const BASE_URL = 'https://mela.aii.et';
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

function extractCookies(headers: Headers): string {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [];
  return raw.map(s => s.split(';')[0]).join('; ');
}

function mergeCookies(existing: string, fresh: string): string {
  if (!fresh) return existing || '';
  if (!existing) return fresh;
  const map: Record<string, string> = {};
  for (const part of (existing + '; ' + fresh).split('; ')) {
    const [k, ...v] = part.split('=');
    if (k) map[k.trim()] = v.join('=');
  }
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

function isAuthError(msg: string): boolean {
  return /\b(401|403|unauthorized|forbidden)\b/i.test(msg);
}

function retryDelay(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt), 10000);
}

export class MelaClient {
  private _token: string;
  private cookies = '';
  private sessionId = '';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private onTokenRefreshed?: (newToken: string) => void;

  constructor(token: string, opts?: { refreshTokenCookie?: string; onTokenRefreshed?: (token: string) => void }) {
    this._token = token;
    this.onTokenRefreshed = opts?.onTokenRefreshed;
    if (opts?.refreshTokenCookie) {
      this.cookies = mergeCookies(this.cookies, `refresh_token=${opts.refreshTokenCookie}`);
    }
  }

  get token(): string {
    return this._token;
  }

  set token(newToken: string) {
    this._token = newToken;
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': BASE_URL,
      'Referer': BASE_URL + '/chats',
      'Authorization': `Bearer ${this._token}`,
    };
    if (this.cookies) h['Cookie'] = this.cookies;
    return h;
  }

  async createSession(): Promise<string> {
    const res = await fetch(`${BASE_URL}/api/chat/create-session`, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    const freshCookies = extractCookies(res.headers);
    if (freshCookies) this.cookies = mergeCookies(this.cookies, freshCookies);
    if (!res.ok) throw new Error(`create-session failed: ${res.status}`);
    const data = await res.json() as { session_id: string };
    this.sessionId = data.session_id;
    return this.sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async validateToken(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.createSession();
      return { ok: true };
    } catch (err: any) {
      const msg = err.message ?? '';
      if (isAuthError(msg)) {
        return { ok: false, error: 'Invalid or expired MELA_TOKEN. Check your token and try again.' };
      }
      if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('enotfound')) {
        return { ok: false, error: 'Cannot reach the Mela API. Check your internet connection.' };
      }
      return { ok: false, error: `Mela API error: ${msg}` };
    }
  }

  async refreshAccessToken(): Promise<string | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': BASE_URL,
          'Cookie': this.cookies,
          'Referer': BASE_URL + '/chats',
        },
      });
      
      const freshCookies = extractCookies(res.headers);
      if (freshCookies) this.cookies = mergeCookies(this.cookies, freshCookies);
      
      if (!res.ok) return null;
      
      const data = await res.json() as { access_token?: string };
      if (data.access_token) {
        this._token = data.access_token;
        this.onTokenRefreshed?.(data.access_token);
        return this._token;
      }
      return null;
    } catch {
      return null;
    }
  }

  getRefreshTokenCookie(): string | null {
    const match = this.cookies.match(/refresh_token=([^;]+)/);
    return match ? match[1] : null;
  }

  startAutoRefresh(intervalMs = 300_000): void {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(async () => {
      try {
        await this.refreshAccessToken();
      } catch {
        // Silently retry next interval
      }
    }, intervalMs);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async *generateStream(
    prompt: string,
    opts: {
      reasoning?: boolean;
      search?: boolean;
      onToken?: (token: string) => void;
      onReasoning?: (text: string) => void;
      onStatus?: (status: string) => void;
    } = {}
  ): AsyncGenerator<StreamChunk> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Refresh session on retry or first use
          if (!this.sessionId || attempt > 0) {
            try {
              await this.createSession();
            } catch (sessionErr: any) {
              if (isAuthError(sessionErr.message)) throw sessionErr;
              lastError = sessionErr;
            if (attempt < MAX_RETRIES - 1) {
              const delay = retryDelay(attempt);
              const msg = `Session creation failed. Retrying in ${delay / 1000}s (attempt ${attempt + 2}/${MAX_RETRIES})...`;
              opts.onStatus?.(msg);
              yield { text: '', done: false, status: msg };
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw sessionErr;
          }
        }

        const res = await fetch(`${BASE_URL}/api/chat/stream`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({
            prompt,
            session_id: this.sessionId,
            reasoning: opts.reasoning ? 1 : 0,
            search: opts.search ? 1 : 0,
          }),
        });

        const freshCookies = extractCookies(res.headers);
        if (freshCookies) this.cookies = mergeCookies(this.cookies, freshCookies);
        if (!res.ok) {
          const errText = await res.text();
          const errMsg = `HTTP ${res.status}: ${errText}`;
          if (isAuthError(errMsg)) throw new Error(errMsg);
          throw new Error(errMsg);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            try {
              const chunk = t.startsWith('data:')
                ? JSON.parse(t.slice(5).trim())
                : t.startsWith('{') ? JSON.parse(t) : null;
              if (!chunk) continue;
              if (chunk.info || chunk.status) {
                opts.onStatus?.(chunk.info || chunk.status);
                yield { text: '', done: false, status: chunk.info || chunk.status };
              }
              if (chunk.token) {
                fullText += chunk.token;
                opts.onToken?.(chunk.token);
                yield { text: chunk.token, done: false };
              }
              if (chunk.reasoning) {
                opts.onReasoning?.(chunk.reasoning);
                yield { text: '', done: false, reasoning: chunk.reasoning };
              }
              if (chunk.error) throw new Error('Server error: ' + chunk.error);
            } catch (e: any) {
              if (e.message.startsWith('Server error:')) throw e;
            }
          }
        }
        // Process remaining buffer
        if (buffer.trim()) {
          const t = buffer.trim();
          try {
            const chunk = t.startsWith('data:')
              ? JSON.parse(t.slice(5).trim())
              : t.startsWith('{') ? JSON.parse(t) : null;
            if (chunk) {
              if (chunk.token) {
                fullText += chunk.token;
                opts.onToken?.(chunk.token);
                yield { text: chunk.token, done: false };
              }
            }
          } catch { /* skip */ }
        }
        yield { text: '', done: true };
        return; // Success — exit retry loop

      } catch (err: any) {
        lastError = err;
        // Try token refresh on auth errors, then retry
        if (isAuthError(err.message)) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            this.sessionId = '';
            continue;
          }
          throw err;
        }
        if (attempt < MAX_RETRIES - 1) {
          const delay = retryDelay(attempt);
          this.sessionId = ''; // Force new session on retry
          const msg = `Stream failed: ${err.message}. Retrying in ${delay / 1000}s (${attempt + 2}/${MAX_RETRIES})...`;
          opts.onStatus?.(msg);
          yield { text: '', done: false, status: msg };
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  /**
   * Non-streaming generate: accumulates stream into final response.
   * Mela has no non-streaming endpoint, so we always stream internally.
   */
  async generate(
    prompt: string,
    opts: { reasoning?: boolean; search?: boolean } = {}
  ): Promise<GenerateResponse> {
    let fullText = '';
    for await (const chunk of this.generateStream(prompt, opts)) {
      if (chunk.text) fullText += chunk.text;
      if (chunk.done) break;
    }
    return {
      response_text: fullText,
      finish_reason: fullText ? 'stop' : 'length',
    };
  }
}
