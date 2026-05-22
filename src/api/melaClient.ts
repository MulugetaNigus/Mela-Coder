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

export class MelaClient {
  private readonly token: string;
  private cookies = '';
  private sessionId = '';

  constructor(token: string) {
    this.token = token;
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': BASE_URL,
      'Referer': BASE_URL + '/chats',
      'Authorization': `Bearer ${this.token}`,
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
    if (!this.sessionId) {
      await this.createSession();
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
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

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
